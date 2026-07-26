# β1 サーバー同期(Supabase)セットアップ手順

作成日: 2026-07-26 / 対象: ルーティンノート β1（確認済みメール＋PW認証とデータ同期）

**Supabaseプロジェクトの作成はあなたの手作業が必要**（Claudeはアカウントを作れない）。
作成して「Project URL」と「anon public key」を教えてくれれば、Claudeがアプリに組み込む。

設計の根拠: `obsidian-vault/ideas/2026-07-25_ルーティンノートβ版リリース設計_Codex議論.md`

---

## 0. 何を作るのか（1分で）

- ログインした人のデータだけをサーバーに置き、複数端末で同じ内容を見られるようにする
- **端末側が主体（ローカルファースト）**。オフラインでも今までどおり動き、つながった時に同期する
- **競合しても、どちらも捨てない**（片方を黙って上書きしない＝最重要要件）
- β1で同期するのは**記録などの軽いデータのみ**。動画・音源はβ1.5（Cloudflare R2）

---

## 1. プロジェクトを作る

1. https://supabase.com/ にサインアップ（GitHubアカウントでよい）
2. **New project** を作成
   - Name: `routine-note`（任意）
   - Database Password: 自動生成でよい。**パスワードマネージャに保存する**（後で必要）
   - Region: **Northeast Asia (Tokyo)** ← 日本のテスター向けなので東京
   - Plan: **Free**
3. 作成完了まで2〜3分待つ

> ⚠️ 無料プランは、**1週間まったくアクセスが無いとプロジェクトが一時停止**する。
> β期間中は誰かが使っていれば止まらないが、長期間放置したら管理画面から再開する。

## 2. データベースを用意する

左メニュー **SQL Editor → New query** に、下の「3. SQL」を**丸ごと貼り付けて Run**。
「Success. No rows returned」と出れば成功。

## 3. SQL（丸ごと貼り付け）

```sql
-- ============================================================
-- ルーティンノート β1 同期スキーマ
-- 方式: サーバーrevision付き楽観的並行制御 + 競合コピー(LWW禁止)
-- ============================================================

-- 変更の並び順を決める通し番号。取りこぼしなく差分を取るために使う
create sequence if not exists public.entities_change_seq;

-- 同期する実体はすべてこの1テーブルに入れる(kindで種別を分ける)
create table if not exists public.entities (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  id             text        not null,
  kind           text        not null check (kind in ('routine','session','trick','audio','runvideo','settings')),
  body           jsonb       not null,
  entity_version bigint      not null default 1,
  change_seq     bigint      not null default nextval('public.entities_change_seq'),
  deleted_at     timestamptz,                    -- 削除は墓石化(消さずに印を付ける)
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists entities_pull_idx on public.entities (user_id, change_seq);

-- 追加でも更新でも必ず通し番号を進める(更新を取りこぼさないため)
create or replace function public.bump_change_seq() returns trigger
language plpgsql as $$
begin
  new.change_seq := nextval('public.entities_change_seq');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists entities_bump on public.entities;
create trigger entities_bump before insert or update on public.entities
  for each row execute function public.bump_change_seq();

-- 同じ変更を二重に適用しないための記録(通信の再送があっても安全にする)
create table if not exists public.applied_mutations (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  mutation_id text        not null,
  result      jsonb       not null,
  applied_at  timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

-- ============================================================
-- 変更を適用する本体。
-- 端末が「自分が見ていた版(base_version)」を申告し、一致したときだけ適用する。
-- 一致しなければ上書きせず conflict を返し、端末側で競合コピーを作らせる。
-- ============================================================
create or replace function public.apply_mutation(
  p_mutation_id  text,
  p_id           text,
  p_kind         text,
  p_body         jsonb,
  p_base_version bigint,
  p_deleted      boolean default false
) returns jsonb
language plpgsql security invoker as $$
declare
  v_user uuid := auth.uid();
  v_cur  public.entities%rowtype;
  v_prev jsonb;
  v_out  jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- 同じ mutation_id は一度しか適用しない(再送しても結果は変わらない)
  select result into v_prev from public.applied_mutations
   where user_id = v_user and mutation_id = p_mutation_id;
  if found then
    return v_prev;
  end if;

  select * into v_cur from public.entities
   where user_id = v_user and id = p_id
   for update;

  if not found then
    if coalesce(p_base_version, 0) <> 0 then
      -- サーバーに無いのに版を指定している = 端末の想定とずれている
      v_out := jsonb_build_object('status', 'conflict', 'server', null);
    else
      insert into public.entities (user_id, id, kind, body, entity_version, deleted_at)
      values (v_user, p_id, p_kind, p_body, 1,
              case when p_deleted then now() else null end)
      returning * into v_cur;
      v_out := jsonb_build_object('status', 'applied',
                 'version', v_cur.entity_version, 'change_seq', v_cur.change_seq);
    end if;

  elsif v_cur.entity_version <> coalesce(p_base_version, -1) then
    -- 版が違う = 別の端末が先に変更している。上書きせずサーバー側を返す
    v_out := jsonb_build_object('status', 'conflict', 'server', to_jsonb(v_cur));

  else
    update public.entities
       set body           = p_body,
           kind           = p_kind,
           entity_version = v_cur.entity_version + 1,
           deleted_at     = case when p_deleted then coalesce(v_cur.deleted_at, now()) else null end
     where user_id = v_user and id = p_id
     returning * into v_cur;
    v_out := jsonb_build_object('status', 'applied',
               'version', v_cur.entity_version, 'change_seq', v_cur.change_seq);
  end if;

  insert into public.applied_mutations (user_id, mutation_id, result)
  values (v_user, p_mutation_id, v_out);

  return v_out;
end $$;

-- ============================================================
-- 行レベルセキュリティ: 自分の行以外は読めない・書けない
-- ============================================================
alter table public.entities          enable row level security;
alter table public.applied_mutations enable row level security;

drop policy if exists entities_own on public.entities;
create policy entities_own on public.entities
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists mutations_own on public.applied_mutations;
create policy mutations_own on public.applied_mutations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

## 4. 認証の設定

左メニュー **Authentication → Sign In / Providers**（画面名は版により異なる）で:

1. **Email** を有効にする（既定で有効）
2. **Confirm email**（メール確認）を **ON** にする
   → 設計上「確認済みメール＋PW」が前提。パスワード再発行の経路を確保するため
3. **Authentication → URL Configuration** で以下を設定
   - **Site URL**: `https://routine-note.pygmix.com/`
   - **Redirect URLs** に同じURLを追加
   → これを設定しないと、確認メールやパスワード再設定のリンクから戻ってこられない

> ⚠️ 無料プランの送信メールは**1時間あたりの通数制限**があり、迷惑メールに入ることもある。
> テスターには「確認メールが届かない場合は迷惑メールを見て」と伝える。
> 本格運用するならSMTP（独自ドメイン）の設定を検討する。

## 5. Claudeに渡すもの

> 📌 **Supabaseはキーの呼び名を変えた**（2026年時点）。ダッシュボードは
> 「Publishable key / Secret keys」表記になっており、旧名は「Legacy anon, service_role API keys」
> タブに残っている。**新旧の対応は Publishable = 旧anon、Secret = 旧service_role**。
> レガシーキーも当面は動くが、2026年末に廃止予定なので**新しい Publishable key を使う**。

| 項目 | どこにあるか | 例 |
|---|---|---|
| **Project URL** | 画面上部の緑の **Connect** ボタン、または左メニュー **Data API** | `https://xxxxxxxx.supabase.co` |
| **Publishable key** | **Settings → API Keys** の「Publishable key」欄の `default`（右のコピーボタンで全文をコピー） | `sb_publishable_...` |

Publishable key は Supabase 自身が「RLSを設定していればブラウザで使って安全」「公開してよい」と
明記しているキー。アプリのJSに直接書き込む前提のもの。

> 🚫 **Secret key（`sb_secret_...`／旧 service_role）は絶対に渡さない・アプリに入れない。**
> RLSを無視して全ユーザーのデータを操作できる管理者キー。漏れると全滅する。
> 使うのはサーバー側の処理だけで、このアプリ（ブラウザだけで動く）には一切不要。

---

## 6. このあとClaudeがやること

1. アカウント機能（新規登録・ログイン・ログアウト・パスワード再設定）
2. ゲスト（未ログイン）で作ったデータの**アカウントへの引き継ぎ**
3. 差分同期（outbox・カーソル・競合コピー）
4. 複数端末・オフライン・競合の検証

## 7. 忘れずに更新するもの

アカウント機能を公開したら、以下の更新が必要（今の記載と食い違うため）:

- `privacy.html` … 「端末内にのみ保存」ではなくなる。Supabase（保管場所・国外処理）、
  アカウント情報（メールアドレス）、削除方法（アカウント削除）を追記する
- `terms.html` … アカウントの取り扱い、退会、データの削除について追記する
- `beta.html` … ログインすると何が起きるかをテスター向けに説明する

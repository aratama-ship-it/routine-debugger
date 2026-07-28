// シート(モーダル)のキーボード操作とフォーカス管理。
// app.js の showSheet/hideSheet には手を入れず、#sheet の状態変化を監視して外側から面倒を見る。
//
// なぜ必要か: シートには role="dialog" aria-modal="true" が付いているが、これは支援技術への
// 「宣言」でしかなく、実際にフォーカスを止める効果はない。放置するとTabで背後の画面へ抜けてしまい、
// シートを開いたまま裏のボタンを押せてしまう。VoiceOverも背後を読み上げる。
//
// 対象: iPad・PCブラウザのキーボード操作、外付けキーボード、VoiceOver。
// 「ワイドサイドパネル」だけは app.js 側が独自にフォーカスを管理しているので、そこには介入しない。
(function () {
  "use strict";

  const SHEET_ID = "sheet";
  const FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  let returnFocus = null;      // シートを開く直前にフォーカスがあった要素
  let openedAsWideSide = false; // ワイドパネルとして開かれたか(その場合は何もしない)

  const sheetEl = () => document.getElementById(SHEET_ID);
  // 画面をスクロールさせずにフォーカスを当てる(preventScroll非対応環境でも落ちないように)
  function focusQuietly(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (_) { try { node.focus(); } catch (__) {} }
  }
  const isOpen = (el) => !!el && !el.classList.contains("hidden");

  function focusableIn(el) {
    return [...el.querySelectorAll(FOCUSABLE)]
      // 非表示の要素は対象外(offsetParentはposition:fixedで常にnullになり得るので併用しない)
      .filter((node) => node.getClientRects().length > 0);
  }

  function onOpen(el) {
    openedAsWideSide = el.classList.contains("wide-side-sheet");
    if (openedAsWideSide) return;           // app.js が閉じるボタンへフォーカスし、戻し先も持っている
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 先頭の入力欄ではなくシート自体へフォーカスする。
    // 入力欄に当てると iPhone でソフトキーボードが勝手に出てしまうため。
    el.setAttribute("tabindex", "-1");
    // rAFではなくタイマーで待つ: 画面が非表示のときrAFは発火せず、フォーカスが移らないため
    setTimeout(() => { if (isOpen(el)) focusQuietly(el); }, 0);
  }

  function onClose() {
    if (openedAsWideSide) { openedAsWideSide = false; return; } // 戻し先は app.js が処理する
    const target = returnFocus;
    returnFocus = null;
    // 閉じた後にフォーカスが body へ飛ぶと「今どこにいるか」が分からなくなるので、開く前の位置へ戻す
    if (target && document.contains(target)) setTimeout(() => focusQuietly(target), 0);
  }

  // 開閉の検知。hidden クラスの付け外しを見る。
  const el0 = sheetEl();
  if (el0) {
    let wasOpen = isOpen(el0);
    new MutationObserver(() => {
      const el = sheetEl();
      if (!el) return;
      const open = isOpen(el);
      if (open === wasOpen) {
        // 開いたままシートの中身が差し替わった場合、フォーカスが消えた要素に残らないようにする
        if (open && !el.contains(document.activeElement)) {
          el.setAttribute("tabindex", "-1");
          focusQuietly(el);
        }
        return;
      }
      wasOpen = open;
      open ? onOpen(el) : onClose();
    }).observe(el0, { attributes: true, attributeFilter: ["class"], childList: true });
  }

  document.addEventListener("keydown", (event) => {
    const el = sheetEl();
    if (!isOpen(el)) return;

    if (event.key === "Escape") {
      event.preventDefault();
      // 外側タップで閉じるのと同じ扱い。合成中の保護などは hideSheet 側が持っている
      if (typeof hideSheet === "function") hideSheet();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusableIn(el);
    if (!items.length) {           // 押せる要素が無いシートでは、外へ出さないことだけ守る
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    // シートの外にフォーカスがある場合は引き戻す
    if (!el.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    // 端まで来たら反対側へ回す(シートの外へ出さない)。
    // シート本体にフォーカスがある状態も、ブラウザ任せにせず明示的に先頭/末尾へ送る。
    if (!event.shiftKey && (active === last || active === el)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && (active === first || active === el)) { event.preventDefault(); last.focus(); }
  }, true);
})();

/* ===== 画面下のシートを、電卓風キーボードで隠さない =====
 * 秒数を打つときにキーボードが下から出てくると、入力欄がその裏へ入って
 * 何を打っているか見えなくなっていた。
 * キーボードの高さぶんシートを持ち上げ、打っている欄が見える位置まで送る。
 * visualViewport が無い環境(古いブラウザ)では何もしない。
 */
(() => {
  "use strict";
  const vv = window.visualViewport;
  if (!vv) return;

  function sheetEl() {
    const el = document.getElementById("sheet");
    return el && !el.classList.contains("hidden") ? el : null;
  }
  function reset(el) {
    if (!el) return;
    el.style.bottom = "";
    el.style.maxHeight = "";
  }

  function fit() {
    const el = sheetEl();
    if (!el) return;
    const active = document.activeElement;
    const typing = active && el.contains(active)
      && /^(INPUT|TEXTAREA)$/.test(active.tagName);
    // キーボードの高さ。60px未満は、閉じている時のわずかな誤差とみなす
    const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    if (!typing || keyboard < 60) return reset(el);
    el.style.bottom = `${keyboard}px`;
    el.style.maxHeight = `${Math.max(160, vv.height - 24)}px`;
    // シートの中でも、打っている欄が真ん中に来るまで送る
    active.scrollIntoView({ block: "center" });
  }

  const soon = () => setTimeout(fit, 250); // キーボードが出きるのを待つ
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  document.addEventListener("focusin", soon);
  document.addEventListener("focusout", () => setTimeout(() => {
    const el = sheetEl();
    const active = document.activeElement;
    if (!el || !active || !el.contains(active)) reset(el);
  }, 120));
})();

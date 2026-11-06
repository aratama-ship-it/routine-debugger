// Guard display and migration without inventing or removing a stored version.
function routineValid(rt) {
  const record = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  return record(rt) && validBackupId(rt.id) && typeof rt.name === "string"
    && Array.isArray(rt.versions) && rt.versions.length > 0
    && rt.versions.every((v) => record(v) && validBackupId(v.id) && Array.isArray(v.steps)
      && v.steps.every((s) => record(s) && validBackupId(s.id) && typeof s.name === "string"
        && (!s.options || (Array.isArray(s.options) && s.options.every((o) => record(o)
          && validBackupId(o.id) && typeof o.name === "string")))));
}
function unreadableRoutineCardHtml(rt, context) {
  const lang = uiLanguage();
  const text = lang === "en" ? ["This routine could not be opened", "Its stored data has been kept. Open settings to check your account or save a backup.", "Settings", "Practice", "Edit"]
    : lang === "zh" ? ["無法開啟這個演目", "已保留儲存的資料。請開啟設定以確認帳號或儲存備份。", "設定", "練習", "編輯"]
    : ["この演目を読み込めません", "保存済みの記録は残しています。設定からログイン状態の確認やバックアップの保存ができます。", "設定を開く", "練習", "編集"];
  return `<article class="routine-card routine-unreadable ${context === "home" ? "home-routine-card" : ""}">
    <div class="routine-row"><div class="name" data-user-text>${esc(routineDisplayName(rt))}</div>
      <p class="routine-unreadable-title" role="status">${text[0]}</p><p class="routine-unreadable-help">${text[1]}</p>
      <div class="actions"><button class="btn small" disabled title="${text[0]}">${text[3]}</button><button class="btn small" disabled title="${text[0]}">${text[4]}</button>
        <button class="btn small primary" onclick="openGlobalSettings()">${text[2]}</button></div></div></article>`;
}


function renderUnreadableRoutine() {
  const guardedViews = ["edit", "record", "part", "stats", "history", "stepdetail"];
  const selected = guardedViews.includes(view.name) && (state.routines || []).find((rt) => rt && rt.id === view.params.id);
  if (selected && !routineValid(selected)) {
    $app.innerHTML = `<div class="topbar"><button class="back-btn" onclick="go('home')" aria-label="${isEnglish() ? "Back" : "戻る"}"></button></div>${unreadableRoutineCardHtml(selected, "list")}`;
    applySingleDesign(); applyUiLanguage($app); return true;
  }
  return false;
}

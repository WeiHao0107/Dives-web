/* =========================================================================
 * sync.js — GitHub Gist 雲端自動同步
 *
 * 機制：所有資料打包成一份 JSON 存到使用者自己 GitHub 的「私人 Gist」。
 *   - 開啟 / 回到前景：自動 pull（遠端較新則覆蓋本機）
 *   - 資料變動：自動 push（延遲 2 秒去抖動）
 *   - 記住「上次同步時的雲端版本」(remoteTs) 與本機是否有未上傳變更 (dirty)，不靠各裝置時鐘比新舊：
 *       雲端沒變 + 本機有改 → 上傳；雲端有變 + 本機沒改 → 套用雲端；
 *       兩邊都改（衝突）→ 不覆蓋雲端：套用雲端版本，本機版本另存，設定頁可「改用本機版本」
 *   - 上傳前一定先讀雲端比對（避免一直開著的舊分頁蓋掉別台裝置的新資料）
 *
 * Token：classic personal access token，需勾選 `gist` scope。
 *   各裝置貼同一組 token 即同步同一份資料（透過固定檔名搜尋同一個 Gist）。
 *   Token 只存本機，不會寫進 Gist 內容。
 * ======================================================================= */
window.App = window.App || {};

App.Sync = (function () {
  // 會同步的資料 key（不含裝置本機快取與密鑰）
  const DATA_KEYS = ['dives_transactions', 'dives_meta', 'dives_realized', 'dives_snapshots', 'dives_account',
    'dives_cash_accounts', 'dives_liabilities', 'dives_groups', 'dives_group_map', 'dives_recurring', 'dives_dividends', 'dives_futures', 'dives_leverage'];
  const FILENAME = 'dives-portfolio.json';
  const K = { token: 'dives_sync_token', gist: 'dives_sync_gist', localTs: 'dives_sync_local_ts',
    remoteTs: 'dives_sync_remote_ts', dirty: 'dives_sync_dirty', conflict: 'dives_sync_conflict' };

  let statusCb = null;
  function onStatus(cb) { statusCb = cb; }
  function setStatus(s) { if (statusCb) statusCb(s); }

  function token() { return localStorage.getItem(K.token) || ''; }
  function enabled() { return !!token(); }
  function setToken(t) { if (t) localStorage.setItem(K.token, t); else localStorage.removeItem(K.token); }
  function gistId() { return localStorage.getItem(K.gist) || ''; }
  function setGistId(id) { if (id) localStorage.setItem(K.gist, id); else localStorage.removeItem(K.gist); }
  function localTs() { return +localStorage.getItem(K.localTs) || 0; }
  function setLocalTs(t) { localStorage.setItem(K.localTs, String(t)); }
  function lastRemote() { const v = localStorage.getItem(K.remoteTs); return v == null ? null : +v; }
  function setLastRemote(t) { localStorage.setItem(K.remoteTs, String(t)); }
  function isDirty() { return localStorage.getItem(K.dirty) === '1'; }
  function setDirty(v) { if (v) localStorage.setItem(K.dirty, '1'); else localStorage.removeItem(K.dirty); }

  // 決策（純函式，可測）：remoteTs=雲端 updatedAt（無雲端=null）；last=上次同步時的雲端版本（舊版裝置=null）
  function decide({ remoteTs, last, dirty, localTs, hasLocal }) {
    if (remoteTs == null) return (dirty || hasLocal) ? 'push' : 'none';
    if (last == null) return remoteTs > localTs ? 'apply' : (localTs > remoteTs ? 'push' : 'none'); // 舊版遷移：沿用時間比較一次
    const remoteChanged = remoteTs !== last;
    if (remoteChanged && dirty) return 'conflict';
    if (remoteChanged) return 'apply';
    return dirty ? 'push' : 'none';
  }

  function getData() {
    const data = {};
    for (const k of DATA_KEYS) { const v = localStorage.getItem(k); if (v != null) data[k] = v; }
    return data;
  }
  function applyData(data) {
    if (!data) return;
    for (const k of DATA_KEYS) { if (data[k] != null) localStorage.setItem(k, data[k]); }
  }
  function hasLocalData() {
    try { return (JSON.parse(localStorage.getItem('dives_transactions') || '[]')).length > 0; }
    catch (e) { return false; }
  }

  // ---- GitHub API（直連，CORS 支援）----
  async function gh(path, opts) {
    opts = opts || {};
    const r = await fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'Authorization': 'Bearer ' + token(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!r.ok) { const t = await r.text(); throw new Error('GitHub ' + r.status + ' ' + t.slice(0, 100)); }
    return r.status === 204 ? null : r.json();
  }

  async function findGist() {
    const id = gistId();
    if (id) { try { return await gh('/gists/' + id); } catch (e) { /* 失效則改用搜尋 */ } }
    const list = await gh('/gists?per_page=100');
    for (const g of (list || [])) {
      if (g.files && g.files[FILENAME]) { setGistId(g.id); return await gh('/gists/' + g.id); }
    }
    return null;
  }

  async function readGistContent(g) {
    const f = g.files && g.files[FILENAME];
    if (!f) return null;
    let content = f.content;
    if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
    try { return JSON.parse(content); } catch (e) { return null; }
  }

  // ---- 讀雲端：回傳 { g, remote }（無 Gist → g=null）----
  async function readRemote() {
    const g = await findGist();
    return { g, remote: g ? await readGistContent(g) : null };
  }
  async function writeRemote(id) {
    const ts = Math.max(Date.now(), (lastRemote() || 0) + 1);
    const content = JSON.stringify({ app: 'dives', version: 1, updatedAt: ts, data: getData() });
    const files = {}; files[FILENAME] = { content };
    if (id) await gh('/gists/' + id, { method: 'PATCH', body: { files } });
    else { const g = await gh('/gists', { method: 'POST', body: { description: 'Dives 投資追蹤同步資料', public: false, files } }); setGistId(g.id); }
    setLastRemote(ts); setLocalTs(ts); setDirty(false);
    return ts;
  }
  function applyRemote(remote) {
    applyData(remote.data);
    const rTs = remote.updatedAt || 0;
    setLastRemote(rTs); setLocalTs(rTs); setDirty(false);
  }
  // 衝突：本機版本另存（設定頁可改用），套用雲端
  function keepConflict(remote) {
    try { localStorage.setItem(K.conflict, JSON.stringify({ savedAt: Date.now(), data: getData() })); } catch (e) {}
    applyRemote(remote);
    if (App.Store && App.Store.pushNotification) App.Store.pushNotification({ type: 'sync', title: '同步衝突', body: '另一台裝置也改過資料，已採用雲端版本；本機版本已另存，可到 設定 › 雲端同步 改用。' });
    if (App.UI) App.UI.toast('另一台裝置也改過資料，已採用雲端版本（本機版本已另存）', 'error');
  }

  // 同步一次：讀雲端 → 依 decide 套用 / 上傳 / 衝突處理。回傳 { changed, conflict? }
  let running = null;
  function syncOnce() {
    if (!enabled()) return Promise.resolve({ changed: false });
    if (running) return running;
    running = (async () => {
      setStatus('syncing');
      try {
        const { g, remote } = await readRemote();
        const act = decide({ remoteTs: remote ? (remote.updatedAt || 0) : null, last: lastRemote(), dirty: isDirty(), localTs: localTs(), hasLocal: hasLocalData() });
        let changed = false, conflict = false;
        if (act === 'apply') { applyRemote(remote); changed = true; }
        else if (act === 'conflict') { keepConflict(remote); changed = true; conflict = true; }
        else if (act === 'push') await writeRemote(g ? g.id : '');
        else if (remote) setLastRemote(remote.updatedAt || 0);
        setStatus('synced:' + (lastRemote() || localTs()));
        return { changed, conflict };
      } catch (e) { console.warn('sync failed', e); setStatus('error:' + e.message); return { changed: false, error: e.message }; }
      finally { running = null; }
    })();
    return running;
  }
  const pushNow = syncOnce;   // 上傳也走同一流程（先比對雲端）
  const pull = syncOnce;

  let pushTimer = null;
  function schedulePush() { if (!enabled()) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => { syncOnce().then(r => { if (r.changed && App.renderCurrent) App.renderCurrent(); }); }, 2000); }
  function markDirty() { if (!enabled()) return; setDirty(true); setLocalTs(Date.now()); schedulePush(); }

  // 衝突另存的本機版本
  function conflictInfo() { try { const c = JSON.parse(localStorage.getItem(K.conflict) || 'null'); return c && c.data ? { savedAt: c.savedAt } : null; } catch (e) { return null; } }
  async function useConflictLocal() {
    const c = JSON.parse(localStorage.getItem(K.conflict) || 'null');
    if (!c || !c.data) return { ok: false };
    applyData(c.data);
    localStorage.removeItem(K.conflict);
    const { g } = await readRemote();
    await writeRemote(g ? g.id : '');  // 使用者明確選擇本機版本 → 覆蓋雲端
    return { ok: true };
  }
  function dismissConflict() { localStorage.removeItem(K.conflict); }

  // ---- 啟用 / 停用 ----
  async function enable(t) {
    setToken(t); setGistId(''); localStorage.removeItem(K.remoteTs);
    return await pull(); // 遠端有→採用較新；遠端無→以本機建立
  }
  function disable() { setToken(''); setGistId(''); [K.localTs, K.remoteTs, K.dirty].forEach(k => localStorage.removeItem(k)); }

  return { onStatus, enabled, token, gistId, getData, pull, pushNow, schedulePush, markDirty, enable, disable,
    decide, conflictInfo, useConflictLocal, dismissConflict };
})();

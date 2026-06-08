/* =========================================================================
 * sync.js — GitHub Gist 雲端自動同步
 *
 * 機制：所有資料打包成一份 JSON 存到使用者自己 GitHub 的「私人 Gist」。
 *   - 開啟 / 回到前景：自動 pull（遠端較新則覆蓋本機）
 *   - 資料變動：自動 push（延遲 2 秒去抖動）
 *   - 以 updatedAt 時間戳判斷新舊，較新者勝（last-write-wins）
 *
 * Token：classic personal access token，需勾選 `gist` scope。
 *   各裝置貼同一組 token 即同步同一份資料（透過固定檔名搜尋同一個 Gist）。
 *   Token 只存本機，不會寫進 Gist 內容。
 * ======================================================================= */
window.App = window.App || {};

App.Sync = (function () {
  // 會同步的資料 key（不含裝置本機快取與密鑰）
  const DATA_KEYS = ['dives_transactions', 'dives_meta', 'dives_realized', 'dives_snapshots', 'dives_account'];
  const FILENAME = 'dives-portfolio.json';
  const K = { token: 'dives_sync_token', gist: 'dives_sync_gist', localTs: 'dives_sync_local_ts' };

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

  // ---- 推送 ----
  async function pushNow() {
    if (!enabled()) return;
    setStatus('syncing');
    try {
      const ts = Date.now();
      setLocalTs(ts);
      const content = JSON.stringify({ app: 'dives', version: 1, updatedAt: ts, data: getData() });
      const files = {}; files[FILENAME] = { content };
      let id = gistId();
      if (!id) { const g = await findGist(); id = g ? g.id : ''; }
      if (id) await gh('/gists/' + id, { method: 'PATCH', body: { files } });
      else { const g = await gh('/gists', { method: 'POST', body: { description: 'Dives 投資追蹤同步資料', public: false, files } }); setGistId(g.id); }
      setStatus('synced:' + ts);
    } catch (e) { console.warn('push failed', e); setStatus('error:' + e.message); }
  }

  let pushTimer = null;
  function schedulePush() { if (!enabled()) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 2000); }
  function markDirty() { if (!enabled()) return; setLocalTs(Date.now()); schedulePush(); }

  // ---- 拉取（遠端較新則套用，回傳是否有變更）----
  async function pull() {
    if (!enabled()) return { changed: false };
    setStatus('syncing');
    try {
      const g = await findGist();
      if (!g) { if (hasLocalData()) await pushNow(); else setStatus('synced:' + localTs()); return { changed: false }; }
      const remote = await readGistContent(g);
      if (!remote) { if (hasLocalData()) await pushNow(); return { changed: false }; }
      const rTs = remote.updatedAt || 0;
      if (rTs > localTs()) {
        applyData(remote.data);
        setLocalTs(rTs);
        setStatus('synced:' + rTs);
        return { changed: true };
      }
      if (localTs() > rTs) { await pushNow(); return { changed: false }; }
      setStatus('synced:' + (rTs || localTs()));
      return { changed: false };
    } catch (e) { console.warn('pull failed', e); setStatus('error:' + e.message); return { changed: false, error: e.message }; }
  }

  // ---- 啟用 / 停用 ----
  async function enable(t) {
    setToken(t); setGistId('');
    return await pull(); // 遠端有→採用較新；遠端無→以本機建立
  }
  function disable() { setToken(''); setGistId(''); localStorage.removeItem(K.localTs); }

  return { onStatus, enabled, token, gistId, getData, pull, pushNow, schedulePush, markDirty, enable, disable };
})();

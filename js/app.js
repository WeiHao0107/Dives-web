/* =========================================================================
 * app.js — 主控制器：分頁路由、報價刷新、初始化
 * ======================================================================= */
(function () {
  const V = App.Views, S = App.Store, C = App.Calc, UI = App.UI, Api = App.Api;

  let currentTab = 'portfolio';
  const TABS = [
    { id: 'portfolio', label: '持倉', icon: '📊' },
    { id: 'history', label: '歷史', icon: '📈' },
    { id: 'report', label: '報表', icon: '📋' },
    { id: 'settings', label: '設定', icon: '⚙️' },
  ];

  function renderCurrent() {
    const root = document.getElementById('view');
    if (!root) return;
    root.scrollTop = 0;
    switch (currentTab) {
      case 'portfolio': V.portfolio(root); break;
      case 'history': V.history(root); break;
      case 'report': V.report(root); break;
      case 'settings': V.settings(root); break;
    }
    // FAB 只在持倉頁顯示
    document.getElementById('fab').style.display = currentTab === 'portfolio' ? 'flex' : 'none';
    // tab bar 高亮
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === currentTab));
    updateHeader();
  }

  function switchTab(id) { currentTab = id; renderCurrent(); }

  function updateHeader() {
    const ts = S.getPricesTs();
    const el = document.getElementById('last-updated');
    if (el) el.textContent = ts ? ('更新於 ' + new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })) : '';
  }

  // 報價刷新
  let refreshing = false;
  async function refresh(symbols, doSync) {
    if (refreshing) return;
    refreshing = true;
    const btn = document.getElementById('refresh-btn');
    btn && btn.classList.add('spin');
    try {
      // 手動重新整理時先做雲端同步（雙向：遠端較新則拉、本機較新則推）
      if (doSync && App.Sync && App.Sync.enabled()) {
        const r = await App.Sync.pull();
        if (r.changed) renderCurrent();
      }
      await Api.refreshPrices(symbols);
      const isNewDay = C.saveTodaySnapshot();
      if (isNewDay && App.Sync) App.Sync.markDirty(); // 新的一天快照 → 同步
      renderCurrent();
    } catch (e) {
      console.error(e); UI.toast('報價更新失敗', 'error');
    } finally {
      refreshing = false;
      btn && btn.classList.remove('spin');
      updateHeader();
    }
  }

  // 資料變動後：重算今日快照、雲端同步、重繪、背景刷新指定報價
  function afterDataChange(symbolsToRefresh) {
    C.saveTodaySnapshot();
    if (App.Sync) App.Sync.markDirty(); // 使用者動作 → 推送雲端
    renderCurrent();
    if (symbolsToRefresh === undefined) symbolsToRefresh = null; // null = 全部
    refresh(symbolsToRefresh && symbolsToRefresh.length ? symbolsToRefresh : undefined);
  }

  // 對外
  App.renderCurrent = renderCurrent;
  App.afterDataChange = afterDataChange;
  App.switchTab = switchTab;
  App.refresh = refresh;

  // 初始化
  function init() {
    // tab bar 事件
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));
    document.getElementById('fab').addEventListener('click', () => V.openTxForm(null));
    document.getElementById('refresh-btn').addEventListener('click', () => refresh(undefined, true));

    // 從快取立即顯示
    renderCurrent();

    // App 鎖定：啟用則先顯示鎖定畫面，解鎖後才進背景作業
    if (App.Auth && App.Auth.isEnabled()) {
      App.Auth.showLock(startBackground);
    } else {
      startBackground();
    }

    // 回到前景：背景超過逾時則重新鎖定，否則同步 + 視情況刷新
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'hidden') { if (App.Auth) App.Auth.noteHidden(); return; }
      if (App.Auth && App.Auth.shouldRelock()) {
        App.Auth.showLock(() => { foregroundSync(); });
        return;
      }
      foregroundSync();
    });

    // 註冊 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // 啟動後的背景作業：雲端拉取 + 報價刷新 + 預載台股代碼表
  function startBackground() {
    (async () => {
      if (App.Sync && App.Sync.enabled()) {
        const r = await App.Sync.pull();
        if (r.changed) renderCurrent();
      }
      const hasTx = S.getTransactions().length > 0;
      if (hasTx) refresh();
      Api.loadTwUniverse(false).catch(() => {});
    })();
  }

  async function foregroundSync() {
    if (App.Sync && App.Sync.enabled()) {
      const r = await App.Sync.pull();
      if (r.changed) renderCurrent();
    }
    const ts = S.getPricesTs();
    if (!ts || Date.now() - ts > 600000) refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

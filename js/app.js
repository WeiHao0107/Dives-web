/* =========================================================================
 * app.js — 主控制器：分頁路由、報價刷新、初始化
 * ======================================================================= */
(function () {
  const V = App.Views, S = App.Store, C = App.Calc, UI = App.UI, Api = App.Api;
  App.VERSION = 'v144';

  const TAB_ORDER = ['assets', 'portfolio', 'report', 'history', 'settings'];
  // 記住當前分頁，避免重新整理/下拉時跳回資產
  let currentTab = (() => { try { return sessionStorage.getItem('dives_tab') || 'assets'; } catch (e) { return 'assets'; } })();
  const TABS = [
    { id: 'portfolio', label: '持倉', icon: '📊' },
    { id: 'report', label: '報表', icon: '📋' },
    { id: 'history', label: '歷史', icon: '📈' },
    { id: 'settings', label: '設定', icon: '⚙️' },
  ];

  let slideDir = null; // 換分頁時的滑入方向（next=從右、prev=從左）
  function renderTab(root, tab) {
    switch (tab) {
      case 'portfolio': V.portfolio(root); break;
      case 'assets': V.assets(root); break;
      case 'history': V.history(root); break;
      case 'report': V.report(root); break;
      case 'settings': V.settings(root); break;
    }
  }
  function renderCurrent() {
    const root = document.getElementById('view');
    if (!root) return;
    root.scrollTop = 0;
    renderTab(root, currentTab);
    // 換分頁 → 讓新內容依方向滑入（點 tab bar 用；滑動換頁不套此動畫）
    if (slideDir && root.firstElementChild) {
      root.firstElementChild.classList.add(slideDir === 'next' ? 'tab-slide-next' : 'tab-slide-prev');
    }
    slideDir = null;
    // tab bar 高亮
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === currentTab));
    updateHeader();
  }

  function switchTab(id) {
    const from = TAB_ORDER.indexOf(currentTab), to = TAB_ORDER.indexOf(id);
    slideDir = (from >= 0 && to >= 0 && to !== from) ? (to > from ? 'next' : 'prev') : null;
    currentTab = id;
    try { sessionStorage.setItem('dives_tab', id); } catch (e) {}
    renderCurrent();
  }
  function goTab(id) { if (id === 'assets' && V.resetAssetsNav) V.resetAssetsNav(); if (id === 'report' && V.resetReportNav) V.resetReportNav(); if (id === 'portfolio' && V.resetPortfolioNav) V.resetPortfolioNav(); if (id === 'settings' && V.resetSettingsNav) V.resetSettingsNav(); switchTab(id); }

  // 左右滑：互動式換頁（內容跟著手指移動，放開時吸附到新頁或回彈）
  function initSwipe() {
    const view = document.getElementById('view');
    if (!view) return;
    const IGNORE = '.chart-host, .chips, input, select, textarea, .switch';
    let sx = 0, sy = 0, t0 = 0, decided = false, horiz = false, dir = 0, neighbor = null, track = null, curPane = null, edge = false, W = 0;

    const rest = () => dir > 0 ? 0 : -W;          // 靜止（顯示當前頁）
    const full = () => dir > 0 ? -W : 0;          // 完全顯示鄰頁
    const clampX = x => Math.max(-W, Math.min(0, x));
    const setX = x => { track.style.transform = 'translateX(' + x + 'px)'; };

    function build() {
      W = view.clientWidth || window.innerWidth;
      const cur = view.firstElementChild;
      track = document.createElement('div'); track.className = 'pager-track';
      curPane = document.createElement('div'); curPane.className = 'pager-pane';
      const nb = document.createElement('div'); nb.className = 'pager-pane';
      if (neighbor != null) { try { renderTab(nb, TAB_ORDER[neighbor]); } catch (e) {} }
      if (dir > 0) { curPane.appendChild(cur); track.append(curPane, nb); }   // next：當前在左、鄰頁在右
      else { track.append(nb, curPane); curPane.appendChild(cur); }           // prev：鄰頁在左、當前在右
      view.appendChild(track);
      setX(rest());
    }

    function settle(commit) {
      if (!track) return;
      const t = track;
      t.classList.add('animating');
      setX(commit ? full() : rest());
      const done = () => {
        t.removeEventListener('transitionend', done);
        if (track !== t) return;
        if (commit && neighbor != null) {
          const tab = TAB_ORDER[neighbor];
          if (tab === 'assets' && V.resetAssetsNav) V.resetAssetsNav();
          if (tab === 'report' && V.resetReportNav) V.resetReportNav();
          if (tab === 'portfolio' && V.resetPortfolioNav) V.resetPortfolioNav();
          if (tab === 'settings' && V.resetSettingsNav) V.resetSettingsNav();
          currentTab = tab; try { sessionStorage.setItem('dives_tab', tab); } catch (e) {}
          t.remove();
          renderCurrent();                          // slideDir 為 null → 不再疊加動畫
        } else {
          const c = curPane && curPane.firstElementChild;
          t.remove(); if (c) view.appendChild(c);   // 回彈：把原內容放回
        }
        track = null; curPane = null; decided = false; horiz = false; neighbor = null; edge = false;
      };
      t.addEventListener('transitionend', done);
      window.setTimeout(() => { if (track === t) done(); }, 340); // 保險（transitionend 未觸發時）
    }

    view.addEventListener('touchstart', e => {
      if (track) return;
      decided = false; horiz = false; edge = false;
      if (e.touches.length !== 1 || (e.target.closest && e.target.closest(IGNORE))) { decided = true; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = e.timeStamp;
    }, { passive: true });

    view.addEventListener('touchmove', e => {
      if (decided && !horiz) return;                // 已判定為垂直/忽略 → 交給原生捲動
      if (track && horiz) {
        e.preventDefault();
        const dx = e.touches[0].clientX - sx;
        setX(clampX(rest() + (edge ? dx * 0.32 : dx)));
        return;
      }
      if (!decided) {
        const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) { decided = true; return; } // 垂直為主 → 放行捲動
        decided = true; horiz = true;
        dir = dx < 0 ? 1 : -1;
        const n = TAB_ORDER.indexOf(currentTab) + dir;
        if (n < 0 || n >= TAB_ORDER.length) { neighbor = null; edge = true; } else neighbor = n;
        build();
        e.preventDefault();
        setX(clampX(rest() + (edge ? dx * 0.32 : dx)));
      }
    }, { passive: false });

    view.addEventListener('touchend', e => {
      if (!track || !horiz) { decided = false; horiz = false; return; }
      const dx = (e.changedTouches ? e.changedTouches[0].clientX : sx) - sx;
      const v = dx / Math.max(1, e.timeStamp - t0); // px/ms
      let commit = false;
      if (!edge && neighbor != null) {
        const far = Math.abs(dx) > W * 0.28;
        const flick = Math.abs(v) > 0.5 && ((dir > 0 && dx < 0) || (dir < 0 && dx > 0));
        commit = far || flick;
      }
      settle(commit);
    }, { passive: true });

    view.addEventListener('touchcancel', () => {
      if (track) settle(false); else { decided = false; horiz = false; }
    }, { passive: true });
  }

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
      futuresAlerts();
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

  // 重建歷史走勢：用交易 + 台股歷史收盤回推每日快照
  async function rebuildHistory() {
    const txs = S.getTransactions();
    const ftrades = App.Futures ? App.Futures.getState().trades : [];
    if (!txs.length && !ftrades.length) { UI.toast('尚無交易可重建', 'info'); return 0; }
    // 手續費防呆（SPEC I7）：異常手續費會讓成本爆掉、報表失真 → 明確指出是哪幾檔
    const badFees = C.findAbsurdFees(txs);
    if (badFees.length) {
      const syms = [...new Set(badFees.map(b => b.symbol))].join('、');
      UI.toast(`⚠️ ${syms} 手續費異常偏高，報表恐失真，請檢查交易紀錄`, 'error');
    }
    const mmap = S.metaMap();
    const firstTime = Math.min(...txs.map(t => t.time), ...ftrades.map(t => t.time));
    const firstDate = App.Util.isoDate(new Date(firstTime));
    const fkeys = [...new Set(ftrades.map(t => t.contract + '@' + t.month))];   // 期貨各持有月份的日結算
    const all = [...new Set(txs.map(t => t.symbol))];
    const mkOf = c => App.Util.normalizeMarketKey((mmap[c] && mmap[c].market) || App.Util.guessMarketBySymbol(c));
    const twCodes = all.filter(c => mkOf(c) !== App.Util.Market.us && mkOf(c) !== App.Util.Market.crypto);
    const usCodes = all.filter(c => mkOf(c) === App.Util.Market.us);
    const cryptoCodes = all.filter(c => mkOf(c) === App.Util.Market.crypto);
    await Api.fetchFx();
    const [twHist, usHist, cryptoHist, futHist] = await Promise.all([
      Api.fetchTwHistory(twCodes, firstDate),
      Api.fetchUsHistory(usCodes, firstDate),
      Api.fetchCryptoHistory(cryptoCodes, firstDate),
      Api.fetchFuturesHistory(fkeys, firstDate),
    ]);
    const n = C.rebuildSnapshots(Object.assign({}, twHist, usHist, cryptoHist), S.getFxRate(), futHist);
    C.saveTodaySnapshot();          // 今天用即時價覆蓋
    if (App.Sync) App.Sync.markDirty();
    renderCurrent();
    return n;
  }

  // 期貨：每日一次抓期交所保證金（marginAuto 開啟且有期貨資料時）；失敗保留原值；有變動則通知
  async function maybeUpdateMargins() {
    if (!App.Futures) return;
    const st = App.Futures.getState();
    if (!st.marginAuto || (!st.trades.length && !st.accountId)) return;
    const today = App.Util.isoDate();
    if (localStorage.getItem('dives_fut_margin_date') === today) return;
    const r = await Api.fetchTaifexMargins();
    if (!r) return;
    localStorage.setItem('dives_fut_margin_date', today);
    const cur = App.Futures.getState();
    const changed = App.Futures.CONTRACTS.some(c => r.margin[c] && (r.margin[c].init !== cur.margin[c].init || r.margin[c].maint !== cur.margin[c].maint));
    for (const c of App.Futures.CONTRACTS) if (r.margin[c]) cur.margin[c] = r.margin[c];
    if (r.date) cur.marginDate = r.date;
    App.Futures.saveState(cur);
    if (App.Sync) App.Sync.markDirty();
    if (changed) {
      S.pushNotification({ type: 'fut', key: 'fut-margin:' + (r.date || today), title: '期交所保證金已調整',
        body: '大台 ' + App.Util.fmtWhole(cur.margin.TX.init) + ' / ' + App.Util.fmtWhole(cur.margin.TX.maint) });
      renderCurrent();
    }
  }
  // 期貨提醒：到期前 7 天（每部位一次）、風險指標 < 100%（每日一次）
  function futuresAlerts() {
    if (!App.Futures) return;
    const st = App.Futures.getState();
    if (!st.trades.length) return;
    const f = App.Futures.summary(st, S.getPrices(), null);
    const today = App.Util.isoDate();
    if (st.alerts.expiry) for (const p of f.positions) {
      const days = Math.round((Date.parse(p.expiry + 'T00:00:00+08:00') - Date.parse(today + 'T00:00:00+08:00')) / 864e5);
      if (days >= 0 && days <= 7) S.pushNotification({ type: 'fut', key: 'fut-exp:' + p.key,
        title: App.Futures.LABEL[p.contract] + ' ' + p.month + ' 還有 ' + days + ' 天到期', body: '到期 ' + p.expiry + '，記得轉倉' });
    }
    if (st.alerts.risk && f.risk != null && f.risk < 1) S.pushNotification({ type: 'fut', key: 'fut-risk:' + today,
      title: '期貨風險指標 ' + Math.round(f.risk * 100) + '%', body: '權益數 ' + App.Util.fmtWhole(f.equity) + '，低於原始保證金' });
  }

  // 缺漏的「交易日(週間)」天數：從最早快照到今天，扣掉週末後仍沒有快照的天數
  function snapshotGapDays() {
    const snaps = S.getSnapshots();
    if (!snaps.length) return 0;
    const have = new Set(snaps.map(s => s.date));
    const min = snaps.reduce((a, s) => (s.date < a ? s.date : a), snaps[0].date);
    const today = App.Util.isoDate();
    let gap = 0;
    const cur = new Date(min + 'T12:00:00+08:00'), end = new Date(today + 'T12:00:00+08:00');
    while (cur <= end) {
      if (!App.Util.isWeekend(cur) && !have.has(App.Util.isoDate(cur))) gap++;
      cur.setDate(cur.getDate() + 1);
    }
    return gap;
  }
  // 登入後自動補齊：每天最多檢查一次；有缺（沒開 App 的那些交易日）就用收盤價補回
  async function maybeBackfill() {
    try {
      if (!navigator.onLine || !S.getTransactions().length) return;
      const today = App.Util.isoDate();
      if (localStorage.getItem('dives_backfill_date') === today) return; // 今天已檢查過
      const gap = snapshotGapDays();
      if (gap <= 0) { localStorage.setItem('dives_backfill_date', today); return; } // 無缺口
      await rebuildHistory();                                    // 用收盤價重建，填平缺口
      localStorage.setItem('dives_backfill_date', today);
      UI.toast(`已自動補齊 ${gap} 天歷史`, 'success');
    } catch (e) { console.warn('auto backfill failed', e); }
  }

  // 執行定期定額 / 定期繳款：把每個啟用計畫「已到期未執行」的期數補上
  //   DCA → 抓歷史日線，用該日開/收價建立買入（股數 = 金額 ÷ 價），連動扣款帳戶
  //   liability → 依期數對負債扣款（同步扣現金帳戶）
  //   lastRun 前移避免重複；抓不到價則停在上一個成功日，下次啟動再補
  async function runRecurringPlans() {
    const plans = S.getRecurringPlans();
    if (!plans.length) return 0;
    const today = App.Util.isoDate();
    let created = 0, changed = false;
    const touched = [];
    for (const plan of plans) {
      if (!plan || plan.enabled === false) continue;
      const dues = C.recurringDueDates(plan, today);
      if (!dues.length) continue;
      if (plan.kind === 'liability') {
        let done = null;
        for (const d of dues) {
          const r = C.applyLiabilityPayment(plan.liabilityId, plan.amount, plan.accountId || null);
          if (!r.ok) break; // 負債不存在或已清零 → 停
          created++; done = d;
        }
        if (done && done !== plan.lastRun) { plan.lastRun = done; changed = true; }
      } else {
        const from = C.isoAddDays(dues[0], -10); // 往前 10 天確保有收盤價可用
        let series = [];
        try { series = await Api.fetchDailySeries(plan.market, plan.symbol, from); } catch (e) { series = []; }
        let done = plan.lastRun || null;
        for (const d of dues) {
          const px = C.priceOnOrBefore(series, d, plan.priceBasis || 'close');
          if (!(px > 0)) break;               // 抓不到價 → 停,下次再補
          const shares = plan.amount / px;
          if (!(shares > 0)) break;
          const fee = C.planFee(plan, plan.amount);
          const time = new Date(d + 'T12:00:00+08:00').getTime();
          const r = C.addTransaction({ symbolInput: plan.symbol, type: 'BUY', shares, price: px, fee, market: plan.market, name: plan.name, accountId: plan.accountId || undefined, time, source: 'dca' });
          if (!r.ok) break;
          created++; touched.push(plan.symbol); done = d;
        }
        if (done && done !== plan.lastRun) { plan.lastRun = done; changed = true; }
      }
    }
    if (changed) S.setRecurringPlans(plans);
    if (created > 0) { C.saveTodaySnapshot(); if (App.Sync) App.Sync.markDirty(); }
    return created;
  }

  // 全自動匯入股利（設定預設開啟，每日掃描一次；force 可立即重掃）
  //   台股：FinMind 股利政策(免金鑰) → 現金以「發放日」入帳台幣帳戶、配股以「除權日」加股
  //   美股：Finnhub /stock/dividend(需自填金鑰才生效) → 稅前×(1−預扣稅率)=稅後淨額(USD)入帳美金帳戶
  //   金額：依除息日當時持股計算；未設定帳戶 → 只記收益
  //   去重：同標的＋除息日已有紀錄(或發放日±7天)略過；多裝置靠已同步的股利紀錄防重複
  //   另推播通知：股息入帳/配股、以及 7 天內即將除息(除權)提醒
  async function autoImportDividends(force) {
    const twOn = S.getAutoDivImport();
    const usOn = S.getAutoDivUs() && !!Api.finnhubKey(); // 美股前提:有 Finnhub 金鑰
    if (!twOn && !usOn) return 0;
    const today = App.Util.isoDate();
    if (!force && localStorage.getItem('dives_autodiv_date') === today) return 0; // 每日一次
    localStorage.setItem('dives_autodiv_date', today);
    const mmap = S.metaMap();
    const mkOf = sym => App.Util.normalizeMarketKey(mmap[sym]?.market || App.Util.guessMarketBySymbol(sym));
    const isTw = sym => { const m = mkOf(sym); return m !== App.Util.Market.us && m !== App.Util.Market.crypto; };
    const txs = S.getTransactions();
    const twSyms = twOn ? [...new Set(txs.filter(t => isTw(t.symbol)).map(t => t.symbol))] : [];
    const usSyms = usOn ? [...new Set(txs.filter(t => mkOf(t.symbol) === App.Util.Market.us).map(t => t.symbol))] : [];
    if (!twSyms.length && !usSyms.length) return 0;
    const firstDate = {};
    for (const t of txs) { const d = App.Util.isoDate(new Date(t.time)); if (!firstDate[t.symbol] || d < firstDate[t.symbol]) firstDate[t.symbol] = d; }
    const dayDiff = (a, b) => Math.abs((new Date(a + 'T00:00:00+08:00') - new Date(b + 'T00:00:00+08:00')) / 864e5);
    const twAcct = S.getCashAccounts().find(x => x.id === S.getAutoDivAcct() && x.currency === 'TWD');
    const usAcct = S.getCashAccounts().find(x => x.id === S.getAutoDivAcctUs() && x.currency === 'USD');
    const usTax = S.getAutoDivUsTax();
    const in7 = C.isoAddDays(today, 7);
    const ps2 = v => Math.round(v * 100) / 100;
    let imported = 0; const details = []; const touched = new Set();

    // ── 台股（FinMind）──
    for (const sym of twSyms) {
      let events = [];
      try { events = await Api.fetchTwDividends(sym, firstDate[sym]); } catch (e) { events = []; }
      const divs = S.getDividends();
      const stockTxs = S.getTransactions().filter(t => t.type === 'STOCK_DIV');
      const name = mmap[sym]?.name || sym, market = mmap[sym]?.market || 'tse';
      for (const ev of events) {
        // 即將除息/除權提醒（7 天內、目前仍有持股；key 去重不重複提醒）
        if (ev.exDate > today) {
          if (ev.exDate <= in7 && C.sharesHeldBefore(sym, '9999-12-31') > 0) {
            S.pushNotification({ type: 'exdiv', key: 'exdiv:' + sym + ':' + ev.exDate + ':' + ev.type,
              title: sym + ' ' + name + ' 即將' + (ev.type === 'cash' ? '除息' : '除權'),
              body: ev.exDate + '・每股 ' + ps2(ev.perShare) + ' 元' });
          }
          continue;
        }
        const shares = C.sharesHeldBefore(sym, ev.exDate);
        if (!(shares > 0)) continue;
        if (ev.type === 'cash') {
          if (ev.payDate > today) continue; // 未到發放日
          if (divs.some(d => d.symbol === sym && (d.exDate === ev.exDate || dayDiff(d.date, ev.payDate) <= 7))) continue;
          const amount = ps2(ev.perShare * shares);
          const r = C.addDividend({ symbolInput: sym, market, name, amount, date: ev.payDate, accountId: twAcct ? twAcct.id : undefined, exDate: ev.exDate, note: '自動匯入' });
          if (r.ok) { imported++; touched.add(sym); details.push({ kind: 'cash', sym, name, amount, payDate: ev.payDate, acctName: twAcct ? twAcct.name : null }); }
        } else {
          if (stockTxs.some(t => t.symbol === sym && dayDiff(App.Util.isoDate(new Date(t.time)), ev.exDate) <= 7)) continue;
          const cs = ps2(shares * ev.perShare / 10); // 配股率 = 每股股票股利(元)/面額10
          if (!(cs > 0)) continue;
          const r = C.addStockDividend({ symbolInput: sym, market, name, shares: cs, date: ev.exDate });
          if (r.ok) { imported++; touched.add(sym); details.push({ kind: 'stock', sym, name, shares: cs, exDate: ev.exDate }); }
        }
      }
    }

    // ── 美股（Finnhub，稅後淨額入帳）──
    for (const sym of usSyms) {
      let events = [];
      try { events = await Api.fetchUsDividends(sym, firstDate[sym]); } catch (e) { events = []; }
      const divs = S.getDividends();
      const name = mmap[sym]?.name || sym;
      for (const ev of events) {
        if (ev.exDate > today) {
          if (ev.exDate <= in7 && C.sharesHeldBefore(sym, '9999-12-31') > 0) {
            S.pushNotification({ type: 'exdiv', key: 'exdiv:' + sym + ':' + ev.exDate + ':cash',
              title: sym + ' ' + name + ' 即將除息', body: ev.exDate + '・每股 $' + ps2(ev.perShare) });
          }
          continue;
        }
        const shares = C.sharesHeldBefore(sym, ev.exDate);
        if (!(shares > 0)) continue;
        if (ev.payDate > today) continue;
        if (divs.some(d => d.symbol === sym && (d.exDate === ev.exDate || dayDiff(d.date, ev.payDate) <= 7))) continue;
        const amount = ps2(ev.perShare * shares * (1 - usTax / 100)); // 稅後淨額(USD)
        if (!(amount > 0)) continue;
        const r = C.addDividend({ symbolInput: sym, market: 'us', name, amount, date: ev.payDate, accountId: usAcct ? usAcct.id : undefined, exDate: ev.exDate, note: '自動匯入(稅後' + usTax + '%)' });
        if (r.ok) { imported++; touched.add(sym); details.push({ kind: 'cash', us: true, sym, name, amount, payDate: ev.payDate, acctName: usAcct ? usAcct.name : null }); }
      }
    }

    if (imported > 0) {
      const money = d => d.us ? '$' + App.Util.formatPrice(d.amount) : 'NT$ ' + App.Util.fmtWhole(d.amount);
      if (imported <= 4) { // 少量逐筆通知;首次大量回補則彙總一則
        for (const d of details) S.pushNotification(d.kind === 'cash'
          ? { type: 'div', title: d.sym + ' ' + d.name + ' 股息入帳 ' + money(d), body: (d.acctName ? '已入帳 ' + d.acctName + '・' : '') + '發放日 ' + d.payDate }
          : { type: 'div', title: d.sym + ' ' + d.name + ' 配股 +' + App.Util.formatShares(d.shares) + ' 股', body: '除權日 ' + d.exDate });
      } else {
        const twSum = details.filter(d => d.kind === 'cash' && !d.us).reduce((s, d) => s + d.amount, 0);
        const usSum = details.filter(d => d.kind === 'cash' && d.us).reduce((s, d) => s + d.amount, 0);
        const parts = [];
        if (twSum > 0) parts.push('台股 NT$ ' + App.Util.fmtWhole(twSum));
        if (usSum > 0) parts.push('美股 $' + App.Util.formatPrice(usSum));
        S.pushNotification({ type: 'div', title: '自動匯入 ' + imported + ' 筆股利', body: parts.join('・') });
      }
      C.saveTodaySnapshot();
      if (App.Sync) App.Sync.markDirty();
    }
    return imported;
  }

  // 載入示範資料（測試用）：現金/負債/台美股+加密/群組/120 天歷史快照
  function seedDemo() {
    const U = App.Util;
    S.clearAll();
    S.setFxRate(31.876);
    S.setCashAccounts([
      { id: S.uuid(), name: 'Firstrade', currency: 'USD', balance: 702 },
      { id: S.uuid(), name: '美金', currency: 'USD', balance: 23 },
      { id: S.uuid(), name: '台幣', currency: 'TWD', balance: 887000 },
    ]);
    S.setLiabilities([{ id: S.uuid(), name: '富邦信貸', currency: 'TWD', balance: 1816358 }]);
    const add = (sym, market, name, shares, price) => {
      S.upsertMeta([{ code: sym, name, market }]);
      C.addTransaction({ symbolInput: sym, type: 'BUY', shares, price, fee: 0, market, name });
    };
    add('2330', 'tse', '台積電', 500, 1800);
    add('0050', 'tse', '元大台灣50', 10000, 150);
    add('2454', 'tse', '聯發科', 100, 1100);
    add('TSLA', 'us', 'Tesla', 130, 300);
    add('GOOGL', 'us', 'Alphabet', 150, 250);
    add('NVDA', 'us', 'NVIDIA', 170, 120);
    add('AAPL', 'us', 'Apple', 50, 180);
    add('BTC', 'crypto', 'Bitcoin', 0.5, 55000);
    add('ETH', 'crypto', 'Ethereum', 3, 2500);
    // 交易日期散布在過去數月，讓群組走勢圖能畫出真實曲線（否則全部同一天＝1 個點）
    const DAY = 86400000, agoBy = { '2330': 165, '0050': 150, '2454': 80, TSLA: 140, GOOGL: 120, NVDA: 95, AAPL: 70, BTC: 60, ETH: 45 };
    S.setTransactions(S.getTransactions().map(t => Object.assign({}, t, { time: Date.now() - (agoBy[t.symbol] || 100) * DAY })));
    S.setPrices({
      '2330': { price: 2505, dailyChange: 20, prevClose: 2485 },
      '0050': { price: 185, dailyChange: 1, prevClose: 184 },
      '2454': { price: 1300, dailyChange: -10, prevClose: 1310 },
      TSLA: { price: 425.3, dailyChange: 5, prevClose: 420.3 },
      GOOGL: { price: 361.21, dailyChange: -2, prevClose: 363.21 },
      NVDA: { price: 197.58, dailyChange: 1.5, prevClose: 196.08 },
      AAPL: { price: 307, dailyChange: -3, prevClose: 310 },
      BTC: { price: 61000, dailyChange: 800, prevClose: 60200 },
      ETH: { price: 2600, dailyChange: -50, prevClose: 2650 },
    });
    // 期貨：保證金帳戶 + 大台 2 口（一次轉倉 202609 → 202610）
    const mAcct = { id: S.uuid(), name: '期貨保證金', currency: 'TWD', balance: 2150000 };
    S.setCashAccounts([...S.getCashAccounts(), mAcct]);
    S.setFutures({ accountId: mAcct.id });
    App.Futures.addTrade({ contract: 'TX', month: '202609', side: 'BUY', lots: 2, price: 45120, time: Date.now() - 60 * DAY });
    App.Futures.rollover({ contract: 'TX', month: '202609', toMonth: '202610', lots: 2, closePrice: 46300, openPrice: 46215, time: Date.now() - 1 * DAY });
    const pz = S.getPrices(); pz['FUT:TX@202610'] = { price: 46764, dailyChange: 305, prevClose: 46459 }; S.setPrices(pz);
    const g1 = { id: S.uuid(), name: '核心持股' }, g2 = { id: S.uuid(), name: 'ETF' }, g3 = { id: S.uuid(), name: '小倉位' };
    S.setGroups([g1, g2, g3]);
    S.setGroupMap({ TSLA: g1.id, GOOGL: g1.id, NVDA: g1.id, '2330': g1.id, '0050': g2.id, '2454': g3.id });
    // 120 天歷史快照
    const snaps = [], days = 120, base = Date.now() - (days - 1) * 86400000, cash = 910110, liab = 1816358;
    for (let i = 0; i < days; i++) {
      const d = new Date(base + i * 86400000), t = i / (days - 1);
      const tw = 2200000 + 1032500 * t + Math.sin(i / 7) * 120000;
      const us = 3200000 + 1849400 * t + Math.sin(i / 9) * 200000;
      const cr = 700000 + 520800 * t + Math.cos(i / 5) * 90000;
      const mv = tw + us + cr;
      snaps.push({
        date: U.isoDate(d), twMarketValue: tw, usMarketValueTwd: us, cryptoMarketValueTwd: cr,
        totalMarketValueTwd: mv, netAsset: mv, marketValue: mv, cashBalance: 0, dayPnl: 0,
        totalCostBasisTwd: mv * 0.7, totalPnl: mv * 0.3, realizedPnl: 50000, unrealizedPnl: mv * 0.3 - 50000, totalReturnPct: 42,
        twCostBasis: tw * 0.6, usCostBasisTwd: us * 0.75, twUnrealizedPnl: tw * 0.4, usUnrealizedPnlTwd: us * 0.25,
        twRealizedPnl: 30000, usRealizedPnlTwd: 20000, twTotalPnl: tw * 0.4 + 30000, usTotalPnlTwd: us * 0.25 + 20000,
        twReturnPct: 66, usReturnPct: 33, cryptoCostBasisTwd: cr * 0.8, cryptoUnrealizedPnlTwd: cr * 0.2,
        cryptoRealizedPnlTwd: 0, cryptoTotalPnlTwd: cr * 0.2,
        cashAccountsTwd: cash, liabilitiesTwd: liab, netWorth: mv + cash - liab, createdAt: Date.now(),
      });
    }
    S.setSnapshots(snaps);
    C.saveTodaySnapshot();
    if (App.Sync) App.Sync.markDirty();
    renderCurrent();
  }

  // 對外
  App.renderCurrent = renderCurrent;
  App.afterDataChange = afterDataChange;
  App.switchTab = switchTab;
  App.refresh = refresh;
  App.rebuildHistory = rebuildHistory;
  App.snapshotGapDays = snapshotGapDays;
  App.maybeBackfill = maybeBackfill;
  App.runRecurringPlans = runRecurringPlans;
  App.autoImportDividends = autoImportDividends;
  App.seedDemo = seedDemo;

  // 初始化
  // ---- 外觀主題：套用設定(auto 跟隨系統) + 同步狀態列顏色 ----
  function applyTheme() {
    const pref = S.getTheme();
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#141312' : '#FAFAF9');
  }
  App.applyTheme = applyTheme;

  function init() {
    // 外觀：套用主題;auto 模式下跟隨系統即時切換
    applyTheme();
    try {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChg = () => { if (S.getTheme() === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChg); else mq.addListener(onChg);
    } catch (e) {}

    // tab bar 事件（點資產 tab 時退回資產首頁）
    document.querySelectorAll('.tab-btn').forEach(b =>
      b.addEventListener('click', () => {
        if (b.dataset.tab === 'assets' && V.resetAssetsNav) V.resetAssetsNav();
        if (b.dataset.tab === 'report' && V.resetReportNav) V.resetReportNav();
        if (b.dataset.tab === 'portfolio' && V.resetPortfolioNav) V.resetPortfolioNav();
        if (b.dataset.tab === 'settings' && V.resetSettingsNav) V.resetSettingsNav();
        switchTab(b.dataset.tab);
      }));

    // 左右滑切換分頁
    initSwipe();

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
        // 鎖定畫面已在顯示就不重複呼叫（避免蓋掉解鎖 callback / 重觸發驗證）
        if (!document.getElementById('lock-overlay')) App.Auth.showLock(() => { foregroundSync(); });
        return;
      }
      foregroundSync();
    });

    // 註冊 Service Worker；新版接管時自動重載一次，更新立即生效
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return; // 首次安裝不重載，避免迴圈
        // 有開 App 鎖定時不自動重載：重載會再觸發一次 Face ID（造成開啟需驗證兩次）。
        // 網路優先已確保內容最新，新版 SW 會在下次啟動接管。
        if (App.Auth && App.Auth.isEnabled()) return;
        reloaded = true;
        window.location.reload();
      });
    }
  }

  // 啟動後的背景作業：雲端拉取 + 報價刷新 + 預載台股代碼表
  function startBackground() {
    (async () => {
      if (App.Sync && App.Sync.enabled()) {
        const r = await App.Sync.pull();
        if (r.changed) renderCurrent();
      }
      // 定期定額/繳款：拉取雲端後執行（lastRun 已同步 → 不會多裝置重複扣）
      try {
        const n = await runRecurringPlans();
        // 有回補歷史日期的買入 → 重建走勢讓歷史快照反映；rebuildHistory 內含 renderCurrent
        if (n > 0) {
          S.pushNotification({ type: 'recurring', title: '定期計畫已執行', body: '自動新增 ' + n + ' 筆買入/繳款' });
          await rebuildHistory(); UI.toast(`定期計畫已執行，新增 ${n} 筆`, 'success');
        }
      } catch (e) { console.warn('recurring failed', e); }
      // 全自動匯入台股股利（每日一次；含即將除息提醒）
      try {
        const nd = await autoImportDividends();
        if (nd > 0) { renderCurrent(); UI.toast(`已自動匯入 ${nd} 筆台股股利`, 'success'); }
        else renderCurrent(); // 讓鈴鐺紅點反映新提醒(如即將除息)
      } catch (e) { console.warn('auto dividends failed', e); }
      const hasTx = S.getTransactions().length > 0 || (App.Futures && App.Futures.getState().trades.length > 0);
      if (hasTx) await refresh();
      else { // 沒有交易就不會走報價刷新 → 匯率仍要更新（美金帳戶/負債換算用），變了就重繪
        try { const before = S.getFxRate(); await Api.fetchFx(); if (S.getFxRate() !== before) renderCurrent(); } catch (e) {}
      }
      Api.loadTwUniverse(false).catch(() => {});
      maybeBackfill(); // 登入後自動補齊歷史缺口（每天最多一次）
      maybeUpdateMargins().catch(e => console.warn('taifex margins failed', e));
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

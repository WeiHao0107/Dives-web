/* =========================================================================
 * views.js — 四個分頁的畫面渲染 + 新增/編輯交易表單
 * ======================================================================= */
window.App = window.App || {};

App.Views = (function () {
  const U = App.Util, S = App.Store, C = App.Calc, UI = App.UI;
  const COL = { tw: '#E8823C', us: '#4A82C8', total: '#0F766E' }; // 與走勢圖一致：台股橙、美股藍

  // 共用：刷新後重繪目前分頁
  function rerender() { App.renderCurrent(); }

  /* ===================== 持倉 ===================== */
  const pf = { filter: 'all', sort: 'marketValue', asc: false };

  function portfolio(root) {
    const positions = C.buildPositions();
    const summary = C.buildSummary(positions);
    const rate = S.getFxRate() || 31.5;

    // 摘要卡
    const acc = S.getAccount();
    let html = `<div class="card summary-card">
      <div class="sum-net">
        <div class="sum-label">總淨資產</div>
        <div class="sum-value">NT$ ${U.fmtWhole(summary.netAsset)}</div>
      </div>
      <div class="sum-grid">
        <div><div class="k">今日損益</div><div class="v">${UI.money(summary.dayPnl, { signed: true })}</div></div>
        <div><div class="k">總損益</div><div class="v">${UI.money(summary.totalPnl, { signed: true })}</div></div>
        <div><div class="k">報酬率</div><div class="v" style="color:${UI.pnlColor(summary.totalReturnPct || 0)}">${U.fmtPct(summary.totalReturnPct)}</div></div>
        <div><div class="k">未實現</div><div class="v">${UI.money(summary.totalUnrealizedPnl, { signed: true })}</div></div>
      </div>`;

    // 配置條
    const twV = summary.twMarketValue, usV = summary.usMarketValueTwd, tot = twV + usV;
    if (tot > 0) {
      const twPct = twV / tot * 100, usPct = usV / tot * 100;
      html += `<div class="alloc">
        <div class="alloc-bar">
          <span style="width:${twPct}%;background:${COL.tw}"></span>
          <span style="width:${usPct}%;background:${COL.us}"></span>
        </div>
        <div class="alloc-legend">
          <span><i style="background:${COL.tw}"></i>台股 ${twPct.toFixed(0)}%</span>
          <span><i style="background:${COL.us}"></i>美股 ${usPct.toFixed(0)}%</span>
          ${acc.initialCash != null ? `<span class="cash">現金 NT$ ${U.fmtKMBB(summary.cashBalance)}</span>` : ''}
        </div>
      </div>`;
    }
    html += `</div>`;

    // 篩選 + 排序
    html += `<div class="toolbar">
      <div class="seg" id="pf-filter">
        ${seg('all', '全部', pf.filter)}${seg('tw', '台股', pf.filter)}${seg('us', '美股', pf.filter)}
      </div>
      <select id="pf-sort" class="select">
        <option value="marketValue">市值</option>
        <option value="pnl">損益</option>
        <option value="price">現價</option>
        <option value="contribution">佔比</option>
      </select>
    </div>`;

    // 持倉列表
    let list = positions.filter(p => {
      const m = U.normalizeMarketKey(p.market);
      if (pf.filter === 'tw') return m !== U.Market.us;
      if (pf.filter === 'us') return m === U.Market.us;
      return true;
    });
    const mv = p => U.normalizeMarketKey(p.market) === U.Market.us ? p.marketValue * rate : p.marketValue;
    list.sort((a, b) => {
      let av, bv;
      switch (pf.sort) {
        case 'pnl': av = a.unrealizedPnl; bv = b.unrealizedPnl; break;
        case 'price': av = a.lastPrice || 0; bv = b.lastPrice || 0; break;
        default: av = mv(a); bv = mv(b);
      }
      return pf.asc ? av - bv : bv - av;
    });

    let listHtml = '';
    if (!list.length) {
      listHtml = `<div class="empty">尚無持倉，點右下角 ＋ 新增交易</div>`;
    } else {
      listHtml = `<div class="card holdings">`;
      for (const p of list) {
        const isUs = U.normalizeMarketKey(p.market) === U.Market.us;
        const cur = isUs ? '$' : '';
        const pnlPct = p.cost > 1e-9 ? p.unrealizedPnl / p.cost * 100 : 0;
        const chg = p.dailyChangePct;
        listHtml += `<div class="hold-row" data-sym="${p.symbol}">
          <div class="h-left">
            <div class="h-sym">${p.symbol} <span class="h-name">${p.name}</span></div>
            <div class="h-sub">${U.formatShares(p.shares)} 股 @ ${U.formatPrice(p.avgCost)}</div>
          </div>
          <div class="h-mid">
            <div class="h-price">${p.lastPrice != null ? cur + U.formatPrice(p.lastPrice) : '--'}</div>
            <div class="h-chg" style="color:${UI.pnlColor(chg || 0)}">${chg != null ? U.fmtPct(chg) : ''}</div>
          </div>
          <div class="h-right">
            <div class="h-mv">${cur ? '$' : 'NT$'} ${U.fmtKMBB(p.marketValue)}</div>
            <div class="h-pnl" style="color:${UI.pnlColor(p.unrealizedPnl)}">${U.fmtBannerSigned(p.unrealizedPnl)} (${U.fmtPct(pnlPct)})</div>
          </div>
        </div>`;
      }
      listHtml += `</div>`;
    }

    root.innerHTML = `<div class="page"><div class="page-top">${html}</div><div class="page-list">${listHtml}</div></div>`;

    // 事件
    root.querySelector('#pf-sort').value = pf.sort;
    root.querySelector('#pf-sort').addEventListener('change', e => { pf.sort = e.target.value; portfolio(root); });
    root.querySelectorAll('#pf-filter .seg-btn').forEach(b =>
      b.addEventListener('click', () => { pf.filter = b.dataset.v; portfolio(root); }));
    root.querySelectorAll('.hold-row').forEach(r =>
      r.addEventListener('click', () => openSymbolActions(r.dataset.sym)));
  }

  function seg(v, label, cur) {
    return `<button class="seg-btn ${cur === v ? 'active' : ''}" data-v="${v}">${label}</button>`;
  }

  function openSymbolActions(sym) {
    const txs = S.getTransactions().filter(t => t.symbol === sym).sort((a, b) => b.time - a.time);
    let rows = txs.map(t => `<div class="tx-mini" data-id="${t.id}">
      <span class="${t.type === 'BUY' ? 'buy' : 'sell'}">${t.type === 'BUY' ? '買' : '賣'}</span>
      <span>${U.formatShares(t.shares)} @ ${U.formatPrice(t.price)}</span>
      <span class="tx-date">${U.isoDate(new Date(t.time))}</span>
      <button class="link-edit" data-id="${t.id}">編輯</button>
    </div>`).join('');
    const ov = UI.openSheet(sym + ' 交易明細', rows || '<p>無交易</p>',
      `<button class="btn btn-ghost" id="add-more">新增此檔交易</button><button class="btn btn-danger" id="del-sym">刪除此檔</button>`);
    ov.querySelector('#del-sym').addEventListener('click', () =>
      UI.confirmDialog(`確定刪除 ${sym} 的所有交易與損益？`, () => { C.deleteSymbol(sym); UI.closeSheet(); App.afterDataChange([]); }, '刪除'));
    ov.querySelector('#add-more').addEventListener('click', () => { UI.closeSheet(); openTxForm(null, sym); });
    ov.querySelectorAll('.link-edit').forEach(b => b.addEventListener('click', () => {
      const tx = S.getTransactions().find(t => t.id === b.dataset.id);
      UI.closeSheet(); openTxForm(tx);
    }));
  }

  /* ===================== 歷史 ===================== */
  const hist = { tab: 'tx', range: 'ytd', txFilter: 'all', search: '' };
  const RANGES = [['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['all', '全部']];

  function history(root) {
    root.innerHTML = `<div class="page">
      <div class="page-top">
        <div class="seg seg-wide" id="hist-tab">${seg2('trend', '趨勢', hist.tab)}${seg2('tx', '交易紀錄', hist.tab)}</div>
        <div id="hist-fixed"></div>
      </div>
      <div class="page-list" id="hist-scroll"></div>
    </div>`;
    root.querySelectorAll('#hist-tab .seg-btn').forEach(b =>
      b.addEventListener('click', () => { hist.tab = b.dataset.v; history(root); }));
    const fixedEl = root.querySelector('#hist-fixed');
    const scrollEl = root.querySelector('#hist-scroll');
    if (hist.tab === 'trend') histTrend(fixedEl, scrollEl); else histTx(fixedEl, scrollEl);
  }
  function seg2(v, label, cur) { return `<button class="seg-btn ${cur === v ? 'active' : ''}" data-v="${v}">${label}</button>`; }

  function filterByRange(snaps) {
    if (hist.range === 'all') return snaps;
    const now = new Date();
    let from;
    if (hist.range === 'ytd') from = new Date(now.getFullYear(), 0, 1);
    else {
      const map = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
      from = new Date(now); from.setMonth(from.getMonth() - (map[hist.range] || 12));
    }
    const fromStr = U.isoDate(from);
    return snaps.filter(s => s.date >= fromStr);
  }

  function histTrend(fixedEl, scrollEl) {
    fixedEl.innerHTML = `<div class="chips" id="range-chips">` +
      RANGES.map(([v, l]) => `<button class="chip ${hist.range === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('') + `</div>`;
    fixedEl.querySelectorAll('#range-chips .chip').forEach(b =>
      b.addEventListener('click', () => { hist.range = b.dataset.v; histTrend(fixedEl, scrollEl); }));

    scrollEl.innerHTML = `<div class="card"><div class="chart-host" id="trend-chart"></div></div>`;
    const snaps = filterByRange(S.getSnapshots());
    const points = snaps.map(s => ({ date: new Date(s.date + 'T00:00:00+08:00'), values: { tw: s.twMarketValue, us: s.usMarketValueTwd } }));
    App.Charts.trend(scrollEl.querySelector('#trend-chart'), points, {
      twKey: 'tw', usKey: 'us', twLabel: '台股', usLabel: '美股',
      xLabels: monthLabels(points),
      valueFmt: v => 'NT$ ' + U.fmtKMBB(v),
    });
  }

  function monthLabels(points) {
    if (!points.length) return [];
    const out = []; const seen = new Set();
    const multiYear = new Set(points.map(p => p.date.getFullYear())).size > 1;
    points.forEach((p, i) => {
      const key = p.date.getFullYear() + '-' + p.date.getMonth();
      if (!seen.has(key)) {
        seen.add(key);
        const lbl = multiYear ? `${String(p.date.getFullYear()).slice(2)}/${p.date.getMonth() + 1}月` : `${p.date.getMonth() + 1}月`;
        out.push({ idx: i, label: lbl });
      }
    });
    if (out.length <= 6) return out;
    const step = Math.ceil(out.length / 6);
    return out.filter((_, i) => i % step === 0);
  }

  function histTx(fixedEl, scrollEl) {
    const mmap = S.metaMap();
    let txs = S.getTransactions().slice().sort((a, b) => b.time - a.time);
    txs = txs.filter(t => {
      const m = U.normalizeMarketKey(mmap[t.symbol]?.market || U.guessMarketBySymbol(t.symbol));
      if (hist.txFilter === 'tw') return m !== U.Market.us;
      if (hist.txFilter === 'us') return m === U.Market.us;
      return true;
    });
    if (hist.search) {
      const q = hist.search.toUpperCase();
      txs = txs.filter(t => t.symbol.includes(q) || (mmap[t.symbol]?.name || '').toUpperCase().includes(q));
    }

    fixedEl.innerHTML = `<div class="toolbar">
      <div class="seg" id="tx-filter">${seg('all', '全部', hist.txFilter)}${seg('tw', '台股', hist.txFilter)}${seg('us', '美股', hist.txFilter)}</div>
    </div>
    <input class="input search" id="tx-search" placeholder="搜尋代碼或名稱" value="${hist.search}">`;

    let listHtml = `<div class="card tx-list">`;
    if (!txs.length) listHtml += `<div class="empty">無交易紀錄</div>`;
    for (const t of txs) {
      const name = mmap[t.symbol]?.name || t.symbol;
      listHtml += `<div class="tx-row" data-id="${t.id}">
        <span class="tx-type ${t.type === 'BUY' ? 'buy' : 'sell'}">${t.type === 'BUY' ? '買入' : '賣出'}</span>
        <div class="tx-main">
          <div class="tx-sym">${t.symbol} <span class="h-name">${name}</span></div>
          <div class="tx-sub">${U.formatShares(t.shares)} 股 @ ${U.formatPrice(t.price)}　手續費 ${U.formatPrice(t.fee)}</div>
        </div>
        <div class="tx-meta">
          <div class="tx-amt">${U.fmtKMBB(t.shares * t.price)}</div>
          <div class="tx-date">${U.isoDate(new Date(t.time))}</div>
        </div>
      </div>`;
    }
    listHtml += `</div>`;
    scrollEl.innerHTML = listHtml;

    fixedEl.querySelectorAll('#tx-filter .seg-btn').forEach(b =>
      b.addEventListener('click', () => { hist.txFilter = b.dataset.v; histTx(fixedEl, scrollEl); }));
    const se = fixedEl.querySelector('#tx-search');
    se.addEventListener('input', e => { hist.search = e.target.value; });
    se.addEventListener('change', () => histTx(fixedEl, scrollEl));
    scrollEl.querySelectorAll('.tx-row').forEach(r => r.addEventListener('click', () => {
      const tx = S.getTransactions().find(t => t.id === r.dataset.id);
      if (tx) openTxForm(tx);
    }));
  }

  /* ===================== 報表 ===================== */
  const rep = { mode: 'yearly', year: new Date().getFullYear(), col: null, asc: true };
  // 欄位 → 圖表標題 / 表頭底線色（藍：淨資產/投入；綠：損益/已未實現）
  const REP_COLS = {
    netAsset: { title: '淨資產', underline: '#4A82C8' },
    newInvestment: { title: '本期投入', underline: '#4A82C8' },
    periodPnl: { title: '本期損益', underline: '#3DAA6A' },
    realizedUnrealized: { title: '未實現 / 已實現', underline: '#3DAA6A' },
  };

  function periodReports() {
    const snaps = S.getSnapshots().slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (rep.mode === 'yearly') {
      const byYear = {};
      for (const s of snaps) byYear[s.date.slice(0, 4)] = s;
      const years = Object.keys(byYear).sort();
      return years.map((y, i) => {
        const s = byYear[y], prev = i > 0 ? byYear[years[i - 1]] : null;
        return mkReport(y, s, prev);
      });
    } else {
      const ys = String(rep.year);
      const byMonth = {};
      for (const s of snaps) if (s.date.slice(0, 4) === ys) byMonth[s.date.slice(5, 7)] = s;
      const prevYearLast = snaps.filter(s => s.date.slice(0, 4) === String(rep.year - 1)).pop() || null;
      const months = Object.keys(byMonth).sort();
      return months.map((m, i) => {
        const s = byMonth[m], prev = i === 0 ? prevYearLast : byMonth[months[i - 1]];
        return mkReport(m + '月', s, prev);
      });
    }
  }
  function mkReport(label, s, prev) {
    const cost = s.totalCostBasisTwd;
    const pPnl = s.totalPnl - (prev ? prev.totalPnl : 0);
    return {
      label,
      netAsset: s.netAsset,
      newInvestment: cost - (prev ? prev.totalCostBasisTwd : 0),
      periodPnl: pPnl,
      totalPnl: s.totalPnl,
      returnPct: s.totalReturnPct,
      periodReturnPct: cost > 1e-9 ? pPnl / cost * 100 : 0,
      periodRealizedPnl: s.realizedPnl - (prev ? prev.realizedPnl : 0),
      unrealizedPnl: s.unrealizedPnl,
    };
  }

  function report(root) {
    const reports = periodReports();
    const years = [...new Set(S.getSnapshots().map(s => +s.date.slice(0, 4)))].sort();

    let html = `<div class="seg seg-wide" id="rep-mode">
      ${seg3('yearly', '年度', rep.mode)}${seg3('monthly', '月度', rep.mode)}
    </div>`;

    if (rep.mode === 'monthly' && years.length) {
      html += `<div class="chips" id="year-chips">` +
        years.map(y => `<button class="chip ${rep.year === y ? 'active' : ''}" data-v="${y}">${y} 年</button>`).join('') + `</div>`;
    }

    if (!reports.length) {
      html += `<div class="empty">暫無報表資料，使用一段時間後每日快照將彙整於此</div>`;
      root.innerHTML = `<div class="page-full">${html}</div>`;
      bindReportTop(root, years);
      return;
    }

    // 摘要橫幅（最新一期）
    const latest = reports[reports.length - 1];
    html += `<div class="card banner">
      ${bcol('本期損益', U.fmtBannerSigned(latest.periodPnl), UI.pnlColor(latest.periodPnl))}
      ${bcol('累計損益', U.fmtBannerSigned(latest.totalPnl), UI.pnlColor(latest.totalPnl))}
      ${bcol('報酬率', U.fmtPct(latest.returnPct), UI.pnlColor(latest.returnPct || 0))}
      ${bcol('未實現', U.fmtBannerSigned(latest.unrealizedPnl), UI.pnlColor(latest.unrealizedPnl))}
    </div>`;

    // 圖表（標題隨選取欄位變化；無選取＝資產走勢圖）
    const chartTitle = rep.col ? REP_COLS[rep.col].title : '資產走勢圖';
    html += `<div class="card"><div class="chart-title">${chartTitle}</div><div class="chart-host" id="rep-chart"></div></div>`;

    // 表格（表頭可點擊切換圖表）
    const ulOf = c => rep.col === c ? `border-bottom:2px solid ${REP_COLS[c].underline}` : '';
    const acOf = c => rep.col === c ? 'active' : '';
    html += `<div class="card rep-table">
      <div class="rt-head">
        <span class="c0 rt-sort" data-sort="1">期間 ${rep.asc ? '▲' : '▼'}</span>
        <span class="rt-h ${acOf('netAsset')}" data-col="netAsset" style="${ulOf('netAsset')}">淨資產</span>
        <span class="rt-h ${acOf('newInvestment')}" data-col="newInvestment" style="${ulOf('newInvestment')}">本期投入</span>
        <span class="rt-h ${acOf('periodPnl')}" data-col="periodPnl" style="${ulOf('periodPnl')}">本期損益<br><i>${rep.mode === 'yearly' ? '年報酬率' : '月報酬率'}</i></span>
        <span class="rt-h ${acOf('realizedUnrealized')}" data-col="realizedUnrealized" style="${ulOf('realizedUnrealized')}">未實現<br><i>已實現</i></span>
      </div>`;
    const rowsOrder = rep.asc ? reports : [...reports].reverse();
    for (const r of rowsOrder) {
      html += `<div class="rt-row">
        <span class="c0">${r.label}</span>
        <span>${U.fmtBanner(r.netAsset)}</span>
        <span>${U.fmtBannerSigned(r.newInvestment)}</span>
        <span><b style="color:${UI.pnlColor(r.periodPnl)}">${U.fmtBannerSigned(r.periodPnl)}</b><br><i style="color:${UI.pnlColor(r.periodReturnPct)}">${U.fmtPct(r.periodReturnPct)}</i></span>
        <span><b style="color:${UI.pnlColor(r.unrealizedPnl)}">${U.fmtBannerSigned(r.unrealizedPnl)}</b><br><i style="color:${UI.pnlColor(r.periodRealizedPnl)}">${U.fmtBannerSigned(r.periodRealizedPnl)}</i></span>
      </div>`;
    }
    html += `</div>`;
    root.innerHTML = `<div class="page-full">${html}</div>`;
    bindReportTop(root, years);

    // 表頭點擊：切換對應欄位圖表（再點一次回走勢圖）
    root.querySelectorAll('.rt-h').forEach(h => h.addEventListener('click', () => {
      rep.col = (rep.col === h.dataset.col) ? null : h.dataset.col;
      report(root);
    }));
    const sortBtn = root.querySelector('.rt-sort');
    if (sortBtn) sortBtn.addEventListener('click', () => { rep.asc = !rep.asc; report(root); });

    // 繪製圖表
    const host = root.querySelector('#rep-chart');
    if (rep.col) {
      App.Charts.reportColumn(host, reports, rep.col);
    } else {
      let snaps = S.getSnapshots().slice().sort((a, b) => a.date < b.date ? -1 : 1);
      if (rep.mode === 'monthly') snaps = snaps.filter(s => s.date.slice(0, 4) === String(rep.year));
      const points = snaps.map(s => ({ date: new Date(s.date + 'T00:00:00+08:00'), values: { tw: s.twMarketValue, us: s.usMarketValueTwd } }));
      App.Charts.trend(host, points, {
        twKey: 'tw', usKey: 'us', twLabel: '台股', usLabel: '美股',
        xLabels: repXLabels(points),
        valueFmt: v => 'NT$ ' + U.fmtKMBB(v),
      });
    }
  }
  function seg3(v, label, cur) { return `<button class="seg-btn ${cur === v ? 'active' : ''}" data-v="${v}">${label}</button>`; }
  function bcol(k, v, color) { return `<div class="bc"><div class="k">${k}</div><div class="v" style="color:${color}">${v}</div></div>`; }

  function repXLabels(points) {
    if (!points.length) return [];
    const out = []; const seen = new Set();
    points.forEach((p, i) => {
      const v = rep.mode === 'yearly' ? p.date.getFullYear() : p.date.getMonth() + 1;
      if (!seen.has(v)) { seen.add(v); out.push({ idx: i, label: rep.mode === 'yearly' ? String(v) : v + '月' }); }
    });
    const minGap = Math.max(5, Math.floor(points.length / 8));
    const filtered = [];
    for (const e of out) { if (filtered.length && e.idx - filtered[filtered.length - 1].idx < minGap) continue; filtered.push(e); }
    return filtered;
  }

  function bindReportTop(root, years) {
    root.querySelectorAll('#rep-mode .seg-btn').forEach(b =>
      b.addEventListener('click', () => { rep.mode = b.dataset.v; report(root); }));
    root.querySelectorAll('#year-chips .chip').forEach(b =>
      b.addEventListener('click', () => { rep.year = +b.dataset.v; report(root); }));
  }

  /* ===================== 設定 ===================== */
  function settings(root) {
    const acc = S.getAccount();
    const lastTs = S.getPricesTs();
    const rate = S.getFxRate();
    let html = `
    <div class="card setting-card">
      <div class="set-title">起始現金</div>
      <div class="set-row">
        <input class="input" id="set-cash" type="number" inputmode="decimal" placeholder="未設定" value="${acc.initialCash != null ? acc.initialCash : ''}">
        <button class="btn btn-primary" id="set-cash-save">儲存</button>
      </div>
      <div class="set-hint">設定後持倉頁會顯示現金餘額與淨資產</div>
    </div>

    <div class="card setting-card">
      <div class="set-title">雲端同步（GitHub Gist）</div>
      <div class="set-row">
        <input class="input" id="sync-token" type="password" placeholder="貼上 GitHub Token（gist 權限）" value="${App.Sync && App.Sync.enabled() ? '••••••••••••' : ''}">
        <button class="btn btn-primary" id="sync-save">${App.Sync && App.Sync.enabled() ? '更新' : '啟用'}</button>
      </div>
      <div class="set-row" style="margin-top:8px">
        <button class="btn btn-ghost" id="sync-now" style="flex:1" ${App.Sync && App.Sync.enabled() ? '' : 'disabled'}>立即同步</button>
        ${App.Sync && App.Sync.enabled() ? '<button class="btn btn-ghost" id="sync-off" style="flex:1">停用同步</button>' : ''}
      </div>
      <div class="set-hint" id="sync-status">${App.Sync && App.Sync.enabled() ? '同步已啟用' : '各裝置貼同一組 token 即可自動同步同一份資料'}</div>
      <div class="set-hint"><a href="https://github.com/settings/tokens/new?scopes=gist&description=dives-sync" target="_blank" style="color:${COL.tw}">→ 點此產生 GitHub Token（已預選 gist 權限）</a></div>
    </div>

    <div class="card setting-card">
      <div class="set-title">資料備份</div>
      <button class="btn btn-block btn-primary" id="btn-export">匯出備份（交易 + 快照）</button>
      <label class="btn btn-block btn-ghost" for="file-import">匯入備份</label>
      <input type="file" id="file-import" accept=".csv,text/csv" style="display:none">
      <div class="set-hint">CSV 格式與 iOS app 相容，可互通資料</div>
    </div>

    <div class="card setting-card">
      <div class="set-title">進階設定</div>
      <div class="set-sub">Finnhub API 金鑰（美股報價）</div>
      <input class="input" id="set-finnhub" placeholder="使用內建金鑰" value="${localStorage.getItem('dives_finnhub_key') || ''}">
      <div class="set-sub">FinMind Token（台股報價，可留空；註冊後填入可提高速率上限）</div>
      <input class="input" id="set-finmind" placeholder="免金鑰可用，額度有限" value="${localStorage.getItem('dives_finmind_token') || ''}">
      <div class="set-sub">CORS 代理（報價直連失敗時的後備）</div>
      <input class="input" id="set-proxy" value="${S.getProxy()}">
      <button class="btn btn-block btn-ghost" id="btn-adv-save">儲存進階設定</button>
    </div>

    <div class="card setting-card">
      <div class="set-title">關於</div>
      <div class="set-hint">最後更新報價：${lastTs ? new Date(lastTs).toLocaleString('zh-TW') : '尚未更新'}</div>
      <div class="set-hint">USD/TWD 匯率：${rate ? rate.toFixed(3) : '--'}</div>
      <div class="set-hint">交易筆數：${S.getTransactions().length}　快照：${S.getSnapshots().length}</div>
    </div>

    <div class="card setting-card danger-zone">
      <div class="set-title" style="color:${UI.LOSS}">危險區域</div>
      <button class="btn btn-block btn-danger" id="btn-clear">清空所有資料</button>
    </div>`;
    root.innerHTML = `<div class="page-full">${html}</div>`;

    root.querySelector('#set-cash-save').addEventListener('click', () => {
      const v = root.querySelector('#set-cash').value.trim();
      S.setAccount({ initialCash: v === '' ? null : parseFloat(v) });
      UI.toast('已儲存起始現金', 'success'); App.afterDataChange([]);
    });

    // ── 雲端同步 ──
    const syncStatusEl = root.querySelector('#sync-status');
    function fmtSyncStatus(s) {
      if (!s) return;
      if (s === 'syncing') { syncStatusEl.textContent = '同步中…'; return; }
      if (s.startsWith('synced:')) {
        const ts = +s.slice(7);
        syncStatusEl.textContent = ts ? ('已同步 · ' + new Date(ts).toLocaleString('zh-TW')) : '已同步';
        return;
      }
      if (s.startsWith('error:')) { syncStatusEl.textContent = '同步失敗：' + s.slice(6); return; }
    }
    if (App.Sync) App.Sync.onStatus(fmtSyncStatus);
    root.querySelector('#sync-save').addEventListener('click', async () => {
      const t = root.querySelector('#sync-token').value.trim();
      if (!t || t.startsWith('••')) { UI.toast('請貼上 GitHub Token', 'info'); return; }
      UI.toast('啟用同步中…', 'info');
      const r = await App.Sync.enable(t);
      if (r.error) { UI.toast('啟用失敗：' + r.error, 'error'); return; }
      UI.toast(r.changed ? '已從雲端載入資料' : '同步已啟用', 'success');
      App.renderCurrent();
    });
    const nowBtn = root.querySelector('#sync-now');
    if (nowBtn) nowBtn.addEventListener('click', async () => {
      const r = await App.Sync.pull();
      if (r.error) UI.toast('同步失敗：' + r.error, 'error');
      else { UI.toast('同步完成', 'success'); if (r.changed) App.renderCurrent(); }
    });
    const offBtn = root.querySelector('#sync-off');
    if (offBtn) offBtn.addEventListener('click', () =>
      UI.confirmDialog('停用同步？(本機資料會保留，雲端 Gist 不刪除)', () => {
        App.Sync.disable(); UI.toast('已停用同步', 'info'); settings(root);
      }, '停用'));
    root.querySelector('#btn-export').addEventListener('click', doExport);
    root.querySelector('#file-import').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = App.Csv.importCsv(String(reader.result));
        if (res.ok) { UI.toast(`匯入成功：${res.txCount} 筆交易${res.snapCount ? '、' + res.snapCount + ' 筆快照' : ''}`, 'success'); App.afterDataChange(); }
        else UI.toast(res.msg || '匯入失敗', 'error');
      };
      reader.readAsText(f);
      e.target.value = '';
    });
    root.querySelector('#btn-adv-save').addEventListener('click', () => {
      const fk = root.querySelector('#set-finnhub').value.trim();
      const fm = root.querySelector('#set-finmind').value.trim();
      const px = root.querySelector('#set-proxy').value.trim();
      if (fk) localStorage.setItem('dives_finnhub_key', fk); else localStorage.removeItem('dives_finnhub_key');
      if (fm) localStorage.setItem('dives_finmind_token', fm); else localStorage.removeItem('dives_finmind_token');
      S.setProxy(px);
      UI.toast('已儲存進階設定', 'success');
    });
    root.querySelector('#btn-clear').addEventListener('click', () =>
      UI.confirmDialog('確定清空所有交易、損益與快照？此動作無法復原。', () => {
        S.clearAll(); UI.toast('已清空所有資料', 'info'); App.afterDataChange([]);
      }, '清空'));
  }

  function doExport() {
    const csv = App.Csv.exportCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `portfolio_backup_${U.isoDate()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast('已匯出備份', 'success');
  }

  /* ===================== 新增/編輯交易 ===================== */
  let txState = null;
  function openTxForm(editing, presetSym) {
    txState = {
      editing: editing || null,
      isBuy: editing ? editing.type === 'BUY' : true,
      symbol: editing ? editing.symbol : (presetSym || ''),
      feeMode: 'rate',
    };
    const ed = editing;
    const body = `
      <div class="tx-toggle">
        <button class="tt-btn buy ${txState.isBuy ? 'active' : ''}" data-buy="1">買入</button>
        <button class="tt-btn sell ${!txState.isBuy ? 'active' : ''}" data-buy="0">賣出</button>
      </div>
      <label class="fld">股票代碼
        ${ed ? `<div class="locked">${ed.symbol} <span>🔒</span></div>`
        : `<input class="input" id="tx-sym" autocomplete="off" placeholder="代碼或名稱（2330、台積電、AAPL…）" value="${presetSym || ''}">
           <div class="suggest" id="tx-suggest"></div>`}
      </label>
      <label class="fld">交易日期
        <input class="input" id="tx-date" type="date" value="${U.isoDate(ed ? new Date(ed.time) : new Date())}">
      </label>
      <div class="fld-row">
        <label class="fld">股數<input class="input" id="tx-shares" type="number" inputmode="decimal" value="${ed ? ed.shares : ''}" placeholder="0"></label>
        <label class="fld">價格<input class="input" id="tx-price" type="number" inputmode="decimal" value="${ed ? ed.price : ''}" placeholder="0.00"></label>
      </div>
      <label class="fld">手續費
        <div class="fee-mode">
          <button class="fm-btn active" data-m="rate">費率 %</button>
          <button class="fm-btn" data-m="amount">固定金額</button>
        </div>
        <input class="input" id="tx-fee" type="number" inputmode="decimal" value="${ed ? ed.fee : '0.1425'}">
      </label>
      <div class="tx-preview" id="tx-preview"></div>`;
    const footer = `<button class="btn btn-ghost" id="tx-cancel">取消</button><button class="btn btn-primary" id="tx-submit">確認</button>`;
    const ov = UI.openSheet(ed ? '編輯交易' : (txState.isBuy ? '新增買入' : '新增賣出'), body, footer);

    const $ = s => ov.querySelector(s);
    function setTitle() { ov.querySelector('.sheet-title').textContent = ed ? '編輯交易' : (txState.isBuy ? '新增買入' : '新增賣出'); }
    function updatePreview() {
      const sh = parseFloat($('#tx-shares').value) || 0;
      const pr = parseFloat($('#tx-price').value) || 0;
      let fee = 0;
      if (txState.feeMode === 'rate') fee = sh * pr * ((parseFloat($('#tx-fee').value) || 0) / 100);
      else fee = parseFloat($('#tx-fee').value) || 0;
      if (sh > 0 && pr > 0) $('#tx-preview').innerHTML =
        `<div>${txState.isBuy ? '買入' : '賣出'}金額 <b>${U.fmtKMBB(sh * pr)}</b></div><div>預估手續費 <b>${U.formatPrice(fee)}</b></div>`;
      else $('#tx-preview').innerHTML = '';
    }
    ov.querySelectorAll('.tt-btn').forEach(b => b.addEventListener('click', () => {
      txState.isBuy = b.dataset.buy === '1';
      ov.querySelectorAll('.tt-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); setTitle();
    }));
    ov.querySelectorAll('.fm-btn').forEach(b => b.addEventListener('click', () => {
      txState.feeMode = b.dataset.m;
      ov.querySelectorAll('.fm-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (txState.feeMode === 'rate' && !$('#tx-fee').value) $('#tx-fee').value = isUsSym($('#tx-sym')?.value || txState.symbol) ? '0.08' : '0.1425';
      updatePreview();
    }));
    ['#tx-shares', '#tx-price', '#tx-fee'].forEach(s => $(s).addEventListener('input', updatePreview));

    // 自動完成
    if (!ed) {
      const symInput = $('#tx-sym'), sug = $('#tx-suggest');
      let timer = null;
      symInput.addEventListener('input', () => {
        const q = symInput.value.trim();
        clearTimeout(timer);
        if (!q) { sug.innerHTML = ''; return; }
        // 市場切換 → 自動更新預設費率
        if (txState.feeMode === 'rate') {
          const us = isUsSym(q);
          if (us && $('#tx-fee').value === '0.1425') $('#tx-fee').value = '0.08';
          else if (!us && $('#tx-fee').value === '0.08') $('#tx-fee').value = '0.1425';
        }
        timer = setTimeout(async () => {
          const res = await App.Api.searchSymbols(q);
          sug.innerHTML = res.map(r => `<div class="sug-item" data-code="${r.code}" data-name="${encodeURIComponent(r.name)}" data-mk="${r.market}">
            <span class="sc">${r.code}</span><span class="sn">${r.name}</span><span class="sm">${U.marketLabel(r.market)}</span></div>`).join('');
          sug.querySelectorAll('.sug-item').forEach(it => it.addEventListener('click', () => {
            symInput.value = it.dataset.code + ' ' + decodeURIComponent(it.dataset.name);
            sug.innerHTML = '';
            if (txState.feeMode === 'rate') $('#tx-fee').value = it.dataset.mk === 'us' ? '0.08' : '0.1425';
            $('#tx-shares').focus();
          }));
        }, 220);
      });
    }
    updatePreview();

    $('#tx-cancel').addEventListener('click', UI.closeSheet);
    $('#tx-submit').addEventListener('click', () => {
      const sh = parseFloat($('#tx-shares').value);
      const pr = parseFloat($('#tx-price').value);
      const dateVal = $('#tx-date').value;
      const time = dateVal ? new Date(dateVal + 'T12:00:00+08:00').getTime() : Date.now();
      let fee = 0;
      if (txState.feeMode === 'rate') fee = (sh || 0) * (pr || 0) * ((parseFloat($('#tx-fee').value) || 0) / 100);
      else fee = parseFloat($('#tx-fee').value) || 0;

      if (ed) {
        const res = C.updateTransaction(ed.id, { type: txState.isBuy ? 'BUY' : 'SELL', shares: sh, price: pr, fee, time });
        if (!res.ok) return UI.toast(res.msg, 'info');
        UI.closeSheet(); App.afterDataChange([res.symbol]);
      } else {
        const symbolInput = $('#tx-sym').value;
        const res = C.addTransaction({ symbolInput, type: txState.isBuy ? 'BUY' : 'SELL', shares: sh, price: pr, fee });
        if (!res.ok) return UI.toast(res.msg, 'info');
        UI.closeSheet(); App.afterDataChange([res.symbol]);
      }
    });

    // 編輯模式提供刪除
    if (ed) {
      const foot = ov.querySelector('.sheet-foot');
      const del = document.createElement('button');
      del.className = 'btn btn-danger'; del.textContent = '刪除';
      del.addEventListener('click', () => UI.confirmDialog('確定刪除這筆交易？', () => {
        const sym = ed.symbol; C.deleteTransaction(ed.id); UI.closeSheet(); App.afterDataChange([sym]);
      }, '刪除'));
      foot.insertBefore(del, foot.firstChild);
    }
  }
  function isUsSym(s) { return U.guessMarketBySymbol(U.sanitizeSymbol(s)) === U.Market.us; }

  return { portfolio, history, report, settings, openTxForm };
})();

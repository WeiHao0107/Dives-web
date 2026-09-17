/* =========================================================================
 * views-futures.js — 期貨畫面：資產頁卡片、期貨頁（指標／部位）、走勢／漲幅／紀錄、表單、設定
 * 運算一律來自 App.Futures；圖表與區間控制沿用 App.Views 的共用元件
 * 設計：docs/superpowers/specs/2026-09-17-futures-design.md
 * ======================================================================= */
window.App = window.App || {};

App.ViewsFutures = (function () {
  const U = App.Util, S = App.Store, C = App.Calc, UI = App.UI, F = App.Futures;
  const V = () => App.Views;
  const GOLD = '#E5A322', GOLD_INK = '#B47D12';
  const RISK_COL = { safe: '#34C759', warn: '#F59E0B', danger: '#E53935' };
  const st = { sub: null, trend: { metric: 'line', year: new Date().getFullYear() } };   // sub: null | 'trend' | 'settings'
  function reset() { st.sub = null; }

  const fmtW = v => U.fmtWhole(v);
  const sgn = v => (v >= 0 ? '+' : '−') + U.fmtWhole(Math.abs(v));
  const fp = v => { const s = U.formatPrice(v); return s.endsWith('.00') ? s.slice(0, -3) : s; };
  const pct = r => r == null ? '--' : Math.round(r * 100) + '%';
  const mult = x => x == null ? '--' : x.toFixed(2) + '×';   // 槓桿／曝險固定兩位小數（1.02×）
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const daysTo = iso => Math.round((Date.parse(iso + 'T00:00:00+08:00') - Date.parse(U.isoDate() + 'T00:00:00+08:00')) / 864e5);
  const md = iso => (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10));
  const dayLine = (d, base) => { const p = Math.abs(base) > 1e-9 ? d / Math.abs(base) * 100 : 0; return `${d > 0 ? '▲' : d < 0 ? '▼' : '–'} ${fmtW(Math.abs(d))} (${Math.abs(p).toFixed(2)}%)`; };

  // 有交易或已連結保證金帳戶才顯示期貨
  function visible() { const s = F.getState(); return s.trades.length > 0 || !!s.accountId; }

  // ---- 資產頁卡片（收合列，樣式同流動資金／投資）----
  function assetCardHtml(f, pctOfAssets) {
    const p = Math.max(0, Math.min(100, pctOfAssets || 0));
    const r = 15.5, Cc = 2 * Math.PI * r, off = Cc * (1 - p / 100);
    const ring = `<svg class="cat-ring" viewBox="0 0 36 36" width="42" height="42" aria-hidden="true"><circle cx="18" cy="18" r="${r}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="3"/><circle cx="18" cy="18" r="${r}" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${Cc.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 18 18)"/><text x="18" y="18" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(p) >= 100 ? 9.5 : 11}" font-weight="700" fill="${GOLD_INK}">${Math.round(p)}%</text></svg>`;
    const sum = f.positions.length ? f.positions.map(p => F.LABEL[p.contract] + ' ' + Math.abs(p.netLots) + ' 口 · ' + p.month).join('、') : '尚無部位';
    const d = f.dayPnl || 0;
    return `<div class="card as-cat"><div class="as-head" data-cat="fut" style="--cc:${GOLD}">
      <div class="as-hleft cat-hleft">${ring}<div class="cat-txt"><div class="nm-line"><span class="as-name">期貨</span></div><span class="as-hsummary">${esc(sum)}</span></div></div>
      <div class="as-hright"><span class="as-total">${fmtW(f.equity)}</span><span class="as-hchg" style="color:${UI.pnlColor(d)}">${dayLine(d, f.equity - d)}</span></div>
    </div></div>`;
  }

  // ---- 期貨頁 ----
  function page(root, backFn) {
    if (st.sub === 'trend') return trendPage(root, () => { st.sub = null; page(root, backFn); });
    if (st.sub === 'settings') return settingsPage(root, () => { st.sub = null; page(root, backFn); });
    const f = C.assetsSummary().fut;
    const state = F.getState();
    const rerender = () => page(root, backFn);
    const d = f.dayPnl || 0;
    const riskCol = f.riskLevel ? RISK_COL[f.riskLevel] : 'var(--sub)';
    const callPct = f.initTotal > 0 ? f.maintTotal / f.initTotal : 0.77;   // 追繳線（維持／原始）
    const SCALE = 2;                                                       // 色條 0–200%
    const pos = x => Math.max(0, Math.min(100, x / SCALE * 100)) + '%';
    const isShort = f.sens < 0;
    const distTxt = v => v == null ? '--' : (isShort ? '再漲 ' : '再跌 ') + fmtW(Math.abs(v)) + ' 點';
    const trendIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M7 14l3.5-3.5 3 2.5L19 8"/></svg>`;
    const top = `<div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">期貨</div>
      <div class="gd-actions"><button class="gd-trend" id="fx-trend" aria-label="走勢">${trendIcon}</button><button id="fx-menu" aria-label="設定">⋯</button><button id="fx-add" aria-label="新增">＋</button></div></div>
      <div class="rep-hero" style="padding:0 4px 8px">
        <div class="nw-cap">權益數${f.hasAccount ? '' : ' · 未連結保證金帳戶'}</div>
        <div class="rep-heroline"><span class="nw-num">${fmtW(f.equity)}</span><span class="rep-heropct" style="color:${UI.pnlColor(d)}">${dayLine(d, f.equity - d)}</span></div>
        <div class="rep-chips"><span>餘額 <b>${fmtW(f.balance)}</b></span><span>未平倉 <b style="color:${UI.pnlColor(f.unrealized)}">${sgn(f.unrealized)}</b></span><span>累計 <b style="color:${UI.pnlColor(f.cumulative)}">${sgn(f.cumulative)}</b></span></div>
      </div>`;
    let body = `<div class="card stats-card">
      <div class="fx-kpi">
        <div class="k"><div class="kk">風險指標</div><div class="kv" style="color:${riskCol}">${pct(f.risk)}</div></div>
        <div class="k"><div class="kk">帳戶槓桿</div><div class="kv">${mult(f.accLev)}</div></div>
        <div class="k"><div class="kk">整體曝險</div><div class="kv">${mult(f.exposure)}</div></div>
      </div>
      <div class="fx-bar" style="background:linear-gradient(90deg,#E53935 0 ${pos(0.25)},#F59E0B ${pos(0.25)} ${pos(callPct)},#34C759 ${pos(callPct)} 100%)">
        <div class="tick" style="left:${pos(0.25)}"></div><div class="tick" style="left:${pos(callPct)}"></div>
        ${f.risk != null ? `<div class="needle" style="left:${pos(f.risk)}"></div>` : ''}
      </div>
      <div class="fx-scale"><span style="left:${pos(0.25)}">砍倉</span><span style="left:${pos(callPct)}">追繳</span></div>
      <div class="fx-dist"><div class="d">追繳<b>${distTxt(f.callPts)}</b></div><div class="d">砍倉<b>${distTxt(f.liqPts)}</b></div></div>
      <div class="tr-sub" style="margin-top:10px">原始 ${fmtW(f.initTotal)} · 維持 ${fmtW(f.maintTotal)}</div>
    </div>`;
    body += `<div class="gt-subtitle">部位</div>`;
    if (!f.positions.length) body += `<div class="empty" style="padding:22px 16px">尚無部位，點右上 ＋ 建倉</div>`;
    for (const p of f.positions) {
      const dd = daysTo(p.expiry);
      body += `<div class="card fx-pos" data-key="${p.key}">
        <div class="lots">${Math.abs(p.netLots)}口${p.netLots < 0 ? '空' : ''}</div>
        <div class="as-main"><div class="gd-sym">${F.LABEL[p.contract]} <span class="h-name">${p.month}</span></div>
          <div class="as-sub">均 ${fp(p.avgEntry)} · 到期 ${md(p.expiry)}${dd >= 0 && dd <= 7 ? '（' + dd + ' 天）' : ''}</div></div>
        <div class="gd-val"><div class="gd-amt" style="color:${UI.pnlColor(p.unrealized)}">${sgn(p.unrealized)}</div><div class="gd-date">${p.mark != null ? fp(p.mark) : '無報價'}</div></div>
      </div>`;
    }
    if (f.positions.length) body += `<div class="fx-actions"><button class="btn btn-primary" id="fx-roll">轉倉</button><button class="btn btn-ghost" id="fx-close">平倉</button>${f.hasAccount ? '<button class="btn btn-ghost" id="fx-cash">入出金</button>' : ''}</div>`;
    else if (f.hasAccount) body += `<div class="fx-actions"><button class="btn btn-ghost" id="fx-cash">入出金</button></div>`;
    body += '<div style="height:12px"></div>';
    root.innerHTML = `<div class="page"><div class="page-top">${top}</div><div class="page-list">${body}</div></div>`;

    root.querySelector('.gd-back').addEventListener('click', backFn);
    root.querySelector('#fx-trend').addEventListener('click', () => { st.sub = 'trend'; rerender(); });
    root.querySelector('#fx-menu').addEventListener('click', () => { st.sub = 'settings'; rerender(); });
    root.querySelector('#fx-add').addEventListener('click', () => openTradeForm(null, rerender));
    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
    const pickPos = (title, fn) => f.positions.length === 1 ? fn(f.positions[0])
      : V().openChooser(title, f.positions.map(p => ({ v: p.key, label: F.LABEL[p.contract] + ' ' + p.month, hint: Math.abs(p.netLots) + ' 口' })), null, v => fn(f.positions.find(p => p.key === v)));
    on('fx-roll', () => pickPos('轉倉哪個部位', p => openRollForm(p, rerender)));
    on('fx-close', () => pickPos('平倉哪個部位', p => openTradeForm({ contract: p.contract, month: p.month, side: p.netLots > 0 ? 'SELL' : 'BUY', lots: Math.abs(p.netLots), price: p.mark }, rerender)));
    on('fx-cash', () => { const acct = S.getCashAccounts().find(a => a.id === state.accountId); if (acct) V().openMoneyForm('cash', acct, () => App.afterDataChange([])); });
    root.querySelectorAll('.fx-pos').forEach(el => el.addEventListener('click', () => {
      const p = f.positions.find(x => x.key === el.dataset.key); if (p) openRollForm(p, rerender);
    }));
    V().maskAmounts(root);
  }

  // ---- 新增／編輯交易（平倉＝preset 反方向；編輯時 preset.id 存在）----
  function openTradeForm(preset, onDone) {
    const state = F.getState();
    const p = preset || {};
    const editing = !!p.id;
    const today = U.isoDate();
    const months = F.upcomingMonths(today, 6);
    if (p.month && !months.includes(p.month)) months.unshift(p.month);
    const fs = { side: p.side === 'SELL' ? 'SELL' : 'BUY', contract: p.contract || 'TX' };
    const body = `
      <div class="tx-toggle"><button class="tt-btn buy ${fs.side === 'BUY' ? 'active' : ''}" data-s="BUY">買進</button><button class="tt-btn sell ${fs.side === 'SELL' ? 'active' : ''}" data-s="SELL">賣出</button></div>
      <label class="fld">合約<div class="fee-mode" id="fx-contract">${F.CONTRACTS.map(c => `<button type="button" class="fm-btn ${fs.contract === c ? 'active' : ''}" data-c="${c}">${F.LABEL[c]}</button>`).join('')}</div></label>
      <div class="fld-row">
        <label class="fld">月份<select class="input" id="fx-month">${months.map(m => `<option value="${m}" ${m === (p.month || months[0]) ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="fld">日期<input class="input" id="fx-date" type="date" value="${p.time ? U.isoDate(new Date(p.time)) : today}"></label>
      </div>
      <div class="fld-row">
        <label class="fld">口數<input class="input" id="fx-lots" type="number" inputmode="numeric" value="${p.lots != null ? p.lots : 1}"></label>
        <label class="fld">成交價<input class="input" id="fx-price" type="number" inputmode="decimal" value="${p.price != null ? p.price : ''}" placeholder="0"></label>
      </div>
      <div class="fld-row">
        <label class="fld">手續費／口<input class="input" id="fx-fee" type="number" inputmode="decimal" value="${p.feePerLot != null ? p.feePerLot : state.feePerLot[fs.contract]}"></label>
        <label class="fld">期交稅<input class="input" id="fx-tax" type="number" inputmode="decimal" value="${p.tax != null ? p.tax : ''}" placeholder="自動"></label>
      </div>
      <div class="tx-preview" id="fx-preview"></div>`;
    const foot = `${editing ? '<button class="btn btn-danger" id="fx-del">刪除</button>' : ''}<button class="btn btn-ghost" id="fx-cancel">取消</button><button class="btn btn-primary" id="fx-ok">確認</button>`;
    const ov = UI.openSheet(editing ? '編輯期貨交易' : '新增期貨交易', body, foot);
    const $ = s => ov.querySelector(s);
    let taxTouched = p.tax != null;
    const vals = () => ({ lots: parseInt($('#fx-lots').value, 10) || 0, price: parseFloat($('#fx-price').value) || 0, feePerLot: parseFloat($('#fx-fee').value) || 0 });
    function preview() {
      const v = vals();
      if (!taxTouched) $('#fx-tax').value = v.lots && v.price ? F.taxOf(fs.contract, v.price, v.lots) : '';
      if (!(v.lots > 0 && v.price > 0)) { $('#fx-preview').innerHTML = ''; return; }
      // 成交後：以目前狀態 + 此筆模擬（不寫入）
      const cur = F.summary(null, S.getPrices(), null);
      const sim = F.getState();
      sim.trades = [...sim.trades.filter(t => t.id !== p.id), { id: '_sim', contract: fs.contract, month: $('#fx-month').value, side: fs.side, lots: v.lots, price: v.price, fee: v.feePerLot * v.lots, tax: parseFloat($('#fx-tax').value) || 0, time: Date.now() }];
      const pr = Object.assign({}, S.getPrices()); const k = F.priceKey(fs.contract, $('#fx-month').value); if (!pr[k]) pr[k] = { price: v.price, dailyChange: 0, prevClose: v.price };
      const nx = F.summary(sim, pr, null);
      $('#fx-preview').innerHTML = `<div>保證金 <b>${fmtW(state.margin[fs.contract].init * v.lots)}</b></div>
        <div>風險指標 <b>${pct(cur.risk)} → <span style="color:${nx.riskLevel ? RISK_COL[nx.riskLevel] : 'inherit'}">${pct(nx.risk)}</span></b></div>
        <div>帳戶槓桿 <b>${mult(cur.accLev)} → ${mult(nx.accLev)}</b></div>`;
    }
    ov.querySelectorAll('.tt-btn').forEach(b => b.addEventListener('click', () => { fs.side = b.dataset.s; ov.querySelectorAll('.tt-btn').forEach(x => x.classList.toggle('active', x === b)); preview(); }));
    ov.querySelectorAll('#fx-contract .fm-btn').forEach(b => b.addEventListener('click', () => {
      fs.contract = b.dataset.c; ov.querySelectorAll('#fx-contract .fm-btn').forEach(x => x.classList.toggle('active', x === b));
      if (p.feePerLot == null) $('#fx-fee').value = state.feePerLot[fs.contract];
      taxTouched = false; preview();
    }));
    ['#fx-lots', '#fx-price', '#fx-fee'].forEach(s => $(s).addEventListener('input', preview));
    $('#fx-month').addEventListener('change', preview);
    $('#fx-tax').addEventListener('input', () => { taxTouched = $('#fx-tax').value !== ''; });
    $('#fx-cancel').addEventListener('click', UI.closeSheet);
    if ($('#fx-del')) $('#fx-del').addEventListener('click', () => UI.confirmDialog('刪除這筆期貨交易？帳戶餘額會沖回。', () => { F.deleteTrade(p.id); UI.closeSheet(); App.afterDataChange([]); onDone && onDone(); }, '刪除'));
    $('#fx-ok').addEventListener('click', () => {
      const v = vals();
      const rec = { contract: fs.contract, month: $('#fx-month').value, side: fs.side, lots: v.lots, price: v.price, fee: v.feePerLot * v.lots,
        tax: $('#fx-tax').value !== '' ? parseFloat($('#fx-tax').value) : undefined, time: new Date(($('#fx-date').value || today) + 'T12:00:00+08:00').getTime() };
      const res = editing ? F.updateTrade(p.id, rec) : F.addTrade(rec);
      if (!res.ok) return UI.toast(res.msg, 'info');
      UI.closeSheet(); App.afterDataChange([]); onDone && onDone();
    });
    preview();
  }

  // ---- 一鍵轉倉 ----
  function openRollForm(pos, onDone) {
    const state = F.getState();
    const today = U.isoDate();
    const months = F.upcomingMonths(today, 8).filter(m => m > pos.month);
    const body = `
      <label class="fld">部位<div class="locked">${F.LABEL[pos.contract]} ${pos.month} · ${Math.abs(pos.netLots)} 口${pos.netLots < 0 ? '空' : ''} · 均 ${fp(pos.avgEntry)} <span>🔒</span></div></label>
      <div class="fld-row">
        <label class="fld">平倉價<input class="input" id="rl-close" type="number" inputmode="decimal" value="${pos.mark != null ? pos.mark : ''}"></label>
        <label class="fld">口數<input class="input" id="rl-lots" type="number" inputmode="numeric" value="${Math.abs(pos.netLots)}"></label>
      </div>
      <div class="fld-row">
        <label class="fld">轉到<select class="input" id="rl-to">${months.map(m => `<option value="${m}">${m}</option>`).join('')}</select></label>
        <label class="fld">新倉價<input class="input" id="rl-open" type="number" inputmode="decimal" placeholder="0"></label>
      </div>
      <div class="fld-row">
        <label class="fld">日期<input class="input" id="rl-date" type="date" value="${today}"></label>
        <label class="fld">手續費／口<input class="input" id="rl-fee" type="number" inputmode="decimal" value="${state.feePerLot[pos.contract]}"></label>
      </div>
      <div class="tx-preview" id="rl-preview"></div>`;
    const ov = UI.openSheet('轉倉', body, `<button class="btn btn-ghost" id="rl-cancel">取消</button><button class="btn btn-primary" id="rl-ok">確認</button>`);
    const $ = s => ov.querySelector(s);
    function preview() {
      const c = parseFloat($('#rl-close').value) || 0, o = parseFloat($('#rl-open').value) || 0, n = parseInt($('#rl-lots').value, 10) || 0, fpl = parseFloat($('#rl-fee').value) || 0;
      if (!(c > 0 && o > 0 && n > 0)) { $('#rl-preview').innerHTML = ''; return; }
      const dir = pos.netLots > 0 ? 1 : -1;
      const realized = (c - pos.avgEntry) * F.MULT[pos.contract] * n * dir;
      const fees = fpl * n * 2 + F.taxOf(pos.contract, c, n) + F.taxOf(pos.contract, o, n);
      const spread = o - c;
      $('#rl-preview').innerHTML = `<div>實現損益 <b style="color:${UI.pnlColor(realized)}">${sgn(realized)}</b></div>
        <div>價差 <b>${spread > 0 ? '+' : ''}${fp(spread)}${spread < 0 ? '（逆價差）' : spread > 0 ? '（正價差）' : ''}</b></div>
        <div>費用 <b>${fmtW(fees)}</b></div><div>帳戶 <b style="color:${UI.pnlColor(realized - fees)}">${sgn(realized - fees)}</b></div>`;
    }
    ['#rl-close', '#rl-open', '#rl-lots', '#rl-fee'].forEach(s => $(s).addEventListener('input', preview));
    $('#rl-cancel').addEventListener('click', UI.closeSheet);
    $('#rl-ok').addEventListener('click', () => {
      const toMonth = $('#rl-to').value;
      const r = F.rollover({ contract: pos.contract, month: pos.month, toMonth, lots: parseInt($('#rl-lots').value, 10) || 0,
        closePrice: parseFloat($('#rl-close').value) || 0, openPrice: parseFloat($('#rl-open').value) || 0,
        time: new Date(($('#rl-date').value || today) + 'T12:00:00+08:00').getTime(), feePerLot: parseFloat($('#rl-fee').value) || 0 });
      if (!r.ok) return UI.toast(r.msg, 'info');
      // 新月份先以新倉價當現價，等下次刷新
      const pr = S.getPrices(); const k = F.priceKey(pos.contract, toMonth);
      if (!pr[k]) { pr[k] = { price: r.openTrade.price, dailyChange: 0, prevClose: r.openTrade.price }; S.setPrices(pr); }
      UI.closeSheet(); UI.toast('已轉倉 ' + pos.month + ' → ' + toMonth, 'success'); App.afterDataChange([]); onDone && onDone();
    });
    preview();
  }

  // ---- 走勢／漲幅／紀錄（右上角走勢 icon）----
  function trendPage(root, backFn) {
    const v = V();
    const t = st.trend;
    const snaps = S.getSnapshots().filter(s => s && s.date && s.futEquityTwd != null).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const CL = { cashTwd: 0, liabTwd: 0 };
    const dates = snaps.map(s => s.date);
    const years = [...new Set(snaps.map(s => +s.date.slice(0, 4)))].sort((a, b) => a - b);
    const money = x => 'NT$ ' + U.fmtKMBB(x);
    const sfMoney = x => (x >= 0 ? '+' : '−') + 'NT$ ' + U.fmtKMBB(Math.abs(x));
    const head = `<div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">期貨</div><div class="gd-actions" style="visibility:hidden"><button>＋</button></div></div>`;
    const segs = `<div class="seg seg-wide" id="fx-seg">${v.seg('line', '走勢', t.metric)}${v.seg('change', '漲幅', t.metric)}${v.seg('rec', '紀錄', t.metric)}</div>`;
    const rerender = () => trendPage(root, backFn);
    const eqSeries = list => list.map(s => ({ date: s.date, netWorth: s.futEquityTwd || 0 }));

    function paintLine() {
      const fS = v.applyRange(snaps, v.chartRange);
      const gran = v.autoGran(fS.length ? fS[0].date : null, fS.length ? fS[fS.length - 1].date : null);
      const eqB = C.netWorthBuckets(eqSeries(fS), gran, CL, true);
      const balB = C.netWorthBuckets(fS.map(s => ({ date: s.date, netWorth: (s.futEquityTwd || 0) - (s.futUnrealizedTwd || 0) })), gran, CL, true);
      const XL = v.chartLabels(eqB, gran);
      const sumEl = root.querySelector('#fx-summary'), host = root.querySelector('#fx-chart');
      if (!eqB.length) { if (sumEl) sumEl.innerHTML = ''; if (host) host.innerHTML = '<div class="chart-empty" style="padding:50px 0">尚無資料</div>'; return; }
      const a = eqB[0], b = eqB[eqB.length - 1], chg = b.nw - a.nw;
      const py = iso => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7) }); const pa = py(a.date), pb = py(b.date);
      if (sumEl) sumEl.innerHTML = `<div class="gt-sum"><div class="gt-period">${pa.y === pb.y ? `${pa.y}年${pa.m}月至${pb.m}月` : `${pa.y}年${pa.m}月至${pb.y}年${pb.m}月`}</div><div>權益數 ${chg >= 0 ? '增加了' : '減少了'} <b>${money(Math.abs(chg))}</b>${Math.abs(a.nw) > 1e-9 ? '，較期初 ' + (chg >= 0 ? '+' : '−') + Math.abs(chg / a.nw * 100).toFixed(0) + '%' : ''}</div></div>`;
      App.Charts.lineChart(host, eqB.map((bb, i) => ({ date: new Date(bb.date + 'T00:00:00+08:00'), values: { eq: bb.nw, bal: balB[i].nw } })), {
        height: 260, series: [{ key: 'eq', label: '權益數', color: GOLD, fill: true }, { key: 'bal', label: '餘額', color: '#A8A29E', dash: true }], xLabels: XL.xLabels, valueFmt: money });
    }

    let inner = '', B = null;
    if (t.metric === 'line') inner = v.rangeControlHtml(v.chartRange, 'fx') + `<div id="fx-summary"></div><div class="chart-host" id="fx-chart" style="margin-top:10px"></div>`;
    else if (t.metric === 'change') {
      if (!years.includes(t.year)) t.year = years.length ? years[years.length - 1] : new Date().getFullYear();
      B = C.netWorthBuckets(eqSeries(snaps.filter(s => s.date.slice(0, 4) === String(t.year))), 'month', CL, true);
      const tot = B.reduce((s, x) => s + x.change, 0);
      inner = v.yearControlHtml(t, 'fx', years) + (B.length ? `<div class="gt-sum"><div class="gt-period">${t.year}年</div><div>合計 <b style="color:${UI.pnlColor(tot)}">${sfMoney(tot)}</b></div></div>` : '') + `<div class="chart-host" id="fx-chart" style="margin-top:12px"></div>`;
    } else {
      const f = F.summary(null, S.getPrices(), null);
      const recs = F.records();
      const rolls = recs.filter(r => r.kind === 'roll').length;
      const dateOf = ms => md(U.isoDate(new Date(ms)));
      inner = `<div class="hist-sum fx-sum">
          <div class="hs-cell"><div class="hs-k">已實現</div><div class="hs-v" style="color:${UI.pnlColor(f.realizedGross)}">${sgn(f.realizedGross)}</div></div>
          <div class="hs-cell"><div class="hs-k">費用</div><div class="hs-v">${fmtW(f.fees)}</div></div>
          <div class="hs-cell"><div class="hs-k">轉倉</div><div class="hs-v">${rolls} 次</div></div></div>
        <div class="tx-list fx-rec">` + (recs.length ? recs.map(r => r.kind === 'roll'
          ? `<div class="tx-row" data-roll="${r.rollId}"><span class="tx-type evt">轉倉</span><div class="tx-main"><div class="tx-sym">${r.from || '?'} → ${r.to || '?'}</div><div class="tx-sub">${r.lots} 口${r.spread != null ? ' · 價差 ' + (r.spread > 0 ? '+' : '') + fp(r.spread) : ''} · ${dateOf(r.time)}</div></div><div class="tx-meta"><div class="tx-amt" style="color:${UI.pnlColor(r.realized)}">${sgn(r.realized)}</div><div class="tx-cap" style="font-size:11px;color:var(--sub)">費用 −${fmtW(r.fees)}</div></div></div>`
          : `<div class="tx-row" data-id="${r.trade.id}"><span class="tx-type ${r.side === 'BUY' ? 'buy' : 'sell'}">${r.side === 'BUY' ? '買入' : '賣出'}</span><div class="tx-main"><div class="tx-sym">${F.LABEL[r.contract]} ${r.month}</div><div class="tx-sub">${r.lots} 口 @ ${fp(r.price)} · ${dateOf(r.time)}</div></div><div class="tx-meta">${r.realized != null ? `<div class="tx-amt" style="color:${UI.pnlColor(r.realized)}">${sgn(r.realized)}</div>` : ''}<div class="tx-cap" style="font-size:11px;color:var(--sub)">費用 −${fmtW(r.fees)}</div></div></div>`
        ).join('') : '<div class="empty">無紀錄</div>') + '</div>';
    }
    root.innerHTML = `<div class="page-full">${head}<div class="card">${segs}${inner}</div></div>`;
    root.querySelector('.gd-back').addEventListener('click', backFn);
    root.querySelectorAll('#fx-seg .seg-btn').forEach(b => b.addEventListener('click', () => { t.metric = b.dataset.v; rerender(); }));
    if (t.metric === 'line') { v.bindRangeControl(root, v.chartRange, 'fx', dates, rerender, paintLine); paintLine(); }
    else if (t.metric === 'change') {
      v.bindYearControl(root, t, 'fx', rerender);
      const host = root.querySelector('#fx-chart');
      if (!B.length) host.innerHTML = '<div class="chart-empty" style="padding:50px 0">此區間尚無資料</div>';
      else App.Charts.barChart(host, B.map(b => ({ label: b.label, fullLabel: b.full, value: b.change })), { height: 260, colorOf: x => UI.pnlColor(x), valueFmt: sfMoney });
    } else {
      root.querySelectorAll('.fx-rec .tx-row[data-id]').forEach(r => r.addEventListener('click', () => {
        const tr = F.getState().trades.find(x => x.id === r.dataset.id);
        if (tr) openTradeForm({ id: tr.id, contract: tr.contract, month: tr.month, side: tr.side, lots: tr.lots, price: tr.price, feePerLot: tr.lots ? tr.fee / tr.lots : 0, tax: tr.tax, time: tr.time }, rerender);
      }));
      root.querySelectorAll('.fx-rec .tx-row[data-roll]').forEach(r => r.addEventListener('click', () => {
        const rec = F.records().find(x => x.rollId === r.dataset.roll);
        if (!rec) return;
        UI.confirmDialog(`刪除這次轉倉（${rec.from || ''} → ${rec.to || ''}）的兩筆交易？帳戶餘額會沖回。`, () => { for (const tr of rec.trades) F.deleteTrade(tr.id); App.afterDataChange([]); rerender(); }, '刪除');
      }));
    }
    V().maskAmounts(root);
  }

  // ---- 設定（⋯）----
  function settingsPage(root, backFn) {
    const v = V();
    const state = F.getState();
    const rerender = () => settingsPage(root, backFn);
    const acct = S.getCashAccounts().find(a => a.id === state.accountId);
    const row = (id, label, val) => `<button class="s-row" id="${id}"><span class="s-label">${label}</span><span class="s-val">${val}</span><span class="s-chev">›</span></button>`;
    const sw = (id, label, on) => `<div class="s-row s-info"><span class="s-label">${label}</span><label class="switch" style="margin-left:auto"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span></span></label></div>`;
    const positions = F.replay(state.trades).positions;
    const pxId = p => 'px-' + p.contract + '-' + p.month;   // id 不能含 '@'（querySelector 會炸）
    const priceRows = positions.map(p => { const q = S.getPrices()[F.priceKey(p.contract, p.month)]; return row(pxId(p), F.LABEL[p.contract] + ' ' + p.month, q ? fp(q.price) + (q.manual ? '（手動）' : '') : '--'); }).join('');
    root.innerHTML = `<div class="page-full">
      <div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">期貨設定</div><div class="gd-actions" style="visibility:hidden"><button>＋</button></div></div>
      <div class="s-head">保證金帳戶</div><div class="s-list">${row('fs-acct', '台幣帳戶', acct ? esc(acct.name) : '未連結')}</div>
      <div class="s-head">保證金（期交所 ${esc(state.marginDate || '--')}）</div>
      <div class="s-list">${F.CONTRACTS.map(c => row('fs-m-' + c, F.LABEL[c], fmtW(state.margin[c].init) + ' / ' + fmtW(state.margin[c].maint))).join('')}${sw('fs-auto', '每日自動更新', state.marginAuto)}</div>
      <div class="s-head">預設</div><div class="s-list">${row('fs-fee', '手續費／口', F.CONTRACTS.map(c => state.feePerLot[c]).join(' / '))}</div>
      ${priceRows ? `<div class="s-head">現價（點一下手動輸入）</div><div class="s-list">${priceRows}</div>` : ''}
      <div class="s-head">提醒</div><div class="s-list">${sw('fs-al-exp', '到期前 7 天', state.alerts.expiry)}${sw('fs-al-risk', '風險指標低於 100%', state.alerts.risk)}</div>
      <div style="height:16px"></div>
    </div>`;
    root.querySelector('.gd-back').addEventListener('click', backFn);
    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
    const dirty = () => { if (App.Sync) App.Sync.markDirty(); };
    on('fs-acct', () => v.openChooser('保證金帳戶', [{ v: '', label: '未連結', hint: '只算部位，不算權益數' }, ...S.getCashAccounts().filter(a => a.currency === 'TWD').map(a => ({ v: a.id, label: a.name, hint: 'NT$ ' + fmtW(a.balance || 0) }))], state.accountId || '',
      val => { F.patchState({ accountId: val || null }); dirty(); App.afterDataChange([]); rerender(); }));
    for (const c of F.CONTRACTS) on('fs-m-' + c, () => numSheet(F.LABEL[c] + ' 保證金', [['原始', state.margin[c].init], ['維持', state.margin[c].maint]], vals => {
      const s2 = F.getState(); s2.margin[c] = { init: vals[0], maint: vals[1] }; s2.marginDate = U.isoDate().replace(/-/g, '/') + ' 手動'; F.saveState(s2); dirty(); App.afterDataChange([]); rerender();
    }));
    on('fs-fee', () => numSheet('手續費／口', F.CONTRACTS.map(c => [F.LABEL[c], state.feePerLot[c]]), vals => {
      const s2 = F.getState(); F.CONTRACTS.forEach((c, i) => { s2.feePerLot[c] = vals[i]; }); F.saveState(s2); dirty(); rerender();
    }));
    for (const p of positions) on(pxId(p), () => numSheet(F.LABEL[p.contract] + ' ' + p.month + ' 現價', [['現價', (S.getPrices()[F.priceKey(p.contract, p.month)] || {}).price || '']], vals => {
      const pr = S.getPrices(); const k = F.priceKey(p.contract, p.month); const old = pr[k];
      pr[k] = { price: vals[0], dailyChange: old && old.prevClose ? vals[0] - old.prevClose : 0, prevClose: old ? old.prevClose : null, manual: true };
      S.setPrices(pr); App.afterDataChange([]); rerender();
    }));
    const tog = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('change', () => { const s2 = F.getState(); fn(s2, el.checked); F.saveState(s2); dirty(); }); };
    tog('fs-auto', (s2, on2) => { s2.marginAuto = on2; if (on2) localStorage.removeItem('dives_fut_margin_date'); });
    tog('fs-al-exp', (s2, on2) => { s2.alerts.expiry = on2; });
    tog('fs-al-risk', (s2, on2) => { s2.alerts.risk = on2; });
  }
  // 多欄數字輸入 sheet：fields [[label, value]] → onOk([numbers])
  function numSheet(title, fields, onOk) {
    const ov = UI.openSheet(title, fields.map(([l, val], i) => `<label class="fld">${l}<input class="input" id="ns-${i}" type="number" inputmode="decimal" value="${val}"></label>`).join(''),
      `<button class="btn btn-ghost" id="ns-cancel">取消</button><button class="btn btn-primary" id="ns-ok">儲存</button>`);
    ov.querySelector('#ns-cancel').addEventListener('click', UI.closeSheet);
    ov.querySelector('#ns-ok').addEventListener('click', () => {
      const vals = fields.map((_, i) => parseFloat(ov.querySelector('#ns-' + i).value));
      if (vals.some(x => !(x >= 0))) return UI.toast('請輸入數字', 'info');
      UI.closeSheet(); onOk(vals);
    });
    const first = ov.querySelector('#ns-0'); if (first) first.focus();
  }

  return { visible, assetCardHtml, page, reset, openTradeForm };
})();

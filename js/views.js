/* =========================================================================
 * views.js — 四個分頁的畫面渲染 + 新增/編輯交易表單
 * ======================================================================= */
window.App = window.App || {};

App.Views = (function () {
  const U = App.Util, S = App.Store, C = App.Calc, UI = App.UI;
  const esc = U.esc;
  const COL = { tw: '#E8823C', us: '#4A82C8', crypto: '#9B59D0', total: '#0F766E' }; // 台股橙、美股藍、加密紫

  // 共用：刷新後重繪目前分頁
  function rerender() { App.renderCurrent(); }

  // ---- 隱藏金額（眼睛）：本機偏好，隱藏時把金額數字換成 ••（僅本機，不上雲）----
  function eyeBtnHtml(id) {
    const hidden = S.getPrivacy();
    const icon = hidden
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c6 0 9.5 6 9.5 6a15.8 15.8 0 0 1-3.2 3.7M6.1 6.1A15.9 15.9 0 0 0 2.5 11s3.5 6 9.5 6a9.6 9.6 0 0 0 4-.9"/><path d="M9.6 9.6a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>`;
    return `<button class="nw-eye" id="${id}" aria-label="${hidden ? '顯示金額' : '隱藏金額'}">${icon}</button>`;
  }
  // 隱藏模式下只遮住淨資產／總倉位（Hero 大數字），換成四個米字號；其餘金額不隱藏
  function maskAmounts(root) {
    if (!S.getPrivacy()) return;
    root.querySelectorAll('.nw-num, .alloc-amt, .nw-ath-amt').forEach(el => { el.textContent = '＊＊＊＊'; });
  }

  /* ===================== 投資（市場分類卡，沿用資產頁風格）===================== */
  // pf.open：各市場展開狀態（可同時展開多個）；預設全收合。排序固定依市值（大→小）
  const pf = { detailFut: false, open: null, catChart: null, allocSel: null, detailSym: null };   // detailSym：個股頁（從投資分頁點進來）
  function resetPortfolioNav() { pf.detailSym = null; pf.catChart = null; pf.detailFut = false; if (App.ViewsFutures && App.ViewsFutures.reset) App.ViewsFutures.reset(); }

  // 通知鈴鐺（資產/投資頁右上）：有待確認交易 → 顯示筆數（處理完才消失）；否則有未讀通知 → 紅點
  function notifBtnHtml() {
    const n = App.Inbox ? App.Inbox.pendingCount() : 0;
    const mark = n > 0 ? `<span class="ntf-badge">${n > 99 ? '99+' : n}</span>` : S.unreadNotifCount() > 0 ? '<span class="ntf-dot"></span>' : '';
    return `<button class="ref-btn" id="notif-btn" aria-label="通知${n > 0 ? '，' + n + ' 筆交易待確認' : ''}">${NTF_ICONS.bell}${mark}</button>`;
  }
  // ＋ 上方放 🔔（垂直堆疊、右對齊，不重疊）
  function addWithRefreshHtml(addId, addLabel) {
    return `<div class="add-wrap">
      ${notifBtnHtml()}
      <button class="nw-add" id="${addId}" aria-label="${addLabel}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg></button>
    </div>`;
  }
  function bindRefresh(root) {
    const b = root.querySelector('#notif-btn');
    if (b) b.addEventListener('click', openNotifications);
  }

  // 通知圖示：和設定頁同一套線條圖示（不用表情符號）
  const NTF_SVG = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const NTF_ICONS = {
    inbox: NTF_SVG('<path d="M4 13.5 6.6 6.2A1.8 1.8 0 0 1 8.3 5h7.4a1.8 1.8 0 0 1 1.7 1.2L20 13.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 13.5h4.2l1.2 2.3h5.2l1.2-2.3H20"/>'),
    div: NTF_SVG('<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.6c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.7-2.6 1.9 0 2.6 5.3 1.2 5.3 3.9 0 1.2-1.2 1.9-2.7 1.9-1.3 0-2.3-.6-2.7-1.5M12 6.6v1.6M12 15.9v1.5"/>'),
    exdiv: NTF_SVG('<rect x="4" y="5.5" width="16" height="14.5" rx="2.2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8.5 14.5h3"/>'),
    recurring: NTF_SVG('<path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 0 0-4 4v1"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 0 0 4-4v-1"/>'),
    fut: NTF_SVG('<path d="M4 16.5l5-5 3.5 3.5L20 7.5"/><path d="M14.5 7.5H20V13"/>'),
    bell: NTF_SVG('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  };
  // 通知面板：每一列同一種樣式（圖示／標題＋說明／時間）；紫色 = 還沒處理或還沒看過。開啟後一般通知全部標為已讀。
  //   待確認交易置頂，右邊是箭頭（點了進審核清單）；它是待辦不是通知，「清除全部」不會清掉
  function openNotifications() {
    const list = S.getNotifications();
    const fmtT = ms => { const p = U.taipeiParts(new Date(ms)); return p.month + '/' + p.day + ' ' + String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0'); };
    const row = (ic, title, body, right, cls, attr) => `<div class="ntf-row${cls}"${attr || ''}><span class="ntf-ic">${NTF_ICONS[ic] || NTF_ICONS.bell}</span>
      <div class="ntf-main"><div class="ntf-t">${title}</div>${body ? `<div class="ntf-b">${body}</div>` : ''}</div>${right}</div>`;
    const byBroker = App.Inbox ? App.Inbox.pendingByBroker() : [];
    const nPend = byBroker.reduce((a, x) => a + x[1], 0);
    let rows = '';
    if (nPend) rows += row('inbox', nPend + ' 筆交易待確認', byBroker.map(x => esc(App.Inbox.brokerName(x[0])) + ' ' + x[1]).join(' · '), '<span class="ntf-go">›</span>', ' new go', ' id="ntf-inbox" role="button" tabindex="0"');
    rows += list.map(n => row(n.type, esc(n.title), n.body ? esc(n.body) : '', `<span class="ntf-time">${fmtT(n.time)}</span>`, n.read ? '' : ' new')).join('');
    const body = rows ? `<div class="ntf-list">${rows}</div>` : '<div class="empty" style="padding:28px">目前沒有通知</div>';
    const ov = UI.openSheet('通知', body, list.length ? '<button class="btn btn-ghost" id="ntf-clear" style="flex:1">清除全部</button>' : '');
    S.markNotificationsRead();
    document.querySelectorAll('.ntf-dot').forEach(d => d.remove()); // 紅點即時消失
    const cb = ov.querySelector('#ntf-clear');
    if (cb) cb.addEventListener('click', () => { S.setNotifications([]); UI.closeSheet(); });
    const ib = ov.querySelector('#ntf-inbox');
    if (ib) ib.addEventListener('click', () => openInboxReview());
  }

  /* ---- 待確認交易：審核清單（勾選 → 匯入／略過；點一筆 → 先修改再匯入）---- */
  // 目前最上層的 sheet：前一個 sheet 關閉動畫的 250ms 內，舊的還留在 DOM（同一個 id），所以取最後一個
  function lastSheet() { const all = document.querySelectorAll('.sheet-overlay'); return all[all.length - 1] || null; }
  // 清單狀態跨重開保留（改完單筆回來時勾選不會跑掉）：sel = 勾選的 id；errs = 上次匯入失敗的原因
  const ibx = { sel: null, errs: {} };
  function inboxMoney(it, v) { return (it.market === U.Market.us || it.market === U.Market.crypto || (!it.market && U.guessMarketBySymbol(it.symbol) === U.Market.us) ? '$' : '') + U.formatPrice(v); }
  function openInboxReview() {
    const I = App.Inbox, pend = I.pending();
    if (!pend.length) { ibx.sel = null; ibx.errs = {}; UI.closeSheet(); App.renderCurrent && App.renderCurrent(); return; }
    const dup = {}; pend.forEach(it => { dup[it.id] = I.isDuplicate(it); });
    // 預設全選，但「已有相同紀錄」的不勾；之後新進來的項目同樣規則
    if (!ibx.sel) ibx.sel = new Set(pend.filter(it => !dup[it.id]).map(it => it.id));
    const ids = new Set(pend.map(it => it.id));
    ibx.sel = new Set([...ibx.sel].filter(id => ids.has(id)));
    const brokers = []; pend.forEach(it => { if (!brokers.includes(it.broker)) brokers.push(it.broker); });
    const md = iso => (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10));

    const rowHtml = it => {
      const on = ibx.sel.has(it.id), err = ibx.errs[it.id];
      let name, sub, amt;
      if (it.kind === 'fut') {
        name = `<b>${App.Futures.LABEL[it.contract]}</b><em>${it.month}</em>`;
        sub = `${it.lots} 口 @ ${U.fmtWhole(it.price)}${it.fee ? ' · 費 ' + U.fmtWhole(it.fee) : ''}${it.tax ? ' · 稅 ' + U.fmtWhole(it.tax) : ''}`;
        amt = '';
      } else {
        const cost = it.fee + (it.tax || 0);
        name = `<b>${esc(it.symbol)}</b>${it.name ? `<em>${esc(it.name)}</em>` : ''}`;
        sub = `${U.formatShares(it.shares)} 股 @ ${inboxMoney(it, it.price)}${cost ? ' · 費 ' + inboxMoney(it, cost) : ''}`;
        amt = `<b>${inboxMoney(it, it.shares * it.price + (it.side === 'BUY' ? cost : -cost))}</b>`;
      }
      return `<div class="ibx-it${dup[it.id] ? ' dup' : ''}" data-id="${esc(it.id)}">
        <button class="ibx-ck${on ? ' on' : ''}" data-ck="${esc(it.id)}" role="checkbox" aria-checked="${on}" aria-label="選取這筆"></button>
        <span class="tx-type ${it.side === 'BUY' ? 'buy' : 'sell'}">${it.side === 'BUY' ? 'Buy' : 'Sell'}</span>
        <div class="ibx-main"><div class="ibx-t">${name}${dup[it.id] ? '<span class="ibx-dup">可能已輸入</span>' : ''}</div><div class="ibx-s">${sub}</div>${err ? `<div class="ibx-err">${esc(err)}</div>` : ''}</div>
        <div class="ibx-r">${amt}<span>${md(it.date)}</span></div>
      </div>`;
    };
    const groupHtml = b => {
      const items = pend.filter(it => it.broker === b);
      const cur = I.currencyFor(b, items[0]);
      let acct = '';
      if (cur) {
        const opts = S.getCashAccounts().filter(a => a.currency === cur), sel = I.accountFor(b);
        acct = `<select class="ibx-acct" data-broker="${esc(b)}" aria-label="${esc(I.brokerName(b))} 的現金帳戶"><option value="">不連動現金帳戶</option>${opts.map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
      }
      return `<div class="ibx-gh"><b>${esc(I.brokerLabel(b))}</b>${acct}</div><div class="ibx-list">${items.map(rowHtml).join('')}</div>`;
    };
    const body = `<div class="ibx-top"><span>${pend.length} 筆待確認，點一筆可先修改</span><button class="ibx-all" id="ibx-all"></button></div>${brokers.map(groupHtml).join('')}`;
    const ov = UI.openSheet('待確認交易', body, `<button class="btn btn-ghost" id="ibx-skip">略過選取</button><button class="btn btn-primary" id="ibx-import"></button>`);
    // 勾選只就地更新（不重開 sheet，避免閃動與捲動位置跑掉）
    const paintSel = () => {
      const n = ibx.sel.size;
      ov.querySelectorAll('.ibx-ck').forEach(b => { const on = ibx.sel.has(b.dataset.ck); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      ov.querySelector('#ibx-all').textContent = n === pend.length ? '取消全選' : '全選';
      ov.querySelector('#ibx-import').textContent = `匯入 ${n} 筆`;
      ov.querySelector('#ibx-import').disabled = ov.querySelector('#ibx-skip').disabled = !n;
    };
    paintSel();
    ov.querySelector('#ibx-all').addEventListener('click', () => { ibx.sel = ibx.sel.size === pend.length ? new Set() : new Set(pend.map(it => it.id)); paintSel(); });
    ov.querySelectorAll('.ibx-ck').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.dataset.ck; if (ibx.sel.has(id)) ibx.sel.delete(id); else ibx.sel.add(id);
      paintSel();
    }));
    ov.querySelectorAll('.ibx-acct').forEach(s => s.addEventListener('change', () => { I.setAccountFor(s.dataset.broker, s.value); if (App.Sync) App.Sync.markDirty(); }));
    ov.querySelectorAll('.ibx-it').forEach(r => r.addEventListener('click', () => {
      const it = pend.find(x => x.id === r.dataset.id); if (it) openInboxItem(it);
    }));
    ov.querySelector('#ibx-skip').addEventListener('click', () => {
      const chosen = [...ibx.sel];
      UI.confirmDialog(`略過這 ${chosen.length} 筆？略過後不會入帳，也不會再出現。`, () => {
        I.skip(chosen); chosen.forEach(id => { delete ibx.errs[id]; }); ibx.sel = new Set();
        if (App.Sync) App.Sync.markDirty();
        UI.toast(`已略過 ${chosen.length} 筆`, 'info');
        App.renderCurrent && App.renderCurrent();
        openInboxReview();
      }, '略過');
      lastSheet().querySelector('#cd-no').addEventListener('click', () => openInboxReview());   // 取消 → 回清單
    });
    ov.querySelector('#ibx-import').addEventListener('click', () => {
      const chosen = pend.filter(it => ibx.sel.has(it.id));
      const r = I.importMany(chosen, b => I.accountFor(b) || undefined);
      ibx.errs = {}; r.failed.forEach(f => { ibx.errs[f.id] = f.msg; });
      ibx.sel = new Set(r.failed.map(f => f.id));
      UI.closeSheet();
      inboxAfterImport(r.ok, r.backdated, r.symbols);
      if (r.failed.length) { UI.toast(`已匯入 ${r.ok} 筆，${r.failed.length} 筆失敗（原因見清單）`, 'error'); openInboxReview(); }
      else { UI.toast(`已匯入 ${r.ok} 筆交易`, 'success'); if (I.pendingCount()) openInboxReview(); else ibx.sel = null; }
    });
  }
  // 匯入後：存檔、同步、刷新報價；有今天以前的交易 → 重建歷史走勢，過去幾天的快照（損益月曆）才會包含這些交易
  function inboxAfterImport(nOk, backdated, symbols) {
    if (!nOk) return;
    App.afterDataChange(symbols || []);
    if (backdated && App.rebuildHistory) App.rebuildHistory().catch(e => console.warn('rebuild after import failed', e));
  }
  // 單筆：開一般的交易表單並帶入內容，確認＝匯入；另有「略過」。取消 → 回清單
  function openInboxItem(it) {
    const I = App.Inbox;
    const back = () => openInboxReview();
    const done = () => { delete ibx.errs[it.id]; if (ibx.sel) ibx.sel.delete(it.id); };
    const skip = () => { I.skip([it.id]); done(); if (App.Sync) App.Sync.markDirty(); UI.closeSheet(); UI.toast('已略過', 'info'); App.renderCurrent && App.renderCurrent(); back(); };
    const src = (it.source || I.brokerName(it.broker));
    if (it.kind === 'fut') {
      App.ViewsFutures.openTradeForm({ contract: it.contract, month: it.month, side: it.side, lots: it.lots, price: it.price,
        feePerLot: it.lots ? Math.round(it.fee / it.lots * 100) / 100 : 0, tax: it.tax != null ? it.tax : undefined, time: I.itemTime(it) },
        () => { I.markDone([it.id], 'i'); done(); if (App.Sync) App.Sync.markDirty(); if (it.date < U.isoDate() && App.rebuildHistory) App.rebuildHistory().catch(() => {}); UI.toast('已匯入', 'success'); back(); });
      // 期貨表單是共用的：在這裡補上標題、來源、略過鈕與「取消回清單」
      const ov = lastSheet(); if (!ov) return;
      ov.querySelector('.sheet-title').textContent = '匯入期貨交易';
      ov.querySelector('.sheet-body').insertAdjacentHTML('afterbegin', `<div class="ibx-src">來源：${esc(src)}</div>`);
      ov.querySelector('#fx-ok').textContent = '匯入這筆';
      ov.querySelector('#fx-cancel').addEventListener('click', back);
      const sk = document.createElement('button'); sk.className = 'btn btn-ghost ibx-skipone'; sk.textContent = '略過'; sk.addEventListener('click', skip);
      ov.querySelector('.sheet-foot').insertBefore(sk, ov.querySelector('.sheet-foot').firstChild);
      return;
    }
    openTxForm(null, null, {
      preset: { symbol: it.symbol, name: it.name, market: it.market || U.guessMarketBySymbol(it.symbol), isBuy: it.side === 'BUY', date: it.date, time: I.itemTime(it),
        shares: it.shares, price: it.price, fee: Math.round((it.fee + (it.tax || 0)) * 100) / 100, accountId: I.accountFor(it.broker), source: 'inbox:' + it.broker, note: '來源：' + src },
      onAdded: () => { I.markDone([it.id], 'i'); done(); },
      after: (sym, time) => { if (U.isoDate(new Date(time)) < U.isoDate() && App.rebuildHistory) App.rebuildHistory().catch(() => {}); UI.toast('已匯入', 'success'); back(); },
      onCancel: back, onSkip: skip,
    });
  }

  // 頂端下拉並「維持 1 秒」→ 觸發更新（避免誤觸；資產/投資頁）
  function attachPullRefresh(scrollEl) {
    if (!scrollEl) return;
    const ind = document.createElement('div');
    ind.className = 'pull-refresh';
    ind.innerHTML = `<span class="pr-icon">↓</span><span class="pr-text">下拉更新</span>`;
    scrollEl.insertBefore(ind, scrollEl.firstChild); // 置於最上方
    const TH = 66, HOLD = 1000;
    let startY = 0, pulling = false, dist = 0, timer = null, fired = false;
    const txt = s => { ind.querySelector('.pr-text').textContent = s; };
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const reset = () => { clearTimer(); fired = false; ind.classList.remove('ready'); ind.style.height = '0px'; ind.querySelector('.pr-icon').textContent = '↓'; txt('下拉更新'); };

    scrollEl.addEventListener('touchstart', e => {
      pulling = scrollEl.scrollTop <= 0; // 捲到最上方才啟用
      if (pulling) { startY = e.touches[0].clientY; dist = 0; fired = false; }
    }, { passive: true });
    scrollEl.addEventListener('touchmove', e => {
      if (!pulling || fired) return;
      dist = e.touches[0].clientY - startY; // 正 = 下拉
      if (dist > 0 && scrollEl.scrollTop <= 0) {
        e.preventDefault();
        ind.style.height = Math.min(dist * 0.5, 56) + 'px';
        const past = dist >= TH;
        if (past && !timer) {
          timer = setTimeout(() => {                 // 維持 1 秒才觸發（不顯示提示文字）
            timer = null; fired = true;
            ind.querySelector('.pr-icon').textContent = '⟳';
            txt('更新中…'); ind.style.height = '44px';
            App.refresh(undefined, true);
          }, HOLD);
        } else if (!past && timer) { clearTimer(); }
      } else { clearTimer(); ind.style.height = '0px'; }
    }, { passive: false });
    const end = () => {
      if (!pulling) return;
      pulling = false;
      if (!fired) reset(); // 維持不足 1 秒就放開 → 收回、不更新
      dist = 0;
    };
    scrollEl.addEventListener('touchend', end);
    scrollEl.addEventListener('touchcancel', end);
  }

  function portfolio(root) {
    if (pf.catChart) return metricChartPage(root, pf.catChart, () => { pf.catChart = null; portfolio(root); });
    if (pf.detailFut) return App.ViewsFutures.page(root, () => { pf.detailFut = false; portfolio(root); });
    if (pf.detailSym) return stockDetail(root, pf.detailSym, { get: () => pf.detailSym, close: () => { pf.detailSym = null; }, render: () => portfolio(root) });
    const positions = C.buildPositions();
    const summary = C.buildSummary(positions);
    // 期貨：有交易或已連結保證金帳戶才顯示卡；Hero 總倉位／今日漲跌只算股票，期貨在自己的卡
    const futOn = !!(App.ViewsFutures && App.ViewsFutures.visible());
    const fut = futOn ? C.assetsSummary().fut : null;
    const rate = S.getFxRate() || 31.5;
    const fmtPctBadge = v => (v >= 9.95 ? Math.round(v) : v.toFixed(v >= 1 ? 0 : 1)) + '%';

    const mkKey = p => { const m = U.normalizeMarketKey(p.market); return m === U.Market.us ? 'us' : m === U.Market.crypto ? 'crypto' : 'tw'; };
    const mvTwd = p => mkKey(p) === 'tw' ? p.marketValue : p.marketValue * rate;
    const convOf = p => mkKey(p) === 'tw' ? 1 : rate;
    const byMk = { tw: [], us: [], crypto: [] };
    for (const p of positions) byMk[mkKey(p)].push(p);
    const MKTS = [
      { key: 'us', name: '美股', color: COL.us, oc: 'oc-us' },
      { key: 'tw', name: '台股', color: COL.tw, oc: 'oc-tw' },
      { key: 'crypto', name: '加密貨幣', color: COL.crypto, oc: 'oc-cr' },
    ];
    const totalAll = summary.totalMarketValueTwd || 0;
    const isOpen = key => !!(pf.open && pf.open[key]); // 預設全收合

    // Hero：總倉位 + 今日漲跌（同資產頁淨資產樣式；捲動時固定於頂部）
    const day = summary.dayPnl || 0;
    const prevTot = totalAll - day;
    const dayPct = Math.abs(prevTot) > 1e-9 ? day / Math.abs(prevTot) * 100 : 0;
    const arrow = day > 0 ? '▲' : day < 0 ? '▼' : '–';
    let topHtml = `<div class="nw-hero">
      <div>
        <div class="nw-cap">總倉位 (TWD)${eyeBtnHtml('pf-eye')}</div>
        <div class="nw-num">${U.fmtWhole(totalAll)}</div>
        <div class="nw-day" style="color:${UI.pnlColor(day)}">${arrow} ${U.fmtWhole(Math.abs(day))} (${Math.abs(dayPct).toFixed(2)}%)</div>
      </div>
      <div class="nw-btns">
        ${addWithRefreshHtml('pf-add-btn', '新增交易')}
      </div>
    </div>`;

    // 市場卡（可同時展開多個；空市場不顯示）；最上方是持股分布卡
    const aUi = S.getAllocUi();
    let html = positions.length ? allocCardHtml({ open: aUi.open, by: aUi.by, sel: pf.allocSel }) : '';
    if (!positions.length && !fut) html += `<div class="empty" style="padding:48px 16px">尚無持倉，點右上 ＋ 新增交易</div>`;
    for (const M of MKTS) {
      const list = byMk[M.key];
      if (!list.length) continue;
      list.sort((a, b) => mvTwd(b) - mvTwd(a));
      const tot = list.reduce((s, p) => s + mvTwd(p), 0);
      const pct = totalAll > 1e-9 ? tot / totalAll * 100 : 0;
      // 該市場當日漲跌（TWD）＋比例（相對前一日市值）
      // twday 模式：美股白天未開盤 → 美股卡 0；台股開盤前/週末 → 台股卡 0；加密 24h 照算（與 Hero 一致）
      const dayOn = S.getDayMode() !== 'twday'
        || (M.key === 'us' ? U.usCountsTowardToday() : M.key === 'tw' ? U.twCountsTowardToday() : true);
      const dayChg = dayOn ? list.reduce((s, p) => s + (p.dayPnl || 0) * convOf(p), 0)
        + (positions.closedToday || []).filter(c => mkKey(c) === M.key).reduce((s, c) => s + c.dayPnl * (M.key === 'tw' ? 1 : rate), 0) : 0;   // 含今日賣光的標的
      const prevMv = tot - dayChg;
      const dayChgPct = Math.abs(prevMv) > 1e-9 ? dayChg / Math.abs(prevMv) * 100 : 0;
      const dArrow = dayChg > 0 ? '▲' : dayChg < 0 ? '▼' : '–';
      const open = isOpen(M.key);
      const names = [...list].sort((a, b) => mvTwd(b) - mvTwd(a)).slice(0, 4).map(p => esc(p.name !== p.symbol ? p.name : p.symbol)).join('、');
      html += `<div class="card as-cat">
        <div class="as-head ${open ? 'open ' + M.oc : ''}" data-mk="${M.key}" style="--cc:${M.color}">
          <div class="as-hleft">
            <div class="mk-nameline"><span class="as-name">${M.name}</span>${open ? `<button class="as-htrend" data-trend="${M.key}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M7 14l3.5-3.5 3 2.5L19 8"/></svg></button>` : ''}<span class="mk-count">${list.length} 檔 · ${pct.toFixed(0)}%</span></div>
            ${!open ? `<span class="as-hsummary">${names}</span>` : ''}
          </div>
          <div class="as-hright">
            <span class="as-total" style="color:${M.color}">${U.fmtWhole(tot)}</span>
            <span class="as-hchg" style="color:${UI.pnlColor(dayChg)}">${dArrow} ${U.fmtWhole(Math.abs(dayChg))} (${Math.abs(dayChgPct).toFixed(2)}%)</span>
          </div>
        </div>`;
      if (open) {
        html += `<div class="as-body">`;
        for (const p of list) {
          const rp = totalAll > 1e-9 ? mvTwd(p) / totalAll * 100 : 0;
          const cur = M.key === 'tw' ? '' : '$';
          const price = p.lastPrice != null ? p.lastPrice : p.avgCost;
          const fp = v => { const s = U.formatPrice(v); return s.endsWith('.00') ? s.slice(0, -3) : s; }; // 去除整數的 .00
          const chg = p.dailyChangePct;
          const chgHtml = chg != null ? ` <span style="color:${UI.pnlColor(chg)}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(2)}%</span>` : '';
          const pnlPct = p.cost > 1e-9 ? p.unrealizedPnl / p.cost * 100 : 0;
          html += `<div class="as-row pf-row" data-sym="${p.symbol}">
            <span class="pct-badge sm" style="background:${M.color}">${fmtPctBadge(rp)}</span>
            <div class="as-main">
              <div class="as-title pf-title"><span class="pf-sym">${dispName(p.symbol)}</span><span class="pf-price">${cur}${fp(price)}${chgHtml}</span></div>
              <div class="as-sub">${U.formatShares(p.shares)}${shareUnit(p.market)} · 均 ${cur}${fp(p.avgCost)}</div>
            </div>
            <div class="pf-val">
              <div class="pf-mv">NT$ ${U.fmtKMBB(mvTwd(p))}</div>
              <div class="pf-pnl" style="color:${UI.pnlColor(p.unrealizedPnl)}">${U.fmtBannerSigned(p.unrealizedPnl * convOf(p))} (${U.fmtPct(pnlPct)})</div>
            </div>
          </div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }

    if (fut) html += futPortfolioCard(fut, isOpen('fut'));

    // 上方（hero+統計+排序）固定，市場卡清單獨立捲動
    root.innerHTML = `<div class="page"><div class="page-top">${topHtml}</div><div class="page-list">${html}</div></div>`;
    attachPullRefresh(root.querySelector('.page-list'));

    // 事件
    bindRefresh(root);
    // 股利已改由「設定 → 自動匯入台股股利」全自動處理，＋ 直接開交易表單
    const addBtn = root.querySelector('#pf-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => openTxForm(null));
    const pfEye = root.querySelector('#pf-eye');
    if (pfEye) pfEye.addEventListener('click', () => { S.setPrivacy(!S.getPrivacy()); portfolio(root); });
    root.querySelectorAll('.as-head[data-mk]').forEach(h => h.addEventListener('click', () => {
      if (!pf.open) pf.open = {}; // 從「全收合」起手
      const k = h.dataset.mk;
      pf.open[k] = !pf.open[k];
      portfolio(root);
    }));
    root.querySelectorAll('.as-htrend[data-trend]').forEach(t => t.addEventListener('click', e => {
      e.stopPropagation(); // 不觸發標頭收合
      if (t.dataset.trend === 'fut') { App.ViewsFutures.showTrend(); pf.detailFut = true; portfolio(root); return; }
      pf.catChart = t.dataset.trend; portfolio(root);
    }));
    root.querySelectorAll('.pf-row').forEach(r =>
      r.addEventListener('click', () => { pf.detailSym = r.dataset.sym; as.stk.range = { range: 'all', from: null, to: null }; portfolio(root); }));
    bindAllocCard(root, {
      toggle: () => S.setAllocUi({ open: !S.getAllocUi().open }), setBy: v => S.setAllocUi({ by: v }),
      getSel: () => pf.allocSel, setSel: k => { pf.allocSel = k; }, rerender: () => portfolio(root),
    });
    root.querySelectorAll('.pf-fut-row').forEach(r =>
      r.addEventListener('click', () => { pf.detailFut = true; portfolio(root); }));
    maskAmounts(root);
  }

  // ── 倉位頁持股分布卡（甜甜圈圖＋圖例；個股／市場／群組，可收合）──
  // 市場只有一個時不給「市場」選項，沒有群組時不給「群組」選項；只剩一種就不顯示切換列
  const ALLOC_PAL = ['#5B8FD8', '#4FB286', '#E3B341', '#E0675C', '#A07CD0', '#E08E52', '#2BB3B3', '#E86FA8', '#93A23E']; // 前 8 檔＋剛好 9 檔時的第 9 色
  const ALLOC_OTHER = '#B9B3AC';
  const ALLOC_MK_COL = { tw: COL.tw, us: COL.us, crypto: COL.crypto };
  // cfg：{ open, by, sel, groupId?, title?, headValue?, centerCount? }；headValue＝標題列右側的數值；centerCount＝圓心只放檔數（總額已顯示在別處）；noToggle＝卡片本身不能收合；有 groupId → 群組詳情頁的組內分布（只有個股、無切換列）
  function allocCardHtml(cfg) {
    const ui = { open: cfg.open, by: cfg.by || 'symbol' };
    const probe = C.allocation('symbol', 8, cfg.groupId);
    const opts = cfg.groupId ? [['symbol', '個股']]
      : [['symbol', '個股']].concat(probe.marketCount > 1 ? [['market', '市場']] : [], probe.groupCount > 0 ? [['group', '群組']] : []);
    const by = opts.some(o => o[0] === ui.by) ? ui.by : 'symbol';
    const a = by === 'symbol' ? probe : C.allocation(by);
    const totalLbl = cfg.groupId ? '組內市值' : '股票市值';
    const slices = a.slices.map((sl, i) => Object.assign({}, sl, {
      color: sl.other ? ALLOC_OTHER : by === 'market' ? ALLOC_MK_COL[sl.key] : ALLOC_PAL[i % ALLOC_PAL.length],
      text: sl.other ? `其他 ${sl.count} 檔` : esc(sl.label),
    }));
    const pctTxt = v => v.toFixed(v >= 10 ? 1 : 1) + '%';
    const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9h-9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/></svg>';
    const headIn = `<span class="alloc-ic">${icon}</span><span class="alloc-t">${cfg.title || '持股分布'}</span>${cfg.headValue ? `<b class="alloc-hv alloc-amt">${cfg.headValue}</b>` : ''}`;
    let html = cfg.noToggle ? `<div class="card alloc-card"><div class="alloc-head">${headIn}</div>`
      : `<div class="card alloc-card"><button class="alloc-head" id="alloc-toggle">${headIn}<span class="alloc-chev">${ui.open ? '收合 ⌃' : '展開 ⌄'}</span></button>`;
    if (!ui.open) {
      html += `<div class="alloc-bar">${slices.map(sl => `<span style="width:${sl.pct}%;background:${sl.color}"></span>`).join('')}</div>
        <div class="alloc-mini">${slices.slice(0, 3).map(sl => `<span><i style="background:${sl.color}"></i>${sl.text} ${Math.round(sl.pct)}%</span>`).join('')}</div></div>`;
      return html;
    }
    if (opts.length > 1) html += `<div class="seg alloc-seg">${opts.map(([v, l]) => `<button class="seg-btn ${v === by ? 'active' : ''}" data-alloc-by="${v}">${l}</button>`).join('')}</div>`;
    const sel = slices.findIndex(sl => sl.key === cfg.sel);
    // 甜甜圈：每塊一個 circle（dasharray 切段，段間留細縫）；選中加粗、其他變淡
    const size = 156, thick = 30, r = (size - thick) / 2, Cc = 2 * Math.PI * r, cx = size / 2;
    let off = 0, arcs = '', tags = '';
    // 扇形上的標籤：弧長放得下文字才畫（英數約 5.6px／字、中文約 9.5px／字，字級 9.5）
    const textW = t => [...t].reduce((w, ch) => w + (/[\x00-\x7f]/.test(ch) ? 5.6 : 9.5), 0);
    slices.forEach((sl, i) => {
      const len = sl.pct / 100 * Cc, gap = slices.length > 1 ? Math.min(1.6, len * 0.3) : 0;
      arcs += `<circle class="alloc-arc" data-k="${esc(sl.key)}" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${sl.color}" stroke-width="${sel === i ? thick + 6 : thick}"
        stroke-dasharray="${Math.max(len - gap, 0.01).toFixed(2)} ${(Cc - len + gap).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cx})" opacity="${sel >= 0 && sel !== i ? 0.28 : 1}"/>`;
      const tag = sl.other ? '其他' : sl.label;
      if (len - gap >= textW(tag) + 6) {
        // 沿圓弧切線方向排字（下半圈轉 180° 保持正向可讀），只需弧長夠、不會超出圓環寬度
        const ang = (off + len / 2) / Cc * 2 * Math.PI - Math.PI / 2;
        let rot = ang * 180 / Math.PI + 90; if (rot > 90 && rot < 270) rot -= 180;
        const tx = (cx + r * Math.cos(ang)).toFixed(1), ty = (cx + r * Math.sin(ang)).toFixed(1);
        tags += `<text x="${tx}" y="${ty}" transform="rotate(${rot.toFixed(1)} ${tx} ${ty})" text-anchor="middle" dominant-baseline="central" class="alloc-tag" opacity="${sel >= 0 && sel !== i ? 0.35 : 1}">${esc(tag)}</text>`;
      }
      off += len;
    });
    const s0 = sel >= 0 ? slices[sel] : null;
    const sub = s0 ? (by === 'symbol' && !s0.other ? (s0.name && s0.name !== s0.label ? esc(s0.name) : '') : s0.count + ' 檔') : a.count + ' 檔';
    const ctr = s0
      ? `<div class="l">${s0.text}</div><div class="v alloc-amt">${U.fmtKMBB(s0.value)}</div><div class="p" style="color:${s0.color}">${pctTxt(s0.pct)}</div>${sub ? `<div class="l">${sub}</div>` : ''}`
      : cfg.centerCount ? `<div class="l">持股</div><div class="v">${sub}</div>`
      : `<div class="l">${totalLbl}</div><div class="v alloc-amt">${U.fmtKMBB(a.total)}</div><div class="l">${sub}</div>`;
    html += `<div class="alloc-body"><div class="alloc-donut" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}${tags}</svg><div class="alloc-ctr">${ctr}</div></div>
      <div class="alloc-lg">${slices.map((sl, i) => `<button class="alloc-row ${sel >= 0 ? (sel === i ? 'sel' : 'dim') : ''}" data-k="${esc(sl.key)}"><i style="background:${sl.color}"></i><span class="n">${sl.text}</span><span class="pc" style="color:${sl.other ? 'var(--sub)' : sl.color}">${pctTxt(sl.pct)}</span></button>`).join('')}</div></div></div>`;
    return html;
  }
  // h：{ toggle(), setBy(v), getSel(), setSel(k), rerender() }
  function bindAllocCard(root, h) {
    const t = root.querySelector('#alloc-toggle');
    if (!t && !root.querySelector('.alloc-card')) return;
    if (t) t.addEventListener('click', () => { h.toggle(); h.setSel(null); h.rerender(); });   // noToggle 的卡片沒有這顆鈕
    root.querySelectorAll('[data-alloc-by]').forEach(b => b.addEventListener('click', () => { h.setBy(b.dataset.allocBy); h.setSel(null); h.rerender(); }));
    root.querySelectorAll('.alloc-arc, .alloc-row').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      const k = el.dataset.k; h.setSel(h.getSel() === k ? null : k); h.rerender();
    }));
  }

  // 倉位頁期貨卡：右上契約總值＋今日損益；展開列出各部位（口數、均價、契約值、到期）與風險指標
  function futPortfolioCard(f, open) {
    const F = App.Futures, GOLD = '#E5A322';
    const d = f.dayPnl || 0;
    const dArrow = d > 0 ? '▲' : d < 0 ? '▼' : '–';
    const names = f.positions.map(p => F.LABEL[p.contract] + ' ' + Math.abs(p.netLots) + ' 口 · ' + p.month).join('、') || '尚無部位';
    const trendBtn = `<button class="as-htrend" data-trend="fut"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M7 14l3.5-3.5 3 2.5L19 8"/></svg></button>`;
    let html = `<div class="card as-cat">
      <div class="as-head ${open ? 'open oc-fut' : ''}" data-mk="fut" style="--cc:${GOLD}">
        <div class="as-hleft">
          <div class="mk-nameline"><span class="as-name">期貨</span>${open ? trendBtn : ''}<span class="mk-count">${f.lots} 口 · 契約值</span></div>
          ${!open ? `<span class="as-hsummary">${names}</span>` : ''}
        </div>
        <div class="as-hright">
          <span class="as-total" style="color:${GOLD}">${U.fmtWhole(f.notional)}</span>
          <span class="as-hchg" style="color:${UI.pnlColor(d)}">${dArrow} ${U.fmtWhole(Math.abs(d))}</span>
        </div>
      </div>`;
    if (open) {
      const margin = F.getState().margin;
      html += `<div class="as-body">`;
      for (const p of f.positions) {
        const init = Math.abs(p.netLots) * ((margin[p.contract] || {}).init || 0);
        const pct = init > 0 ? p.unrealized / init * 100 : 0;
        const ex = U.taipeiParts(new Date(p.expiry));
        html += `<div class="as-row pf-row pf-fut-row">
          <span class="pct-badge sm" style="background:${GOLD}">${F.LABEL[p.contract]}</span>
          <div class="as-main">
            <div class="as-title pf-title"><span class="pf-sym">${p.contract} ${p.month}</span><span class="pf-price">${p.netLots > 0 ? '' : '−'}${Math.abs(p.netLots)} 口 · 均 ${U.fmtWhole(p.avgEntry)}</span></div>
            <div class="as-sub">契約值 ${U.fmtWhole(p.notional)} · ${ex.month}/${ex.day} 到期</div>
          </div>
          <div class="pf-val">
            <div class="pf-mv" style="color:${UI.pnlColor(p.unrealized)}">${U.fmtBannerSigned(p.unrealized)}</div>
            <div class="pf-pnl" style="color:${UI.pnlColor(p.unrealized)}">${U.fmtPct(pct)}</div>
          </div>
        </div>`;
      }
      if (!f.positions.length) html += `<div class="empty" style="padding:14px">尚無部位</div>`;
      html += `<div class="as-row pf-fut-row pf-fut-foot"><span>風險指標 <b>${f.risk == null ? '--' : Math.round(f.risk * 100) + '%'}</b></span><span>權益數 ${U.fmtWhole(f.equity)} ›</span></div>`;
      html += `</div>`;
    }
    return html + `</div>`;
  }

  function seg(v, label, cur) {
    return `<button class="seg-btn ${cur === v ? 'active' : ''}" data-v="${v}">${label}</button>`;
  }

  // 股數單位：加密貨幣不以「股」計 → 留空（只顯示數量）
  function shareUnit(market) {
    return U.normalizeMarketKey(market) === U.Market.crypto ? '' : ' 股';
  }

  // 顯示名稱：自訂 alias 優先；否則台股用名稱、美股/加密用代號
  function defaultName(sym) {
    const m = S.metaMap()[sym] || {};
    const mk = U.normalizeMarketKey(m.market || U.guessMarketBySymbol(sym));
    if (mk === U.Market.us || mk === U.Market.crypto) return sym;
    return m.name && m.name !== sym ? m.name : sym;
  }
  function dispName(sym) {
    const m = S.metaMap()[sym] || {};
    return esc(m.alias || defaultName(sym)); // 只用於 HTML
  }
  function openRename(sym) {
    const m = S.metaMap()[sym] || {};
    const mkLabel = U.marketLabel(U.normalizeMarketKey(m.market || U.guessMarketBySymbol(sym)));
    const def = defaultName(sym);
    const ov = UI.openSheet('重新命名',
      `<div style="padding:2px 2px 4px">
        <div class="set-hint" style="margin-bottom:8px">${sym} · ${mkLabel}</div>
        <input class="input" id="rn-input" value="${esc(m.alias)}" placeholder="${esc(def)}" autocomplete="off">
        <div class="set-hint" style="margin-top:7px">留空 = 回到預設（${esc(def)}）</div>
      </div>`,
      `<button class="btn btn-ghost" id="rn-cancel">取消</button><button class="btn btn-primary" id="rn-save">儲存</button>`);
    const input = ov.querySelector('#rn-input');
    input.focus();
    const save = () => { S.setAlias(sym, input.value.trim()); if (App.Sync) App.Sync.markDirty(); UI.closeSheet(); App.renderCurrent(); };
    ov.querySelector('#rn-cancel').addEventListener('click', UI.closeSheet);
    ov.querySelector('#rn-save').addEventListener('click', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  }

  /* ===================== 歷史 ===================== */
  // txFilter/search：交易紀錄篩選；statScope：報表統計卡的「今年/歷史」切換
  const hist = { txFilter: 'all', search: '', type: 'all', from: null, to: null, group: null, prev: null }; // type:all|buy|sell；from/to:日期區間
  // group：只看某個群組（由群組頁「已實現」進來）；prev：進來前的篩選，返回時還原
  // 由群組頁跳到歷史頁：只看這個群組的賣出（＝已實現損益的明細）。資產頁仍停在群組頁，返回就回到原畫面
  function openGroupSells(gid) {
    if (!hist.group) hist.prev = { txFilter: hist.txFilter, search: hist.search, type: hist.type, from: hist.from, to: hist.to };
    Object.assign(hist, { txFilter: 'all', search: '', type: 'sell', from: null, to: null, group: gid });
    App.switchTab('history');
  }
  function leaveGroupHist() { if (hist.prev) Object.assign(hist, hist.prev); hist.group = null; hist.prev = null; }
  // 直接點底部「歷史」分頁 → 回到一般的歷史頁（不帶群組篩選）
  function resetHistoryNav() { if (hist.group) leaveGroupHist(); }

  // 歷史頁：僅交易紀錄（統計已移至報表；趨勢已由各類別走勢圖取代）
  function history(root) {
    root.innerHTML = `<div class="page">
      <div class="page-top" id="hist-fixed"></div>
      <div class="page-list" id="hist-scroll"></div>
    </div>`;
    histTx(root.querySelector('#hist-fixed'), root.querySelector('#hist-scroll'));
  }

  // 統計卡片（供報表頁使用）；scope.level: 'all'（全部歷史）| 'year' | 'month'
  //   all：自投入本金以來 + 區間獲利之最(含年度) + 單筆交易之最 + 目前持倉之最
  //   year/month：本期損益 + 該區間獲利之最 + 該區間單筆交易之最（依 from~to 過濾）
  const GRAN_LABEL = { day: '單日', week: '單週', month: '單月', year: '年度' };
  function statsCardsHtml(scope) {
    const level = (scope && scope.level) || 'all';
    const sf = v => v == null ? '—' : (v >= 0 ? '+' : '−') + 'NT$ ' + U.fmtKMBB(Math.abs(v));
    const col = v => UI.pnlColor(v || 0);
    const pctTxt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    // 區間日期文字：日=M/D、週=該週 M/D、月=YYYY/M、年=YYYY
    const pdate = (g, iso) => {
      if (!iso) return '';
      const p = iso.split('-');
      return g === 'month' ? `${p[0]}/${+p[1]}` : g === 'year' ? p[0] : `${+p[1]}/${+p[2]}`;
    };
    const pcell = (g, e) => e ? `<div class="pg-amt" style="color:${col(e.amount)}">${sf(e.amount)}</div><div class="pg-date">${pdate(g, e.date)}</div>` : '<span class="pg-none">—</span>';
    const perfCard = (period, grans) => {
      const grid = grans.map(g =>
        `<div class="pg-lbl">${GRAN_LABEL[g]}</div><div class="pg-cell">${pcell(g, period[g].best)}</div><div class="pg-cell">${pcell(g, period[g].worst)}</div>`
      ).join('');
      return `<div class="card stats-card">
        <div class="stats-title">區間獲利之最</div>
        <div class="perf-grid"><div class="pg-head"></div><div class="pg-head">最大獲利</div><div class="pg-head">最大虧損</div>${grid}</div>
      </div>`;
    };
    // 單筆交易 / 持倉 之最：一列（左標籤、右金額+副標）
    const row = (label, e, opts) => {
      opts = opts || {};
      if (!e) return `<div class="stat-row"><div class="stat-lbl">${label}</div><div class="stat-val"><div class="stat-amt" style="color:var(--sub)">—</div></div></div>`;
      const amt = opts.pctMain ? pctTxt(e.pct) : sf(e.amount);
      let sub;
      if (opts.trade && e.market === 'fut') {   // 期貨平倉／轉倉：大台 202610→202611 · 2 口 @ 46,764
        const fpx = U.formatPrice(e.price).replace(/\.00$/, '');
        sub = `${e.label} · ${e.lots} 口 @ ${fpx} · ${e.date}`;
      } else if (opts.trade) {
        const usd = e.market === U.Market.us || e.market === U.Market.crypto;
        sub = `${e.symbol} · ${U.formatShares(e.shares)}${shareUnit(e.market)} @ ${usd ? '$' : ''}${U.formatPrice(e.price)} · ${e.date}`;
      } else {
        sub = `${esc(e.symbol)}${e.name && e.name !== e.symbol ? ' ' + esc(e.name) : ''} · ${opts.pctMain ? sf(e.amount) : pctTxt(e.pct)}`;
      }
      return `<div class="stat-row"><div class="stat-lbl">${label}</div>
        <div class="stat-val"><div class="stat-amt" style="color:${col(opts.pctMain ? e.pct : e.amount)}">${amt}</div><div class="stat-sub">${sub}</div></div></div>`;
    };
    const tradeCard = (best, worst) => `<div class="card stats-card">
      <div class="stats-title">單筆交易之最</div>
      ${row('最賺一筆', best, { trade: true })}
      ${row('最賠一筆', worst, { trade: true })}
    </div>`;

    // 手續費統計卡（本期/全部歷史；美股・加密以目前匯率換算 TWD）
    const fee = C.feesSummary(scope && scope.from, scope && scope.to);
    const nt = v => 'NT$ ' + U.fmtKMBB(v || 0);
    const feeCard = `<div class="card stats-card">
      <div class="stats-title">手續費</div>
      <div class="tr-row"><div class="tr-amt">${nt(fee.total)}</div></div>
      <div class="tr-grid">
        <div class="trg"><span class="trg-k">買入手續費</span><span class="trg-v">${nt(fee.buy)}</span></div>
        <div class="trg"><span class="trg-k">賣出手續費</span><span class="trg-v">${nt(fee.sell)}</span></div>
        ${fee.fut > 0 ? `<div class="trg"><span class="trg-k">期貨費用</span><span class="trg-v">${nt(fee.fut)}</span></div>` : ''}
        <div class="trg"><span class="trg-k">交易筆數</span><span class="trg-v">${fee.count} 筆</span></div>
        <div class="trg"><span class="trg-k">平均每筆</span><span class="trg-v">${nt(fee.count ? fee.total / fee.count : 0)}</span></div>
      </div>
    </div>`;

    const dv = C.dividendsBetween(scope && scope.from, scope && scope.to);
    const divCard = `<div class="card stats-card">
      <div class="stats-title">股息（本期／區間）</div>
      <div class="tr-row"><div class="tr-amt">${nt(dv.total)}</div></div>
      <div class="tr-grid">
        <div class="trg"><span class="trg-k">台股股息</span><span class="trg-v">${nt(dv.tw)}</span></div>
        <div class="trg"><span class="trg-k">美股股息</span><span class="trg-v">${nt(dv.us)}</span></div>
        <div class="trg"><span class="trg-k">筆數</span><span class="trg-v">${dv.count} 筆</span></div>
        <div class="trg"><span class="trg-k">平均每筆</span><span class="trg-v">${nt(dv.count ? dv.total / dv.count : 0)}</span></div>
      </div>
    </div>`;

    if (level === 'all') {
      const st = C.tradingStats();
      const sm = C.buildSummary(C.buildPositions()); // 累計報酬（vs 投入本金）
      const futAll = C.assetsSummary().fut;           // 期貨策略累計（已實現淨費用 + 未平倉）併入總損益；報酬率分母仍為股票投入本金
      const futCum = futAll ? futAll.cumulative : 0;
      const allPnl = sm.totalPnl + futCum;
      const allPct = sm.totalCostBasisTwd > 1e-9 ? allPnl / sm.totalCostBasisTwd * 100 : 0;
      const allDivPct = sm.totalCostBasisTwd > 1e-9 ? (allPnl + sm.totalDividendTwd) / sm.totalCostBasisTwd * 100 : 0;
      return `
        <div class="card stats-card">
          <div class="stats-title">自投入本金以來</div>
          <div class="tr-row">
            <div class="tr-amt" style="color:${col(allPnl)}">${sf(allPnl)}</div>
            <div class="tr-pct" style="color:${col(allPct)}">${pctTxt(allPct)}</div>
          </div>
          <div class="tr-grid">
            <div class="trg"><span class="trg-k">投入本金</span><span class="trg-v">NT$ ${U.fmtKMBB(sm.totalCostBasisTwd)}</span></div>
            <div class="trg"><span class="trg-k">目前市值</span><span class="trg-v">NT$ ${U.fmtKMBB(sm.totalMarketValueTwd)}</span></div>
            <div class="trg"><span class="trg-k">未實現</span><span class="trg-v" style="color:${col(sm.totalUnrealizedPnl)}">${sf(sm.totalUnrealizedPnl)}</span></div>
            <div class="trg"><span class="trg-k">已實現</span><span class="trg-v" style="color:${col(sm.totalRealizedPnl)}">${sf(sm.totalRealizedPnl)}</span></div>
            ${Math.abs(futCum) > 0.5 ? `<div class="trg"><span class="trg-k">期貨損益</span><span class="trg-v" style="color:${col(futCum)}">${sf(futCum)}</span></div>` : ''}
            <div class="trg"><span class="trg-k">股息收入</span><span class="trg-v">${sf(sm.totalDividendTwd)}</span></div>
            <div class="trg"><span class="trg-k">含息報酬率</span><span class="trg-v" style="color:${col(allDivPct)}">${pctTxt(allDivPct)}</span></div>
            ${(() => { // 年化報酬率(XIRR,資金加權):未滿 90 天年化失真 → 顯示 --
              const x = C.portfolioXirr();
              if (!x) return '';
              const v = x.days >= 90 ? `<span class="trg-v" style="color:${col(x.rate)}">${pctTxt(x.rate)}</span>` : '<span class="trg-v" style="color:var(--sub)">--</span>';
              return `<div class="trg"><span class="trg-k">年化報酬 XIRR</span>${v}</div>
                <div class="trg"><span class="trg-k">投入天數</span><span class="trg-v">${x.days} 天</span></div>`;
            })()}
          </div>
        </div>
        ${feeCard}
        ${divCard}
        ${perfCard(st.period.all, ['day', 'week', 'month', 'year'])}
        ${tradeCard(st.bestTrade, st.worstTrade)}
        <div class="card stats-card">
          <div class="stats-title">目前持倉之最</div>
          ${row('未實現獲利王', st.topGain)}
          ${row('未實現虧損王', st.topLoss)}
          ${row('報酬率最高', st.topPct, { pctMain: true })}
        </div>`;
    }
    const grans = level === 'year' ? ['day', 'week', 'month'] : ['day', 'week'];
    const st = C.scopedStats(scope.from, scope.to, grans);
    return `
      <div class="card stats-card">
        <div class="stats-title">本期損益</div>
        <div class="tr-row">
          <div class="tr-amt" style="color:${col(st.periodPnl)}">${sf(st.periodPnl)}</div>
          <div class="tr-pct" style="color:${col(st.periodReturnPct || 0)}">${pctTxt(st.periodReturnPct || 0)}</div>
        </div>
      </div>
      ${feeCard}
      ${divCard}
      ${perfCard(st.period, grans)}
      ${tradeCard(st.bestTrade, st.worstTrade)}`;
  }


  function histTx(fixedEl, scrollEl) {
    const mmap = S.metaMap();
    const rate = S.getFxRate() || 31.5;
    const isUsdMk = mk => mk === U.Market.us || mk === U.Market.crypto;
    const mktOf = sym => U.normalizeMarketKey(mmap[sym]?.market || U.guessMarketBySymbol(sym));
    const q = hist.search.trim().toUpperCase();

    // 合併三種事件：交易(買/賣)、配股(STOCK_DIV 交易)、現金股利(股利帳本)
    const events = [];
    for (const t of S.getTransactions()) events.push({ kind: t.type === 'STOCK_DIV' ? 'stockdiv' : 'tx', time: t.time, symbol: t.symbol, tx: t });
    for (const d of S.getDividends()) events.push({ kind: 'cashdiv', time: new Date(d.date + 'T12:00:00+08:00').getTime(), symbol: d.symbol, div: d });
    events.sort((a, b) => b.time - a.time);

    const isDivKind = e => e.kind === 'cashdiv' || e.kind === 'stockdiv';
    // 群組模式：只留該群組的標的（群組被刪掉 → 自動離開群組模式）
    let grp = hist.group ? S.getGroups().find(g => g.id === hist.group) : null;
    if (hist.group && !grp) leaveGroupHist();
    const gmapH = grp ? S.getGroupMap() : null;
    const filtered = events.filter(e => {
      if (grp && gmapH[e.symbol] !== grp.id) return false;
      if (hist.type === 'buy' && !(e.kind === 'tx' && e.tx.type === 'BUY')) return false;
      if (hist.type === 'sell' && !(e.kind === 'tx' && e.tx.type === 'SELL')) return false;
      if (hist.type === 'div' && !isDivKind(e)) return false;
      const m = mktOf(e.symbol);
      if (hist.txFilter === 'tw' && (m === U.Market.us || m === U.Market.crypto)) return false;
      if (hist.txFilter === 'us' && m !== U.Market.us) return false;
      if (hist.txFilter === 'crypto' && m !== U.Market.crypto) return false;
      const d = U.isoDate(new Date(e.time));
      if (hist.from && d < hist.from) return false;
      if (hist.to && d > hist.to) return false;
      if (q && !(e.symbol.includes(q) || (mmap[e.symbol]?.name || '').toUpperCase().includes(q))) return false;
      return true;
    });

    const rzOf = C.realizedByTxId(); // 賣出 tx.id → 已實現（同檔同日多筆賣出不會互相蓋掉）
    const toTwd = hist.txFilter === 'all'; // 全部市場 → 金額一律換算台幣
    const sumCur = (hist.txFilter === 'us' || hist.txFilter === 'crypto') ? '$' : 'NT$';
    const convOf = sym => (isUsdMk(mktOf(sym)) && toTwd) ? rate : 1;

    // 依目前篩選統計：總投入＝買入成本、總獲利＝賣出已實現、股息＝現金股利合計、比例＝獲利／投入
    let totalInvest = 0, totalProfit = 0, totalDiv = 0;
    for (const e of filtered) {
      const conv = convOf(e.symbol);
      if (e.kind === 'tx' && e.tx.type === 'BUY') totalInvest += (e.tx.shares * e.tx.price + (e.tx.fee || 0)) * conv;
      else if (e.kind === 'tx' && e.tx.type === 'SELL') { const rz = rzOf[e.tx.id]; if (rz) totalProfit += rz.realizedPnl * conv; }
      else if (e.kind === 'cashdiv') totalDiv += (e.div.amount || 0) * conv;
    }

    // 搜尋 + 漏斗篩選 + 統計摘要（總投入／總獲利；有股息時多一格股息）
    const filterOn = hist.type !== 'all' || hist.txFilter !== 'all' || hist.from || hist.to;
    const divCell = totalDiv > 0 ? `<div class="hs-cell"><div class="hs-k">股息</div><div class="hs-v" style="color:${UI.pnlColor(1)}">+${sumCur} ${U.fmtKMBB(totalDiv)}</div></div>` : '';
    const grpBar = grp ? `<div class="hist-grp"><button class="gd-back" id="hist-back" aria-label="返回${esc(grp.name)}">‹</button><div class="hist-grp-t"><b>${esc(grp.name)}</b><span>${hist.type === 'sell' ? '賣出紀錄' : hist.type === 'buy' ? '買入紀錄' : hist.type === 'div' ? '股利紀錄' : '全部紀錄'}</span></div></div>` : '';
    fixedEl.innerHTML = `${grpBar}<div class="tx-bar">
      <input class="input search" id="tx-search" placeholder="搜尋代碼或名稱" value="${esc(hist.search)}">
      <button class="tx-funnel${filterOn ? ' on' : ''}" id="tx-funnel" aria-label="篩選"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg></button>
    </div>
    <div class="hist-sum">
      <div class="hs-cell"><div class="hs-k">總投入</div><div class="hs-v">${sumCur} ${U.fmtKMBB(totalInvest)}</div></div>
      <div class="hs-cell"><div class="hs-k">總獲利</div><div class="hs-v" style="color:${UI.pnlColor(totalProfit)}">${totalProfit >= 0 ? '+' : '−'}${sumCur} ${U.fmtKMBB(Math.abs(totalProfit))}</div></div>
      ${divCell}
    </div>`;

    let listHtml = `<div class="card tx-list">`;
    if (!filtered.length) listHtml += `<div class="empty">${filterOn || q ? '無符合篩選的紀錄' : '無紀錄'}</div>`;
    for (const e of filtered) {
      const name = esc(mmap[e.symbol]?.name || e.symbol);
      const isUsd = isUsdMk(mktOf(e.symbol));
      const cur = (isUsd && !toTwd) ? '$' : 'NT$';
      const dstr = U.isoDate(new Date(e.time));
      if (e.kind === 'cashdiv') {
        const amt = (e.div.amount || 0) * convOf(e.symbol);
        listHtml += `<div class="tx-row" data-kind="cashdiv" data-id="${e.div.id}">
          <span class="tx-type evt">股息</span>
          <div class="tx-main">
            <div class="tx-sym">${e.symbol} <span class="h-name">${name}</span></div>
            <div class="tx-sub">現金股利 · ${dstr}</div>
          </div>
          <div class="tx-meta"><div class="tx-amt" style="color:${UI.pnlColor(1)}">+${cur} ${U.fmtKMBB(amt)}</div></div>
        </div>`;
      } else if (e.kind === 'stockdiv') {
        listHtml += `<div class="tx-row" data-kind="stockdiv" data-id="${e.tx.id}">
          <span class="tx-type evt">配股</span>
          <div class="tx-main">
            <div class="tx-sym">${e.symbol} <span class="h-name">${name}</span></div>
            <div class="tx-sub">配股 +${U.formatShares(e.tx.shares)}${shareUnit(mmap[e.symbol]?.market)} · ${dstr}</div>
          </div>
          <div class="tx-meta"><div class="tx-amt" style="color:var(--sub)">＋股</div></div>
        </div>`;
      } else {
        const t = e.tx, conv = convOf(e.symbol);
        let valHtml;
        if (t.type === 'SELL') {
          const rz = rzOf[t.id];
          if (rz) {
            const pnl = rz.realizedPnl * conv;
            const base = rz.avgCost * rz.shares;
            const pct = base > 1e-9 ? rz.realizedPnl / base * 100 : 0;
            valHtml = `<div class="tx-amt" style="color:${UI.pnlColor(pnl)}">${pnl >= 0 ? '+' : '−'}${cur} ${U.fmtKMBB(Math.abs(pnl))}</div><div class="tx-cap" style="color:${UI.pnlColor(pnl)}">${U.fmtPct(pct)}</div>`;
          } else {
            valHtml = `<div class="tx-amt">${cur} ${U.fmtKMBB(t.shares * t.price * conv)}</div>`;
          }
        } else {
          const cost = (t.shares * t.price + (t.fee || 0)) * conv;
          valHtml = `<div class="tx-amt">${cur} ${U.fmtKMBB(cost)}</div>`;
        }
        listHtml += `<div class="tx-row" data-kind="tx" data-id="${t.id}">
          <span class="tx-type ${t.type === 'BUY' ? 'buy' : 'sell'}">${t.type === 'BUY' ? 'Buy' : 'Sell'}</span>
          <div class="tx-main">
            <div class="tx-sym">${t.symbol} <span class="h-name">${name}</span></div>
            <div class="tx-sub">${U.formatShares(t.shares)}${shareUnit(mmap[t.symbol]?.market)} @ ${U.formatPrice(t.price)} · ${dstr}</div>
          </div>
          <div class="tx-meta">${valHtml}</div>
        </div>`;
      }
    }
    listHtml += `</div>`;
    scrollEl.innerHTML = listHtml;

    { const hb = fixedEl.querySelector('#hist-back'); if (hb) hb.addEventListener('click', () => { leaveGroupHist(); App.switchTab('assets'); }); }
    const se = fixedEl.querySelector('#tx-search');
    se.addEventListener('input', e => { hist.search = e.target.value; });
    se.addEventListener('change', () => histTx(fixedEl, scrollEl));
    fixedEl.querySelector('#tx-funnel').addEventListener('click', () => openHistFilter(fixedEl, scrollEl));
    const rerender = () => histTx(fixedEl, scrollEl);
    scrollEl.querySelectorAll('.tx-row').forEach(r => r.addEventListener('click', () => {
      const kind = r.dataset.kind, id = r.dataset.id;
      if (kind === 'cashdiv') {
        const d = S.getDividends().find(x => x.id === id);
        if (d) openDividendForm('cash', d, rerender);
      } else if (kind === 'stockdiv') {
        const tx = S.getTransactions().find(t => t.id === id);
        if (tx) openDividendForm('stock', { id: tx.id, symbol: tx.symbol, name: mmap[tx.symbol]?.name || tx.symbol, market: mmap[tx.symbol]?.market, shares: tx.shares, date: U.isoDate(new Date(tx.time)) }, rerender);
      } else {
        const tx = S.getTransactions().find(t => t.id === id);
        if (tx) openTxForm(tx);
      }
    }));
  }

  // 歷史篩選面板（漏斗）：買賣類型 / 市場 / 時間區間
  function openHistFilter(fixedEl, scrollEl) {
    let tType = hist.type, tMkt = hist.txFilter;
    const segRow = (id, cur, opts) => `<div class="seg seg-wide" id="${id}">${opts.map(([v, l]) => seg(v, l, cur)).join('')}</div>`;
    const body = `
      <div class="flt-grp"><div class="flt-lbl">類型</div>${segRow('flt-type', tType, [['all', '全部'], ['buy', '買入'], ['sell', '賣出'], ['div', '股利']])}</div>
      <div class="flt-grp"><div class="flt-lbl">市場</div>${segRow('flt-mkt', tMkt, [['all', '全部'], ['tw', '台股'], ['us', '美股'], ['crypto', '加密']])}</div>
      <div class="flt-grp"><div class="flt-lbl">時間區間</div><div class="range-dates"><input type="date" class="input" id="flt-from" value="${hist.from || ''}"><span>至</span><input type="date" class="input" id="flt-to" value="${hist.to || U.isoDate()}"></div></div>`;
    const ov = UI.openSheet('篩選', body, `<button class="btn btn-ghost" id="flt-reset">重設</button><button class="btn btn-primary" id="flt-apply">套用</button>`);
    const bindSeg = (id, setv) => ov.querySelectorAll(`#${id} .seg-btn`).forEach(b => b.addEventListener('click', () => {
      setv(b.dataset.v);
      ov.querySelectorAll(`#${id} .seg-btn`).forEach(x => x.classList.toggle('active', x === b));
    }));
    bindSeg('flt-type', v => tType = v);
    bindSeg('flt-mkt', v => tMkt = v);
    ov.querySelector('#flt-reset').addEventListener('click', () => {
      hist.type = 'all'; hist.txFilter = 'all'; hist.from = null; hist.to = null;
      UI.closeSheet(); histTx(fixedEl, scrollEl);
    });
    ov.querySelector('#flt-apply').addEventListener('click', () => {
      hist.type = tType; hist.txFilter = tMkt;
      let a = ov.querySelector('#flt-from').value || null, b = ov.querySelector('#flt-to').value || null;
      if (a && b && a > b) { const x = a; a = b; b = x; }
      if (b && b >= U.isoDate()) b = null;   // 結束日預設今天：選今天＝不設上限（明天也照樣到當天）
      hist.from = a; hist.to = b;
      UI.closeSheet(); histTx(fixedEl, scrollEl);
    });
  }

  /* ===================== 報表 ===================== */
  const rep = { mode: 'yearly', year: new Date().getFullYear(), month: null, asc: false, statsPage: false,
    cal: { cat: 'all', gid: null, menu: false }, grpCache: null, grpLoading: null, grpError: null }; // 鑽取：年→月→日；列表預設倒序（新→舊）
  function resetReportNav() { rep.mode = 'yearly'; rep.month = null; rep.statsPage = false; closeCalMenu(); } // 進報表一律回年報表
  // 欄位 → 圖表標題 / 表頭底線色（藍：淨資產/投入；綠：損益/已未實現）
  const REP_COLS = {
    netAsset: { title: '總倉位', underline: '#4A82C8' },
    newInvestment: { title: '本期投入', underline: '#4A82C8' },
    periodPnl: { title: '本期損益', underline: '#3DAA6A' },
    realizedUnrealized: { title: '未實現 / 已實現', underline: '#3DAA6A' },
  };

  // 淨資產：快照有 netWorth 直接用；舊快照以「市值 + 目前現金 − 目前負債」回填
  //（避免新舊定義混用造成斷崖）
  function nwOf(s, cl) {
    if (s.netWorth != null) return s.netWorth;
    const mv = s.totalMarketValueTwd != null ? s.totalMarketValueTwd : (s.netAsset || 0);
    return mv + cl.cashTwd - cl.liabTwd;
  }

  function periodReports() {
    const snaps = S.getSnapshots().slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const cl = C.cashLiabTwd();
    if (rep.mode === 'yearly') {
      const byYear = {};
      for (const s of snaps) byYear[s.date.slice(0, 4)] = s;
      const years = Object.keys(byYear).sort();
      return years.map((y, i) => {
        const r = mkReport(y, byYear[y], i > 0 ? byYear[years[i - 1]] : null, cl);
        r.key = +y; return r;
      });
    }
    if (rep.mode === 'monthly') {
      const ys = String(rep.year);
      const byMonth = {};
      for (const s of snaps) if (s.date.slice(0, 4) === ys) byMonth[s.date.slice(5, 7)] = s;
      const prevYearLast = snaps.filter(s => s.date.slice(0, 4) === String(rep.year - 1)).pop() || null;
      const months = Object.keys(byMonth).sort();
      return months.map((m, i) => {
        const r = mkReport(+m + '月', byMonth[m], i === 0 ? prevYearLast : byMonth[months[i - 1]], cl);
        r.key = +m; return r;
      });
    }
    // daily：指定年月的每日損益 = 當日累計 − 前一日（台股日為界）
    const ym = String(rep.year) + '-' + String(rep.month).padStart(2, '0');
    const inMonth = snaps.filter(s => s.date.slice(0, 7) === ym);
    const prevBefore = snaps.filter(s => s.date < ym + '-01').pop() || null;
    return inMonth.map((s, i) => {
      const r = mkReport(+s.date.slice(5, 7) + '/' + +s.date.slice(8, 10), s, i === 0 ? prevBefore : inMonth[i - 1], cl);
      r.key = +s.date.slice(8, 10); return r;
    });
  }
  const futOf = x => (x.futRealizedPnl || 0) + (x.futUnrealizedTwd || 0);
  function mkReport(label, s, prev, cl) {
    const cost = C.capitalBase(s);                                     // 投入本金：股票成本 + 期貨入金（損益含期貨）
    const pPnl = s.totalPnl - (prev ? prev.totalPnl : 0);
    const cumDiv = C.dividendsUpTo(s.date);                            // 累計股利至本期(TWD)
    const periodDiv = cumDiv - (prev ? C.dividendsUpTo(prev.date) : 0); // 本期收到股息
    return {
      label,
      // 總倉位 = 台股 + 美股 + 加密 總市值（欄位名沿用 netAsset 以相容既有圖表）
      netAsset: s.totalMarketValueTwd != null ? s.totalMarketValueTwd : (s.netAsset || 0),
      // 本期投入：由交易直接算（FX 中性），避免匯率漂移在無交易期間造成假投入
      newInvestment: C.investedBetween(prev ? prev.date : null, s.date),
      periodPnl: pPnl,
      totalPnl: s.totalPnl,
      returnPct: s.totalReturnPct,
      periodReturnPct: cost > 1e-9 ? pPnl / cost * 100 : 0,
      dividendCum: cumDiv,
      periodDividend: periodDiv,
      returnWithDivPct: cost > 1e-9 ? (s.totalPnl + cumDiv) / cost * 100 : 0,
      // 含息損益 = 資本損益 + 股息（累計損益/本期損益 一律用此）
      periodPnlDiv: pPnl + periodDiv,
      periodReturnDivPct: cost > 1e-9 ? (pPnl + periodDiv) / cost * 100 : 0,
      periodRealizedPnl: s.realizedPnl - (prev ? prev.realizedPnl : 0),
      unrealizedPnl: s.unrealizedPnl,
      // 期貨（已實現淨費用 + 未平倉；舊快照無此欄 → 0）
      futPnl: futOf(s) - (prev ? futOf(prev) : 0),
      futCum: futOf(s),
    };
  }

  // 迷你走勢（sparkline）：以 totalPnl 序列畫面積線；stroke 不隨拉伸變粗
  function sparklineHtml(vals, color) {
    vals = (vals || []).filter(v => typeof v === 'number' && isFinite(v));
    if (vals.length < 2) return '';
    let pts = vals;
    const N = 44;
    if (vals.length > N) { const step = vals.length / N; pts = []; for (let i = 0; i < N; i++) pts.push(vals[Math.floor(i * step)]); pts.push(vals[vals.length - 1]); }
    const W = 300, H = 52, pad = 4;
    let lo = Math.min(...pts), hi = Math.max(...pts);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const xAt = i => pts.length > 1 ? i / (pts.length - 1) * W : W / 2;
    const yAt = v => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
    const line = pts.map((v, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1)).join(' ');
    const fill = color === UI.LOSS ? 'rgba(67,160,71,0.13)' : color === UI.GAIN ? 'rgba(229,57,53,0.13)' : 'rgba(109,95,213,0.13)';
    // stroke 走 style 而非 SVG 屬性：CSS 變數(var(--gain))只在 style 內生效
    return `<svg class="rep-spark" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${line} L${W} ${H} L0 ${H} Z" style="fill:${fill}"/>
      <path d="${line}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  function report(root) {
    if (rep.statsPage) return reportStatsPage(root);
    const cl = C.cashLiabTwd();
    const allSnaps = S.getSnapshots().slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const reports = periodReports();

    // 統計入口圖示（右上角）
    const statsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V10M12 21V4M19 21v-7"/></svg>`;
    // 固定頂部：年報表無返回；月/日報表有返回鈕 + 標題（月/日再加本期損益 Hero）
    let topHtml;
    if (rep.mode === 'yearly') {
      topHtml = `<div class="rep-head"><div class="rep-head-title">年報表</div><button class="rep-stats-btn" id="rep-stats-open" aria-label="統計">${statsIcon}</button></div>`;
      // 累計概況：Hero 累計損益 + 2×2 資訊卡（累計損益 / 目前市值 / 未實現 / 已實現）
      if (allSnaps.length) {
        const last = allSnaps[allSnaps.length - 1];
        const hero = mkReport('', last, null, cl);
        const col = UI.pnlColor(hero.periodPnlDiv);
        topHtml += `<div class="rep-hero">
          <div class="nw-cap">累計損益${hero.dividendCum > 0 ? ' · 含息' : ''}</div>
          <div class="rep-heroline"><span class="nw-num" style="color:${col}">${U.fmtBannerSigned(hero.periodPnlDiv)}</span><span class="rep-heropct" style="color:${UI.pnlColor(hero.periodReturnDivPct || 0)}">${U.fmtPct(hero.periodReturnDivPct)}</span></div>
          ${sparklineHtml(allSnaps.map(s => (s.totalPnl || 0) + C.dividendsUpTo(s.date)), col)}
          <div class="rep-chips">
            <span>投入本金 <b>NT$ ${U.fmtKMBB(last.totalCostBasisTwd)}</b></span>
            <span>目前市值 <b>NT$ ${U.fmtKMBB(last.totalMarketValueTwd || 0)}</b></span>
            <span>未實現 <b style="color:${UI.pnlColor(last.unrealizedPnl)}">${U.fmtBannerSigned(last.unrealizedPnl)}</b></span>
            <span>已實現 <b style="color:${UI.pnlColor(last.realizedPnl)}">${U.fmtBannerSigned(last.realizedPnl)}</b></span>
            ${Math.abs(hero.futCum) > 0.5 ? `<span>期貨 <b style="color:${UI.pnlColor(hero.futCum)}">${U.fmtBannerSigned(hero.futCum)}</b></span>` : ''}
            ${hero.dividendCum > 0 ? `<span>股息 <b style="color:${UI.pnlColor(1)}">${U.fmtBannerSigned(hero.dividendCum)}</b></span>` : ''}
          </div>
        </div>`;
      }
    } else {
      topHtml = `<div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">${rep.mode === 'monthly' ? rep.year + ' 年' : rep.year + '年 ' + rep.month + '月'}</div><div class="gd-actions"><button class="gd-stats" id="rep-stats-open" aria-label="統計">${statsIcon}</button></div></div>`;
      let hSnaps, hPrev, hLabel;
      if (rep.mode === 'monthly') {
        const ys = String(rep.year);
        hSnaps = allSnaps.filter(s => s.date.slice(0, 4) === ys);
        hPrev = allSnaps.filter(s => s.date < ys + '-01-01').pop() || null;
        hLabel = rep.year + '年 本期損益';
      } else {
        const ym = String(rep.year) + '-' + String(rep.month).padStart(2, '0');
        hSnaps = allSnaps.filter(s => s.date.slice(0, 7) === ym);
        hPrev = allSnaps.filter(s => s.date < ym + '-01').pop() || null;
        hLabel = rep.year + '年' + rep.month + '月 本期損益';
      }
      const hero = hSnaps.length ? mkReport('', hSnaps[hSnaps.length - 1], hPrev, cl) : null;
      if (hero) {
        const col = UI.pnlColor(hero.periodPnlDiv);
        topHtml += `<div class="rep-hero">
          <div class="nw-cap">${hLabel}${hero.periodDividend > 0 ? ' · 含息' : ''}</div>
          <div class="rep-heroline"><span class="nw-num" style="color:${col}">${U.fmtBannerSigned(hero.periodPnlDiv)}</span><span class="rep-heropct" style="color:${UI.pnlColor(hero.periodReturnDivPct || 0)}">${U.fmtPct(hero.periodReturnDivPct)}</span></div>
          ${sparklineHtml(hSnaps.map(s => (s.totalPnl || 0) + C.dividendsUpTo(s.date)), col)}
          ${Math.abs(hero.futPnl) > 0.5 ? `<div class="rep-chips"><span>股票 <b style="color:${UI.pnlColor(hero.periodPnl - hero.futPnl)}">${U.fmtBannerSigned(hero.periodPnl - hero.futPnl)}</b></span><span>期貨 <b style="color:${UI.pnlColor(hero.futPnl)}">${U.fmtBannerSigned(hero.futPnl)}</b></span>${hero.periodDividend > 0 ? `<span>股息 <b style="color:${UI.pnlColor(1)}">${U.fmtBannerSigned(hero.periodDividend)}</b></span>` : ''}</div>` : ''}
        </div>`;
      }
    }

    // 捲動內容
    let listHtml = '';
    if (rep.mode === 'daily') {
      listHtml = `<div class="card rep-cal" id="rep-cal"></div>`;   // 月份頁：每日損益月曆（paintCalendar 填入）
    } else if (!reports.length) {
      listHtml = `<div class="empty">${rep.mode === 'yearly' ? '暫無報表資料，使用一段時間後每日快照將彙整於此' : '此期間暫無資料'}</div>`;
    } else {
      // 期間列表：年→月、月→日 可鑽入（日為葉層）；預設倒序（新→舊）
      const drill = rep.mode !== 'daily';
      const head = rep.mode === 'yearly' ? '各年度' : rep.mode === 'monthly' ? '各月' : '各日';
      listHtml += `<div class="card rep-periods">
        <div class="rep-periods-head"><span>${head}</span><button class="rep-sort" id="rep-sort">排序 ${rep.asc ? '▲' : '▼'}</button></div>`;
      const rowsOrder = rep.asc ? reports : [...reports].reverse();
      for (const r of rowsOrder) {
        listHtml += `<div class="rep-prow${drill ? ' rep-prow-drill' : ''}"${drill ? ` data-key="${r.key}"` : ''}>
          <div class="rep-prow-main">
            <div class="rep-prow-lbl">${r.label}<span class="rep-prow-na">${U.fmtKMBB(r.netAsset)}</span></div>
            <div class="rep-prow-sub">投入 ${U.fmtBannerSigned(r.newInvestment)}${r.periodDividend > 0 ? ' · 股息 ' + U.fmtBannerSigned(r.periodDividend) : ''}${Math.abs(r.futPnl) > 0.5 ? ' · 期貨 ' + U.fmtBannerSigned(r.futPnl) : ''}</div>
          </div>
          <div class="rep-prow-val">
            <div class="rep-prow-pnl" style="color:${UI.pnlColor(r.periodPnlDiv)}">${U.fmtBannerSigned(r.periodPnlDiv)}</div>
            <div class="rep-prow-pct" style="color:${UI.pnlColor(r.periodReturnDivPct)}">${U.fmtPct(r.periodReturnDivPct)}</div>
          </div>
          ${drill ? '<span class="rep-prow-chev">›</span>' : ''}
        </div>`;
      }
      listHtml += `</div>`;
    }

    root.innerHTML = `<div class="page"><div class="page-top">${topHtml}</div><div class="page-list">${listHtml}</div></div>`;
    bindReportHead(root);
    if (rep.mode === 'daily') paintCalendar(root);

    const sortBtn = root.querySelector('#rep-sort');
    if (sortBtn) sortBtn.addEventListener('click', () => { rep.asc = !rep.asc; report(root); });
    const statsBtn = root.querySelector('#rep-stats-open');
    if (statsBtn) statsBtn.addEventListener('click', () => { rep.statsPage = true; report(root); });
    root.querySelectorAll('.rep-prow-drill').forEach(rw => rw.addEventListener('click', () => {
      const key = +rw.dataset.key;
      if (rep.mode === 'yearly') { rep.year = key; rep.mode = 'monthly'; }
      else { rep.month = key; rep.mode = 'daily'; }
      report(root);
    }));
  }
  // ── 月份頁每日損益月曆 ──
  // 每格：日期＋當日盈虧＋當日比例（盈虧 ÷ 前一日部位；股息不顯示比例）；左上下拉選單切換 總損益／台股／美股／期貨／加密／股息／各群組，右上為該分類本月合計
  // 群組：每日快照沒有分群組的數字 → 用成員歷史股價回算（fetchGroupSeries，需連網；結果快取到當天或交易筆數變動為止）
  const CAL_CATS = [['all', '總損益'], ['tw', '台股'], ['us', '美股'], ['fut', '期貨'], ['crypto', '加密'], ['div', '股息']];
  function calCats() { return CAL_CATS.filter(c => c[0] !== 'fut' || (App.ViewsFutures && App.ViewsFutures.visible())); }
  function closeCalMenu() {
    rep.cal.menu = false;
    if (rep.cal._off) { document.removeEventListener('pointerdown', rep.cal._off, true); rep.cal._off = null; }
  }
  // 群組序列：有快取直接回傳；否則開始抓、回 null（抓完自動重繪）
  function calGroupSeries(gid, root) {
    const key = gid + '|' + S.getTransactions().length + '|' + U.isoDate();
    if (rep.grpCache && rep.grpCache.key === key) return rep.grpCache.series;
    if (rep.grpLoading === key || rep.grpError === key) return null;
    rep.grpLoading = key;
    const gmap = S.getGroupMap();
    fetchGroupSeries(Object.keys(gmap).filter(x => gmap[x] === gid))
      .then(series => { rep.grpCache = { key, series }; })
      .catch(e => { console.error(e); rep.grpError = key; UI.toast('載入群組損益失敗', 'error'); })
      .then(() => { rep.grpLoading = null; if (rep.mode === 'daily' && root.querySelector('#rep-cal')) paintCalendar(root); });
    return null;
  }
  function paintCalendar(root) {
    const host = root.querySelector('#rep-cal');
    if (!host) return;
    const c = rep.cal, groups = S.getGroups(), cats = calCats();
    if (c.cat === 'group' && !groups.some(g => g.id === c.gid)) { c.cat = 'all'; c.gid = null; }   // 群組已刪除
    if (c.cat !== 'group' && !cats.some(x => x[0] === c.cat)) c.cat = 'all';
    const label = c.cat === 'group' ? groups.find(g => g.id === c.gid).name : cats.find(x => x[0] === c.cat)[1];

    // 資料：{days, sum}；群組載入中／失敗 → data = null
    let data = null, note = '';
    if (c.cat === 'group') {
      const gmap = S.getGroupMap(), symbols = Object.keys(gmap).filter(x => gmap[x] === c.gid);
      const series = calGroupSeries(c.gid, root);
      if (series) data = C.groupCalendarPnl(symbols, series, rep.year, rep.month);
      else note = rep.grpLoading ? '載入群組損益中…' : '<button class="cal-retry" id="cal-retry">載入失敗，點此重試</button>';
    } else data = C.calendarPnl(rep.year, rep.month, c.cat);

    const first = new Date(rep.year, rep.month - 1, 1).getDay(), nDays = new Date(rep.year, rep.month, 0).getDate();
    const tp = U.taipeiParts(), today = tp.year === rep.year && tp.month === rep.month ? tp.day : 0;
    const days = data ? data.days : {}, pct = data && data.pct || {};
    let max = 0; for (const k in days) max = Math.max(max, Math.abs(days[k]));
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<div class="cal-c pad"></div>';
    for (let d = 1; d <= nDays; d++) {
      const v = days[d], td = d === today ? ' today' : '';
      if (v == null || Math.abs(v) < 0.5) { cells += `<div class="cal-c none${td}"><span class="cal-d">${d}</span></div>`; continue; }
      const lvl = Math.abs(v) / max > 0.6 ? 3 : Math.abs(v) / max > 0.25 ? 2 : 1;
      const p = pct[d] == null ? '' : U.fmtCalPct(pct[d]);
      cells += `<div class="cal-c ${v > 0 ? 'g' : 'l'}${lvl}${td}"><span class="cal-d">${d}</span><span class="cal-v${Math.abs(v) >= 1e7 ? ' sm' : ''}">${U.fmtCalCell(v)}</span>${p ? `<span class="cal-p">${p}</span>` : ''}</div>`;
    }
    const mi = (cat, gid, text, sub) => {
      const on = c.cat === cat && (cat !== 'group' || c.gid === gid);
      return `<button class="cal-mi${on ? ' on' : ''}${sub ? ' sub' : ''}" data-cat="${cat}"${gid ? ` data-gid="${esc(gid)}"` : ''}><span>${text}</span>${on ? '<b>✓</b>' : ''}</button>`;
    };
    const menu = c.menu ? `<div class="cal-menu">${cats.map(x => mi(x[0], null, x[1])).join('')}${groups.length ? `<div class="cal-mh">群組</div>${groups.map(g => mi('group', g.id, esc(g.name), true)).join('')}` : ''}</div>` : '';
    host.innerHTML = `<div class="cal-top"><button class="cal-dd${c.menu ? ' open' : ''}" id="cal-dd"><span>${esc(label)}</span><i>▾</i></button>
        ${data ? `<b class="cal-sum" style="color:${UI.pnlColor(data.sum)}">${Math.abs(data.sum) < 0.5 ? '0' : U.fmtBannerSigned(data.sum)}</b>` : ''}</div>${menu}
      <div class="cal-wk"><span class="we">日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span class="we">六</span></div>
      ${note ? `<div class="cal-note">${note}</div>` : `<div class="cal-grid">${cells}</div>`}`;

    host.querySelector('#cal-dd').addEventListener('click', () => {
      if (c.menu) { closeCalMenu(); return paintCalendar(root); }
      c.menu = true;
      // 點選單以外的地方 → 關閉
      c._off = e => { if (e.target.closest && (e.target.closest('.cal-menu') || e.target.closest('#cal-dd'))) return; closeCalMenu(); if (root.querySelector('#rep-cal')) paintCalendar(root); };
      document.addEventListener('pointerdown', c._off, true);
      paintCalendar(root);
    });
    host.querySelectorAll('.cal-mi').forEach(b => b.addEventListener('click', () => {
      c.cat = b.dataset.cat; c.gid = b.dataset.gid || null;
      closeCalMenu(); paintCalendar(root);
    }));
    const retry = host.querySelector('#cal-retry');
    if (retry) retry.addEventListener('click', () => { rep.grpError = null; paintCalendar(root); });
  }

  // 統計頁（點統計入口後開啟）：依目前報表層級決定範圍
  //   年報表→全部歷史；某年→該年度；某月→該月度。返回回到同層列表。
  function reportStatsPage(root) {
    let scope, title;
    if (rep.mode === 'yearly') { scope = { level: 'all' }; title = '全部歷史 統計'; }
    else if (rep.mode === 'monthly') { scope = { level: 'year', from: rep.year + '-01-01', to: rep.year + '-12-31' }; title = rep.year + '年 統計'; }
    else { const ym = String(rep.year) + '-' + String(rep.month).padStart(2, '0'); scope = { level: 'month', from: ym + '-01', to: ym + '-31' }; title = rep.year + '年' + rep.month + '月 統計'; }
    const topHtml = `<div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">${title}</div><div class="gd-actions"></div></div>`;
    root.innerHTML = `<div class="page"><div class="page-top">${topHtml}</div><div class="page-list">${statsCardsHtml(scope)}</div></div>`;
    root.querySelector('.gd-back').addEventListener('click', () => { rep.statsPage = false; report(root); });
  }
  function bindReportHead(root) {
    const back = root.querySelector('.gd-back');
    if (back) back.addEventListener('click', () => {
      if (rep.mode === 'daily') { rep.mode = 'monthly'; rep.month = null; }
      else if (rep.mode === 'monthly') rep.mode = 'yearly';
      report(root);
    });
  }

  /* ===================== 資產（淨資產）===================== */
  // 手風琴：一次只展開一類（cash|invest|liab）；detailGroup = 群組詳情頁
  //   nw/gt 僅保留各自的 metric（走勢/漲幅/投入）與 year（漲幅選年）；時間區間改用共用的 chartRange
  const as = { openCat: null, detailGroup: null, groupAllocSel: null, detailFut: false, detailAsc: false, catChart: null, nw: { metric: 'net', year: new Date().getFullYear() },
    groupTrend: null, gt: { metric: 'line', year: new Date().getFullYear() }, gtCache: null,
    detailSym: null, stk: { mode: 'value', key: null, data: null, loading: null, error: null, range: { range: 'all', from: null, to: null } } };
  // 個股頁：mode＝value(市值與成本)｜price(股價與均價)；range＝走勢範圍（個股頁自己的，預設全部，進到個股頁時重設）
  // 淨資產／投資／群組／期貨走勢圖共用的範圍：預設全部，只在這次使用期間有效（不保存）
  const chartRange = { range: 'all', from: null, to: null };

  // 時間區間過濾（供淨資產圖 / 群組圖）：spec = {range:'all'|'ytd'|'custom', from, to}；items 皆有 .date
  function applyRange(items, spec) {
    if (!spec || spec.range === 'all') return items;
    if (spec.range === 'ytd') { const y0 = U.isoDate().slice(0, 4) + '-01-01'; return items.filter(s => s.date >= y0); }
    const from = spec.from, to = spec.to;
    return items.filter(s => (!from || s.date >= from) && (!to || s.date <= to));
  }
  // 依時間跨度自動決定分桶粒度（天/週/月/年），讓桶數與刻度合理、不過密
  function autoGran(fromIso, toIso) {
    if (!fromIso || !toIso) return 'day';
    const days = Math.round((Date.parse(toIso + 'T12:00:00+08:00') - Date.parse(fromIso + 'T12:00:00+08:00')) / 86400000) + 1;
    // 走勢折線盡量用每日資料：分桶只取每週／每月最後一天，會把期間內真正的高低點（含 ATH）吃掉
    if (days <= 800) return 'day';
    if (days <= 3650) return 'week';
    return 'month';
  }
  // X 軸標籤：稀疏到 ~7 個避免擠在一起；跨年份自動帶年份
  function chartLabels(buckets, gran) {
    if (!buckets.length) return { xLabels: [], labelFor: () => '' };
    const crossYear = buckets[0].date.slice(0, 4) !== buckets[buckets.length - 1].date.slice(0, 4);
    const fmt = i => {
      const p = buckets[i].date.split('-'), yy = p[0].slice(2), m = +p[1], d = +p[2];
      if (gran === 'year') return p[0];
      if (gran === 'month') return crossYear ? `${yy}/${m}` : `${m}月`;
      return crossYear ? `${yy}/${m}/${d}` : `${m}/${d}`; // day/week
    };
    const step = Math.max(1, Math.ceil(buckets.length / 7));
    const show = new Set();
    for (let i = 0; i < buckets.length; i += step) show.add(i);
    return { xLabels: [...show].sort((a, b) => a - b).map(i => ({ idx: i, label: fmt(i) })), labelFor: i => show.has(i) ? fmt(i) : '' };
  }
  // 走勢範圍不再常駐一排選項：改成圖例列最右邊的日曆圖示（bindRangeControl 會插到圖表上方），點了才跳出對話框
  function rangeControlHtml() { return ''; }
  const CAL_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>';
  function rangeLabel(rg) {
    const md = iso => (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10));
    return rg.range === 'ytd' ? '年初至今' : rg.range === 'custom' && rg.from ? md(rg.from) + '–' + (rg.to ? md(rg.to) : '今天') : '';
  }
  // 範圍對話框：全部／年初至今／選擇日期（選了才出現起訖日期；結束日預設今天）。按「套用」才生效
  function openRangeDialog(cur, firstDate, onApply) {
    const today = U.isoDate();
    let pick = cur.range;
    const RG = [['all', '全部'], ['ytd', '年初至今'], ['custom', '選擇日期']];
    const body = `<div class="seg seg-wide" id="sr-range" style="display:flex">${RG.map(([k, l]) => `<button class="seg-btn ${pick === k ? 'active' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="range-dates" id="sr-dates" style="${pick === 'custom' ? '' : 'display:none'}">
        <input type="date" class="input" id="sr-from" value="${cur.from || firstDate || today}" max="${today}"><span>至</span><input type="date" class="input" id="sr-to" value="${cur.to || today}">
      </div>`;
    const ov = UI.openSheet('走勢範圍', body, '<button class="btn btn-ghost" id="sr-cancel">取消</button><button class="btn btn-primary" id="sr-ok">套用</button>');
    ov.querySelectorAll('#sr-range .seg-btn').forEach(b => b.addEventListener('click', () => {
      pick = b.dataset.v;
      ov.querySelectorAll('#sr-range .seg-btn').forEach(x => x.classList.toggle('active', x === b));
      ov.querySelector('#sr-dates').style.display = pick === 'custom' ? '' : 'none';
    }));
    ov.querySelector('#sr-cancel').addEventListener('click', UI.closeSheet);
    ov.querySelector('#sr-ok').addEventListener('click', () => {
      let a = null, b = null;
      if (pick === 'custom') {
        a = ov.querySelector('#sr-from').value || firstDate || today; b = ov.querySelector('#sr-to').value || today;
        if (a > b) { const x = a; a = b; b = x; }
        if (b >= today) b = null;   // 到今天＝跟著今天走
      }
      UI.closeSheet(); onApply({ range: pick, from: a, to: b });
    });
  }
  // 年份選擇（供漲幅圖：選年份、月刻度）
  function yearControlHtml(spec, id, years) {
    if (!years.length) return '';
    return `<div class="chips" id="${id}-year">${years.map(y => `<button class="chip ${spec.year === y ? 'active' : ''}" data-v="${y}">${y}</button>`).join('')}</div>`;
  }
  function bindYearControl(root, spec, id, rerender) {
    root.querySelectorAll(`#${id}-year .chip`).forEach(b => b.addEventListener('click', () => { spec.year = +b.dataset.v; rerender(); }));
  }
  // spec 為各走勢圖頁共用的 chartRange（預設全部；只在這次使用期間有效，不保存）。
  //   在圖表（#<id>-chart）正上方插入一個不佔高度的定位點，把日曆圖示疊在圖例列的最右邊
  function bindRangeControl(root, spec, id, dates, rerender) {
    const host = root.querySelector(`#${id}-chart`);
    if (!host) return;
    const txt = rangeLabel(spec);
    host.insertAdjacentHTML('beforebegin', `<div class="rg-anchor"><button class="stk-cal rg-cal${spec.range !== 'all' ? ' on' : ''}" id="${id}-cal" aria-label="選擇走勢範圍，目前：${txt || '全部'}">${CAL_SVG}</button></div>`);
    root.querySelector(`#${id}-cal`).addEventListener('click', () =>
      openRangeDialog(spec, dates && dates.length ? dates[0] : null, r => { Object.assign(spec, r); rerender(); }));
  }
  // 點「資產」tab 時回到資產首頁（退出群組/走勢/淨資產詳情）
  function resetAssetsNav() { as.detailSym = null; as.detailGroup = null; as.groupTrend = null; as.catChart = null; as.detailFut = false; if (App.ViewsFutures && App.ViewsFutures.reset) App.ViewsFutures.reset(); }
  const AS_PURPLE = '#6D5FD5';

  function mvTwdOf(p, rate) {
    const m = U.normalizeMarketKey(p.market);
    return (m === U.Market.us || m === U.Market.crypto) ? p.marketValue * rate : p.marketValue;
  }
  // 資產頁群組分類列的副名稱：台股顯示名稱；美股/加密只顯示代號（名稱留空）
  function groupRowName(p) {
    const m = U.normalizeMarketKey(p.market);
    if (m === U.Market.us || m === U.Market.crypto) return '';
    return p.name && p.name !== p.symbol ? esc(p.name) : '';
  }

  // 槓桿分解 sheet：股票市值 ＋ 自訂倍數加計 ＋ 期貨契約值 ＝ 總曝險，÷ 淨資產
  function openLeverageSheet(l) {
    const kv = (k, v, cls) => `<div class="lev-kv${cls ? ' ' + cls : ''}"><span class="k">${k}</span><b>${v}</b></div>`;
    const sgn = v => (v < 0 ? '−' : '+') + U.fmtWhole(Math.abs(v));
    let body = kv('股票市值', U.fmtWhole(l.stockMv));
    for (const it of l.items) body += kv(`${dispName(it.symbol)} ×${it.mult}`, sgn(it.extra));
    if (l.cfg.futures !== 'none') body += kv('期貨契約值', sgn(l.futNotional));
    body += kv('總曝險', U.fmtWhole(l.exposure), 'tot');
    body += kv(l.cfg.liab === 'gross' ? '總資產（不扣負債）' : `淨資產${l.liabTwd > 0 ? '（已扣負債 ' + U.fmtWhole(l.liabTwd) + '）' : ''}`, U.fmtWhole(l.denom));
    body += `<div class="set-hint" style="margin-top:10px">槓桿 ＝ 總曝險 ÷ ${l.cfg.liab === 'gross' ? '總資產' : '淨資產'}。可在「設定 › 槓桿倍率」調整計算方式與各標的倍數。</div>`;
    UI.openSheet('槓桿 ' + (l.ratio == null ? '--' : l.ratio.toFixed(2) + '×'), body, '');
  }

  function assets(root) {
    if (as.catChart) return metricChartPage(root, as.catChart, () => { as.catChart = null; assets(root); });
    if (as.groupTrend) return groupTrendPage(root, as.groupTrend);
    if (as.detailSym) return stockDetail(root, as.detailSym, { get: () => as.detailSym, close: () => { as.detailSym = null; }, render: () => assets(root) });   // 個股頁（返回後回到原本那一頁）
    if (as.detailGroup) return groupDetail(root, as.detailGroup);
    if (as.detailFut) return App.ViewsFutures.page(root, () => { as.detailFut = false; assets(root); });
    const rate = S.getFxRate() || 31.5;
    const sum = C.assetsSummary();
    const positions = C.buildPositions();
    const groups = S.getGroups();
    // 期貨：有交易或已連結保證金帳戶才顯示卡；保證金帳戶從流動資金搬到期貨卡（權益數＝餘額＋未平倉），不重複算
    const futOn = !!(App.ViewsFutures && App.ViewsFutures.visible());
    const fut = sum.fut;
    const marginId = futOn && fut ? App.Futures.getState().accountId : null;
    const marginAcct = marginId ? S.getCashAccounts().find(a => a.id === marginId) : null;
    const cashShown = sum.cashTwd - (marginAcct ? (marginAcct.balance || 0) : 0);
    const gmap = S.getGroupMap();
    const basis = S.getPctBasis(); // group | invest | net

    // 依群組整理持倉
    const byGroup = {}; const ungrouped = [];
    for (const p of positions) {
      const gid = gmap[p.symbol];
      if (gid && groups.some(g => g.id === gid)) (byGroup[gid] = byGroup[gid] || []).push(p);
      else ungrouped.push(p);
    }
    const groupTotal = gid => (byGroup[gid] || []).reduce((s, p) => s + mvTwdOf(p, rate), 0);
    // 群組今日漲跌（TWD）：各持倉當日 × 股數 × 匯率
    // 台股日模式：美股白天未開盤 → 美股計 0；台股開盤前/週末 → 台股計 0（與 Hero 一致）
    const usGated = S.getDayMode() === 'twday' && !U.usCountsTowardToday();
    const twGated = S.getDayMode() === 'twday' && !U.twCountsTowardToday();
    const posDayTwd = p => {
      const mk = U.normalizeMarketKey(p.market);
      if (usGated && mk === U.Market.us) return 0;
      if (twGated && mk !== U.Market.us && mk !== U.Market.crypto) return 0; // 台股(上市/上櫃/興櫃)
      const conv = (mk === U.Market.us || mk === U.Market.crypto) ? rate : 1;
      return (p.dayPnl || 0) * conv;
    };
    const groupDayChg = gid => (byGroup[gid] || []).reduce((s, p) => s + posDayTwd(p), 0)
      + (positions.closedToday || []).filter(c => gmap[c.symbol] === gid).reduce((s, c) => s + posDayTwd(c), 0);   // 含今日賣光的標的
    const fmtPctBadge = v => (v >= 9.95 ? Math.round(v) : v.toFixed(v >= 1 ? 0 : 1)) + '%';
    // 佔比分母：組內=該群組、投資=投資總市值、淨資產=淨資產
    const denom = gTotal => basis === 'group' ? (gTotal || sum.investTwd) : basis === 'invest' ? sum.investTwd : sum.netWorth;

    // 今日淨資產漲跌（現金/負債日內不變，故等於投資日損益；紅漲綠跌）
    const dayChange = ((sum.invSummary && sum.invSummary.dayPnl) || 0) + (futOn && fut ? fut.dayPnl : 0);
    const prevNet = sum.netWorth - dayChange;
    const dayPct = Math.abs(prevNet) > 1e-9 ? dayChange / Math.abs(prevNet) * 100 : 0;
    const dayArrow = dayChange > 0 ? '▲' : dayChange < 0 ? '▼' : '–';
    const lev = S.getLeverage().show ? C.leverageSummary() : null; // 槓桿倍率（設定開啟才算）
    // ATH（歷史最高淨資產）：至少要有前一天的紀錄才顯示。目前就在歷史新高 → 數字金色特效（athNow），數字右邊加「突破歷史新高」標籤
    const ath = S.getSnapshots().length >= 2 ? C.athInfo(sum.netWorth) : null;
    const fmtAthDate = iso => (iso.slice(0, 4) === U.isoDate().slice(0, 4) ? '' : iso.slice(0, 4) + '/') + (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10));
    const athNow = !!(ath && ath.isToday);
    // 突破時：數字右邊放「突破歷史新高」標籤，下方不顯示 ATH 這行
    const athHtml = !ath || athNow ? ''
      : `<div class="nw-ath">ATH <b class="nw-ath-amt">${U.fmtWhole(ath.value)}</b> · ${fmtAthDate(ath.date)} · 距高點 <b>${ath.drawdownPct.toFixed(1)}%</b></div>`;
    // 特效的動畫相位用時間對齊（負的 animation-delay）：頁面每次重繪都會重建 DOM，不對齊的話光澤會一直跳回起點
    const athAttr = athNow ? ` style="--ath-d:-${Date.now() % 14400}ms"` : '';
    const athSparks = athNow ? '<i class="ath-sp s1"></i><i class="ath-sp s2"></i><i class="ath-sp s3"></i><i class="ath-sp s4"></i>' : '';
    // 固定頂部：淨資產 Hero（捲動時不動）
    const topHtml = `<div class="nw-hero${athNow ? ' ath' : ''}"${athAttr}>
      <div class="nw-open" id="nw-open">
        <div class="nw-cap">我的淨資產 (TWD)${eyeBtnHtml('as-eye')}</div>
        <div class="nw-numrow"><div class="nw-numwrap"><div class="nw-num">${U.fmtWhole(sum.netWorth)}</div>${athSparks}</div>${athNow ? '<span class="nw-ath-badge">突破歷史新高</span>' : ''}</div>
        <div class="nw-day"><span style="color:${UI.pnlColor(dayChange)}">${dayArrow} ${U.fmtWhole(Math.abs(dayChange))} (${Math.abs(dayPct).toFixed(2)}%)</span>${lev ? `<button class="nw-lev" id="as-lev">槓桿 ${lev.ratio == null ? '--' : lev.ratio.toFixed(2) + '×'}</button>` : ''}</div>
        ${athHtml}
      </div>
      <div class="nw-btns">
        ${addWithRefreshHtml('as-add-btn', '新增')}
      </div>
    </div>`;
    let html = ''; // 捲動內容：分類卡

    // 收合摘要文字 + 更新日期
    const cashAccts = S.getCashAccounts().filter(a => a.id !== marginId);
    const liabs = S.getLiabilities();
    const dateFrom = ts => ts ? (t => `${t.month}月${t.day}日 更新`)(U.taipeiParts(new Date(ts))) : '';
    const maxUpd = list => list.reduce((m, a) => Math.max(m, a.updatedAt || 0), 0);
    const cashSummary = cashAccts.map(a => esc(a.name)).join('、') || '尚無帳戶';
    const investSummary = [...groups.map(g => esc(g.name)), ungrouped.length ? '獨立持股' : null].filter(Boolean).join('、') || '尚無持倉';
    const liabSummary = liabs.map(a => esc(a.name)).join('、') || '尚無負債';

    // 佔總資產比例（總資產 = 流動資金 + 投資 + 期貨權益數）
    const grossAssets = cashShown + sum.investTwd + (futOn && fut ? fut.equity : 0);
    const pctOfAssets = v => grossAssets > 1e-9 ? v / grossAssets * 100 : 0;

    // 佔比環形圈（依類別上色、圈內顯示百分比；放大以容納 100%）
    function pctRing(pct, cc, ink) {
      const p = Math.max(0, Math.min(100, pct || 0));
      const r = 15.5, C = 2 * Math.PI * r, off = C * (1 - p / 100);
      const fs = Math.round(pct) >= 100 ? 9.5 : 11; // 三位數縮小字級
      return `<svg class="cat-ring" viewBox="0 0 36 36" width="42" height="42" aria-hidden="true">
        <circle cx="18" cy="18" r="${r}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="3"/>
        <circle cx="18" cy="18" r="${r}" fill="none" stroke="${cc}" stroke-width="3" stroke-linecap="round"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 18 18)"/>
        <text x="18" y="18" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-weight="700" fill="${ink}">${Math.round(pct)}%</text>
      </svg>`;
    }

    // 分類卡標頭（名稱前加佔總資產比例環圈；展開填色、收合顯示摘要+日期）
    // chg：{ v, base } → 右下顯示當日漲跌（取代更新日期；展開時也顯示，同期貨卡）
    function catHead(cat, name, totalHtml, cc, openCls, summary, dateTs, pct, chg) {
      const open = as.openCat === cat;
      const ink = openCls === 'oc-green' ? '#1E8E4E' : openCls === 'oc-purple' ? '#5A4FC0' : '#4A56B5';
      const ring = pct != null ? pctRing(pct, cc, ink) : '';
      const trendBtn = `<button class="as-htrend" data-trend="${cat}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M7 14l3.5-3.5 3 2.5L19 8"/></svg></button>`;
      const chgHtml = chg ? (() => {
        const d = chg.v || 0, pc = Math.abs(chg.base) > 1e-9 ? d / Math.abs(chg.base) * 100 : 0;
        return `<span class="as-hchg" style="color:${UI.pnlColor(d)}">${d > 0 ? '▲' : d < 0 ? '▼' : '–'} ${U.fmtWhole(Math.abs(d))} (${Math.abs(pc).toFixed(2)}%)</span>`;
      })() : (!open && dateTs ? `<span class="as-hdate">${dateFrom(dateTs)}</span>` : '');
      return `<div class="as-head ${open ? 'open ' + openCls : ''}" data-cat="${cat}" style="--cc:${cc}">
        <div class="as-hleft cat-hleft">
          ${ring}
          <div class="cat-txt">
            <div class="nm-line"><span class="as-name">${name}</span>${open ? trendBtn : ''}</div>
            ${!open ? `<span class="as-hsummary">${summary}</span>` : ''}
          </div>
        </div>
        <div class="as-hright">
          <span class="as-total">${totalHtml}</span>
          ${chgHtml}
        </div>
      </div>`;
    }

    // ── 流動資金 ─────────────────────────────────────────
    html += `<div class="card as-cat">` +
      catHead('cash', '流動資金', U.fmtWhole(cashShown), '#34C759', 'oc-green', cashSummary, maxUpd(cashAccts), pctOfAssets(cashShown));
    if (as.openCat === 'cash') {
      html += `<div class="as-body">`;
      for (const a of cashAccts) {
        const twd = a.currency === 'USD' ? (a.balance || 0) * rate : (a.balance || 0);
        html += `<div class="as-row" data-kind="cash" data-id="${a.id}">
          <div class="as-main"><div class="as-title">${esc(a.name)}</div>
            <div class="as-sub">${a.currency === 'USD' ? 'USD ' + U.formatPrice(a.balance || 0) + ' · r' + rate.toFixed(3) : '台幣帳戶'}</div></div>
          <div class="as-val">${U.fmtWhole(twd)}</div>
        </div>`;
      }
      if (!cashAccts.length) html += `<div class="empty" style="padding:14px">尚無現金帳戶，點右上角 ＋ 新增</div>`;
      html += `</div>`;
    }
    html += `</div>`;

    // ── 投資 ────────────────────────────────────────────
    html += `<div class="card as-cat">` +
      catHead('invest', '投資', U.fmtWhole(sum.investTwd), AS_PURPLE, 'oc-purple', investSummary, S.getPricesTs(), pctOfAssets(sum.investTwd),
        { v: (sum.invSummary && sum.invSummary.dayPnl) || 0, base: sum.investTwd - ((sum.invSummary && sum.invSummary.dayPnl) || 0) });
    if (as.openCat === 'invest') {
      html += `<div class="as-body">`;
      // 群組列（點擊進入詳情頁）
      for (const g of groups) {
        const gTotal = groupTotal(g.id);
        const gPct = (basis === 'net' ? sum.netWorth : sum.investTwd) > 1e-9
          ? gTotal / (basis === 'net' ? sum.netWorth : sum.investTwd) * 100 : 0;
        const gDay = groupDayChg(g.id);
        const gPrev = gTotal - gDay;
        const gDayPct = Math.abs(gPrev) > 1e-9 ? gDay / Math.abs(gPrev) * 100 : 0;
        const gArrow = gDay > 0 ? '▲' : gDay < 0 ? '▼' : '–';
        html += `<div class="as-grow" data-gid="${g.id}">
          <span class="pct-badge sm">${fmtPctBadge(gPct)}</span>
          <div class="as-main"><div class="as-title">${esc(g.name)}</div>
            <div class="as-sub">${(byGroup[g.id] || []).length} 檔 ›</div></div>
          <div class="as-gv">
            <div class="as-val">${U.fmtWhole(gTotal)}</div>
            <span class="as-hchg" style="color:${UI.pnlColor(gDay)}">${gArrow} ${U.fmtWhole(Math.abs(gDay))} (${Math.abs(gDayPct).toFixed(2)}%)</span>
          </div>
        </div>`;
      }
      // 未分組持倉（與群組同層）
      for (const p of ungrouped) {
        const mv = mvTwdOf(p, rate);
        const d = basis === 'group' ? sum.investTwd : denom(0); // 未分組無「組內」→ 用投資
        const pct = d > 1e-9 ? mv / d * 100 : 0;
        const isUsd = U.normalizeMarketKey(p.market) !== U.Market.tse && U.normalizeMarketKey(p.market) !== U.Market.otc && U.normalizeMarketKey(p.market) !== U.Market.rotc;
        html += `<div class="as-row member top" data-sym="${p.symbol}">
          <span class="pct-badge sm">${fmtPctBadge(pct)}</span>
          <div class="as-main"><div class="as-title">${p.symbol} <span class="h-name">${groupRowName(p)}</span></div>
            <div class="as-sub">持有 ${U.formatShares(p.shares)}, ${isUsd ? '$' : ''}${U.formatPrice(p.lastPrice != null ? p.lastPrice : p.avgCost)}</div></div>
          <div class="as-val">${U.fmtWhole(mv)}</div>
        </div>`;
      }
      if (!positions.length) html += `<div class="empty" style="padding:16px">尚無持倉，點右上角 ＋ 新增投資</div>`;
      html += `</div>`;
    }
    html += `</div>`;

    // ── 期貨（點卡進期貨頁）──
    if (futOn && fut) html += App.ViewsFutures.assetCardHtml(fut, pctOfAssets(fut.equity));

    // ── 負債 ────────────────────────────────────────────
    html += `<div class="card as-cat">` +
      catHead('liab', '負債', (sum.liabTwd > 0 ? '−' : '') + U.fmtWhole(sum.liabTwd), '#8E9BEF', 'oc-blue', liabSummary, maxUpd(liabs), pctOfAssets(sum.liabTwd));
    if (as.openCat === 'liab') {
      html += `<div class="as-body">`;
      for (const a of liabs) {
        const twd = a.currency === 'USD' ? (a.balance || 0) * rate : (a.balance || 0);
        html += `<div class="as-row" data-kind="liab" data-id="${a.id}">
          <div class="as-main"><div class="as-title">${esc(a.name)}</div>
            <div class="as-sub">${a.currency === 'USD' ? 'USD ' + U.formatPrice(a.balance || 0) : '台幣'}</div></div>
          <div class="as-val" style="color:${UI.GAIN}">−${U.fmtWhole(twd)}</div>
        </div>`;
      }
      if (!liabs.length) html += `<div class="empty" style="padding:14px">尚無負債，點右上角 ＋ 新增</div>`;
      html += `</div>`;
    }
    html += `</div>`;

    root.innerHTML = `<div class="page"><div class="page-top">${topHtml}</div><div class="page-list">${html}</div></div>`;
    attachPullRefresh(root.querySelector('.page-list'));

    // ── 事件 ─────────────────────────────────────────────
    root.querySelectorAll('.as-head').forEach(h => h.addEventListener('click', () => {
      const k = h.dataset.cat;
      if (k === 'fut') { as.detailFut = true; assets(root); return; }
      as.openCat = (as.openCat === k) ? null : k; // 再點一次收合；否則只展開被點的
      assets(root);
    }));
    root.querySelectorAll('.as-htrend[data-trend]').forEach(t => t.addEventListener('click', e => {
      e.stopPropagation(); // 不觸發標頭收合
      as.catChart = t.dataset.trend; assets(root);
    }));
    const bind = (sel, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener('click', fn); };
    bind('#as-add-btn', () => openAddChooser(() => assets(root)));
    bindRefresh(root);
    bind('#nw-open', () => { as.catChart = 'nw'; assets(root); });
    { const lb = root.querySelector('#as-lev'); if (lb) lb.addEventListener('click', e => { e.stopPropagation(); openLeverageSheet(lev); }); }
    { const eye = root.querySelector('#as-eye'); if (eye) eye.addEventListener('click', e => { e.stopPropagation(); S.setPrivacy(!S.getPrivacy()); assets(root); }); }
    root.querySelectorAll('.as-row[data-kind]').forEach(r => r.addEventListener('click', () => {
      const kind = r.dataset.kind;
      const list = kind === 'cash' ? S.getCashAccounts() : S.getLiabilities();
      openMoneyForm(kind, list.find(x => x.id === r.dataset.id), () => assets(root));
    }));
    root.querySelectorAll('.as-grow').forEach(g => g.addEventListener('click', () => {
      as.detailGroup = g.dataset.gid; assets(root);
    }));
    root.querySelectorAll('.as-row.member').forEach(r => r.addEventListener('click', () => openStock(root, r.dataset.sym)));
    maskAmounts(root);
    if (athNow) athBurstOnce();
  }

  // ATH 進場特效：從淨資產數字向外噴出金色光點＋一圈光環。每次開啟 App 每天只播一次；
  //   掛在 body 上（position: fixed），資產頁之後重繪也不會被打斷。鎖定畫面還在、或系統設定減少動態效果 → 不播
  function athBurstOnce() {
    const key = 'dives_ath_fx', today = U.isoDate();
    try { if (sessionStorage.getItem(key) === today) return; } catch (e) { return; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setTimeout(() => {   // 等分頁滑入動畫結束再量位置
      const num = document.querySelector('.nw-hero.ath .nw-num');
      if (!num || document.getElementById('lock-overlay') || document.querySelector('.ath-burst')) return;
      const r = num.getBoundingClientRect();
      if (!r.width) return;
      try { if (sessionStorage.getItem(key) === today) return; sessionStorage.setItem(key, today); } catch (e) { return; }
      const host = document.createElement('div');
      host.className = 'ath-burst';
      host.style.left = (r.left + r.width / 2) + 'px';
      host.style.top = (r.top + r.height / 2) + 'px';
      let html = '<i class="ath-ring"></i><i class="ath-ring r2"></i>';
      const N = 22;
      for (let i = 0; i < N; i++) {
        const a = i / N * 360 + (i % 2 ? 7 : -5), d = 78 + (i * 37) % 74, s = 4 + (i * 13) % 5, delay = (i * 29) % 140;
        html += `<i class="ath-p${i % 3 === 0 ? ' star' : ''}" style="--a:${a.toFixed(1)}deg;--d:${d}px;--s:${s}px;animation-delay:${delay}ms"></i>`;
      }
      host.innerHTML = html;
      document.body.appendChild(host);
      num.classList.add('ath-pop');
      setTimeout(() => host.remove(), 2000);
    }, 340);
  }

  // 淨資產長條圖頁：淨資產 / 漲幅；X 軸 天(7)／週(5)／月(12)／年(10)
  // 分桶邏輯抽到 App.Calc.netWorthBuckets（純函式、有測試涵蓋，SPEC §6）
  function nwBuckets(gran) {
    return C.netWorthBuckets(S.getSnapshots(), gran, C.cashLiabTwd());
  }

  const METRIC_META = {
    nw: { title: '淨資產', color: '#2F80ED' }, cash: { title: '資金', color: '#34C759' },
    invest: { title: '投資', color: '#6D5FD5' }, liab: { title: '負債', color: '#E8823C' },
    us: { title: '美股', color: '#4A82C8' }, tw: { title: '台股', color: '#E8823C' }, crypto: { title: '加密貨幣', color: '#9B59D0' },
  };
  function metricSeries(key, snaps, cl) {
    const f = {
      nw: s => nwOf(s, cl),
      cash: s => s.cashAccountsTwd != null ? s.cashAccountsTwd : cl.cashTwd,
      invest: s => s.totalMarketValueTwd || 0,
      liab: s => s.liabilitiesTwd != null ? s.liabilitiesTwd : cl.liabTwd,
      us: s => s.usMarketValueTwd || 0, tw: s => s.twMarketValue || 0, crypto: s => s.cryptoMarketValueTwd || 0,
    }[key] || (() => 0);
    return snaps.map(s => ({ date: s.date, netWorth: f(s) }));
  }
  // 各類別走勢/漲幅圖（淨資產/資金/投資/負債、美股/台股/加密）；資料取自每日快照，共用 as.nw 控制狀態
  // 投入/組成分解：依 key 回傳每年的組成分量（以年底快照的年增量計）
  //  淨資產 = 投資增幅(ΔtotalPnl) + 其他收入(其餘)；投資/各市場 = 投入(Δ成本) + 損益(Δ市值−Δ成本)
  function metricComp(key, c, p, cl) {
    const d = f => (f(c) || 0) - (p ? (f(p) || 0) : 0);
    const IN = '#6D5FD5';
    switch (key) {
      case 'nw': { const gain = d(s => s.totalPnl); const nwd = nwOf(c, cl) - (p ? nwOf(p, cl) : 0); return [{ label: '投資增幅', value: gain, pnl: true }, { label: '其他收入', value: nwd - gain, pnl: true }]; }
      case 'invest': { const inv = d(s => s.totalCostBasisTwd); const mvd = d(s => s.totalMarketValueTwd); return [{ label: '投入', value: inv, color: IN }, { label: '投資損益', value: mvd - inv, pnl: true }]; }
      case 'us': { const inv = d(s => s.usCostBasisTwd); const mvd = d(s => s.usMarketValueTwd); return [{ label: '投入', value: inv, color: IN }, { label: '損益', value: mvd - inv, pnl: true }]; }
      case 'tw': { const inv = d(s => s.twCostBasis); const mvd = d(s => s.twMarketValue); return [{ label: '投入', value: inv, color: IN }, { label: '損益', value: mvd - inv, pnl: true }]; }
      case 'crypto': { const inv = d(s => s.cryptoCostBasisTwd); const mvd = d(s => s.cryptoMarketValueTwd); return [{ label: '投入', value: inv, color: IN }, { label: '損益', value: mvd - inv, pnl: true }]; }
      case 'cash': return [{ label: '淨流入', value: d(s => s.cashAccountsTwd != null ? s.cashAccountsTwd : cl.cashTwd), pnl: true }];
      case 'liab': return [{ label: '負債變化', value: d(s => s.liabilitiesTwd != null ? s.liabilitiesTwd : cl.liabTwd), pnl: true }];
      default: return [];
    }
  }
  function metricChartPage(root, key, backFn) {
    const meta = METRIC_META[key] || METRIC_META.nw;
    const st = as.nw;
    const mode = st.metric === 'change' ? 'change' : st.metric === 'inflow' ? 'inflow' : 'net';
    const money = v => 'NT$ ' + U.fmtKMBB(v);
    const sfMoney = v => (v >= 0 ? '+' : '−') + 'NT$ ' + U.fmtKMBB(Math.abs(v));
    const rerender = () => metricChartPage(root, key, backFn);
    const cl = C.cashLiabTwd();
    const rawSnaps = S.getSnapshots().filter(s => s && s.date).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const allSnaps = metricSeries(key, rawSnaps, cl);
    const dates = allSnaps.map(s => s.date);
    const years = [...new Set(allSnaps.map(s => +s.date.slice(0, 4)))].sort((a, b) => a - b);

    // net（走勢）局部重繪：只更新摘要 + 圖，不重建控制列 → 選日期時原生選擇器不會被關掉
    function paintNet() {
      const fS = applyRange(allSnaps, chartRange);
      const gran = autoGran(fS.length ? fS[0].date : null, fS.length ? fS[fS.length - 1].date : null);
      const B = C.netWorthBuckets(fS, gran, cl, true);
      const XL = chartLabels(B, gran);
      let sHtml = '';
      if (B.length) {
        const p = iso => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7) });
        const a = p(B[0].date), b = p(B[B.length - 1].date);
        const periodTxt = a.y === b.y ? `${a.y}年${a.m}月至${b.m}月` : `${a.y}年${a.m}月至${b.y}年${b.m}月`;
        const chg = B[B.length - 1].nw - B[0].nw, base = B[0].nw;
        const pctTxt = Math.abs(base) > 1e-9 ? '，較期初 ' + (chg >= 0 ? '+' : '−') + Math.abs(chg / base * 100).toFixed(0) + '%' : '';
        sHtml = `<div class="gt-sum"><div class="gt-period">${periodTxt}</div><div>${meta.title} ${chg >= 0 ? '增加了' : '減少了'} <b>${money(Math.abs(chg))}</b>${pctTxt}</div></div>`;
      }
      const sumEl = root.querySelector('#nw-summary'); if (sumEl) sumEl.innerHTML = sHtml;
      const host = root.querySelector('#nw-chart');
      if (!host) return;
      if (!B.length) { host.innerHTML = `<div class="chart-empty" style="padding:50px 0">此區間尚無資料</div>`; return; }
      const pts = B.map(bb => ({ date: new Date(bb.date + 'T00:00:00+08:00'), values: { v: bb.nw } }));
      App.Charts.lineChart(host, pts, { height: 260, series: [{ key: 'v', label: meta.title, color: meta.color, fill: true }], xLabels: XL.xLabels, valueFmt: v => 'NT$ ' + U.fmtKMBB(v) });
    }

    let summary = '', chartBlocks = '', inflowRows = null, inflowN = 0, netB = null;
    if (mode === 'inflow') {
      // 以年底快照計算每年組成分量（年尺度）
      const byYear = {};
      for (const s of rawSnaps) byYear[s.date.slice(0, 4)] = s; // 升冪 → 最後一筆為該年年底
      const ys = Object.keys(byYear).sort();
      inflowRows = ys.map((y, i) => ({ year: y, comps: metricComp(key, byYear[y], i > 0 ? byYear[ys[i - 1]] : null, cl) }));
      inflowN = inflowRows.length ? inflowRows[0].comps.length : 0;
      if (inflowRows.length) {
        const parts = [];
        for (let ci = 0; ci < inflowN; ci++) {
          const total = inflowRows.reduce((s, r) => s + (r.comps[ci] ? r.comps[ci].value : 0), 0);
          parts.push(`<div>${inflowRows[0].comps[ci].label} 合計 <b style="color:${UI.pnlColor(total)}">${sfMoney(total)}</b></div>`);
        }
        summary = `<div class="gt-sum"><div class="gt-period">${ys[0]}年 至 ${ys[ys.length - 1]}年</div>${parts.join('')}</div>`;
        for (let ci = 0; ci < inflowN; ci++)
          chartBlocks += `<div class="gt-subtitle"${ci ? ' style="margin-top:16px"' : ''}>${inflowRows[0].comps[ci].label}</div><div class="chart-host" id="nw-comp-${ci}"></div>`;
      } else chartBlocks = `<div class="chart-empty" style="padding:50px 0">尚無資料</div>`;
    } else if (mode === 'change') {
      if (!years.includes(st.year)) st.year = years.length ? years[years.length - 1] : new Date().getFullYear();
      netB = C.netWorthBuckets(allSnaps.filter(s => s.date.slice(0, 4) === String(st.year)), 'month', cl, true);
      if (netB.length) {
        const vals = netB.map(x => x.change), sum = vals.reduce((s, v) => s + v, 0), up = Math.max(0, ...vals), down = Math.min(0, ...vals);
        summary = `<div class="gt-sum"><div class="gt-period">${st.year}年</div><div>合計 <b style="color:${UI.pnlColor(sum)}">${sfMoney(sum)}</b></div><div>最大漲 <b style="color:${UI.pnlColor(up)}">${sfMoney(up)}</b> · 最大跌 <b style="color:${UI.pnlColor(down)}">${sfMoney(down)}</b></div></div>`;
      }
      chartBlocks = `<div class="chart-host" id="nw-chart" style="margin-top:12px"></div>`;
    } else {
      // net：摘要 + 圖由 paintNet 填入（占位）
      chartBlocks = `<div id="nw-summary"></div><div class="chart-host" id="nw-chart" style="margin-top:12px"></div>`;
    }

    const modeTitle = mode === 'inflow' ? ' 投入' : mode === 'change' ? ' 漲幅' : ' 走勢';
    const controlHtml = mode === 'change' ? yearControlHtml(st, 'nw', years) : mode === 'net' ? rangeControlHtml(chartRange, 'nw') : '';
    root.innerHTML = `<div class="page-full">
      <div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">${meta.title}${modeTitle}</div><div class="gd-actions"></div></div>
      <div class="card">
        <div class="seg seg-wide" id="nw-metric">${seg('net', '走勢', st.metric)}${seg('change', '漲幅', st.metric)}${seg('inflow', '投入', st.metric)}</div>
        ${controlHtml}
        ${summary}
        ${chartBlocks}
      </div>
    </div>`;

    root.querySelector('.gd-back').addEventListener('click', backFn);
    root.querySelectorAll('#nw-metric .seg-btn').forEach(b => b.addEventListener('click', () => { st.metric = b.dataset.v; rerender(); }));
    if (mode === 'change') bindYearControl(root, st, 'nw', rerender);
    else if (mode === 'net') bindRangeControl(root, chartRange, 'nw', dates, rerender, paintNet);

    if (mode === 'net') { paintNet(); return; }
    if (mode === 'inflow') {
      if (!inflowRows || !inflowRows.length) return;
      for (let ci = 0; ci < inflowN; ci++) {
        const c0 = inflowRows[0].comps[ci];
        const items = inflowRows.map(r => ({ label: r.year, fullLabel: r.year + '年', value: r.comps[ci] ? r.comps[ci].value : 0 }));
        App.Charts.barChart(root.querySelector('#nw-comp-' + ci), items, {
          height: inflowN > 1 ? 180 : 240,
          colorOf: c0.pnl ? (v => UI.pnlColor(v)) : (() => c0.color),
          valueFmt: sfMoney,
        });
      }
      return;
    }
    // change（漲幅）
    const host = root.querySelector('#nw-chart');
    if (!netB.length) { host.innerHTML = `<div class="chart-empty" style="padding:50px 0">此區間尚無資料</div>`; return; }
    App.Charts.barChart(host, netB.map(b => ({ label: b.label, fullLabel: b.full, value: b.change })), { height: 260, colorOf: v => UI.pnlColor(v), valueFmt: sfMoney });
  }

  // 群組詳情頁（返回 / 標題 / ⋯ / ＋ / 合計排序 / 成員卡片）
  function groupDetail(root, gid) {
    const g = S.getGroups().find(x => x.id === gid);
    if (!g) { as.detailGroup = null; return assets(root); }
    const rate = S.getFxRate() || 31.5;
    const sum = C.assetsSummary();
    const gmap = S.getGroupMap();
    const allPos = C.buildPositions();
    const members = allPos.filter(p => gmap[p.symbol] === gid);
    const gTotal = members.reduce((s, p) => s + mvTwdOf(p, rate), 0);
    // 群組損益：目前（未實現）、已實現（含已賣光仍歸在此群組的標的）、兩者合計
    const gp = C.groupPnl(Object.keys(gmap).filter(sym => gmap[sym] === gid), allPos, rate);
    // 今日漲跌（與資產頁群組列同一算法：台股日模式下未開盤的市場計 0；含今日賣光的成員）
    const usGated = S.getDayMode() === 'twday' && !U.usCountsTowardToday();
    const twGated = S.getDayMode() === 'twday' && !U.twCountsTowardToday();
    const dayTwd = p => {
      const mk = U.normalizeMarketKey(p.market), usd = mk === U.Market.us || mk === U.Market.crypto;
      if ((usGated && mk === U.Market.us) || (twGated && !usd)) return 0;
      return (p.dayPnl || 0) * (usd ? rate : 1);
    };
    const gDay = members.reduce((s, p) => s + dayTwd(p), 0) + (allPos.closedToday || []).filter(c => gmap[c.symbol] === gid).reduce((s, c) => s + dayTwd(c), 0);
    const gPrev = gTotal - gDay, gDayPct = Math.abs(gPrev) > 1e-9 ? gDay / Math.abs(gPrev) * 100 : 0;
    // Hero：左邊市值＋今日漲跌；右邊三項損益（金額用「萬」）。已實現可點 → 歷史頁只看這個群組的賣出
    const compact = x => Math.abs(x) < 0.5 ? '0' : U.fmtBannerSigned(x);
    const colorOf = x => UI.pnlColor(Math.abs(x) < 0.5 ? 0 : x);
    const showPnl = members.length || Math.abs(gp.realizedTwd) >= 0.5;
    // 上方整塊（市值、損益、組內分布）可收合；狀態記在 allocUi.groupOpen（所有群組共用）
    const topOpen = S.getAllocUi().groupOpen;
    const bigCls = gTotal >= 1e9 ? ' xs' : gTotal >= 1e8 ? ' sm' : '';
    const chev = up => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`;
    // 展開：左＝市值＋今日漲跌；右＝目前損益＋報酬率（兩邊同一種排法）；下面一行＝已實現（可點）與含已實現合計
    // 收合：一列——市值，加上目前損益與報酬率
    const heroHtml = !topOpen
      ? `<button class="card gd-mini" id="gd-fold" aria-label="展開群組摘要" aria-expanded="false">
          <div class="gd-ml"><span>市值 (TWD)</span><b class="gd-big${bigCls}">${U.fmtWhole(gTotal)}</b></div>
          ${showPnl ? `<div class="gd-mr" style="color:${colorOf(gp.unrealizedTwd)}"><b>${compact(gp.unrealizedTwd)}</b>${gp.unrealizedPct != null ? `<em>${U.fmtPct(gp.unrealizedPct)}</em>` : ''}</div>` : ''}
          <i>${chev(false)}</i></button>`
      : `<div class="gd-hero">
      <div class="gd-blk">
        <div class="gd-cap">市值 (TWD)</div>
        <div class="gd-big${bigCls}">${U.fmtWhole(gTotal)}</div>
        <div class="gd-s" style="color:${UI.pnlColor(gDay)}">${gDay > 0 ? '▲' : gDay < 0 ? '▼' : '–'} ${U.fmtWhole(Math.abs(gDay))} (${Math.abs(gDayPct).toFixed(2)}%) <span>今日</span></div>
      </div>
      ${showPnl ? `<div class="gd-blk r">
        <div class="gd-cap">目前損益</div>
        <div class="gd-mid" style="color:${colorOf(gp.unrealizedTwd)}">${compact(gp.unrealizedTwd)}</div>
        <div class="gd-s" style="color:${colorOf(gp.unrealizedTwd)}">${gp.unrealizedPct != null ? U.fmtPct(gp.unrealizedPct) : ''}</div>
      </div>` : ''}
    </div>
    ${showPnl ? `<div class="gd-sub">
      <button id="gd-realized" aria-label="查看這個群組的賣出紀錄">已實現 <b style="color:${colorOf(gp.realizedTwd)}">${compact(gp.realizedTwd)}</b> <i>›</i></button>
      <span>含已實現合計 <b style="color:${colorOf(gp.totalTwd)}">${compact(gp.totalTwd)}</b></span>
    </div>` : ''}`;
    const basis = S.getPctBasis();
    const denomV = basis === 'group' ? (gTotal || 1) : basis === 'invest' ? sum.investTwd : sum.netWorth;
    members.sort((a, b) => as.detailAsc ? mvTwdOf(a, rate) - mvTwdOf(b, rate) : mvTwdOf(b, rate) - mvTwdOf(a, rate));
    const fmtPctBadge = v => (v >= 9.95 ? Math.round(v) : v.toFixed(v >= 1 ? 0 : 1)) + '%';
    const topHtml = `<div class="gd-head">
      <button class="gd-back" aria-label="返回">‹</button>
      <div class="gd-title">${esc(g.name)}</div>
      <div class="gd-actions">
        <button class="gd-trend" aria-label="走勢圖"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M7 14l3.5-3.5 3 2.5L19 8"/></svg></button>
        <button class="gd-menu" aria-label="選單">⋯</button>
        <button class="gd-plus" aria-label="新增">＋</button>
      </div>
    </div>
    ${heroHtml}`;

    // 組內分布圓餅（2 檔以上才顯示；分母＝群組合計，不受「投資佔比基準」影響）
    //   市值已在上方 Hero → 圓心只放檔數（centerCount）
    let listHtml = topOpen && members.filter(p => mvTwdOf(p, rate) > 0).length >= 2
      ? allocCardHtml({ open: true, sel: as.groupAllocSel, groupId: gid, title: '組內分布', centerCount: true, noToggle: true }) : '';
    if (topOpen) listHtml += `<button class="gd-fold" id="gd-fold" aria-label="收合群組摘要" aria-expanded="true">${chev(true)}</button>`;
    if (members.length) listHtml += `<div class="gd-lh"><span>持股 ${members.length} 檔</span>${members.length > 1 ? `<button class="gd-sort" aria-label="依市值排序，目前${as.detailAsc ? '由小到大' : '由大到小'}">市值 ${as.detailAsc ? '▲' : '▼'}</button>` : ''}</div>`;
    if (!members.length) {
      listHtml += `<div class="empty" style="padding:40px 16px">此群組尚無持倉<br>點右上 ＋ 買入並加入，或從投資清單指定群組</div>`;
    }
    for (const p of members) {
      const mv = mvTwdOf(p, rate);
      const pct = denomV > 1e-9 ? mv / denomV * 100 : 0;
      // 當前損益（未實現，換算台幣）與報酬率
      const pl = p.unrealizedPnl * (p.marketValue ? mv / p.marketValue : 1), plPct = p.cost > 1e-9 ? p.unrealizedPnl / p.cost * 100 : null;
      const isUsd = U.normalizeMarketKey(p.market) !== U.Market.tse && U.normalizeMarketKey(p.market) !== U.Market.otc && U.normalizeMarketKey(p.market) !== U.Market.rotc;
      listHtml += `<div class="card gd-row" data-sym="${p.symbol}">
        <span class="pct-badge">${fmtPctBadge(pct)}</span>
        <div class="as-main">
          <div class="gd-sym">${p.symbol} <span class="h-name">${groupRowName(p)}</span></div>
          <div class="as-sub">持有 ${U.formatShares(p.shares)}, ${isUsd ? '$' : ''}${U.formatPrice(p.lastPrice != null ? p.lastPrice : p.avgCost)}</div>
        </div>
        <div class="gd-val">
          <div class="gd-amt">${U.fmtWhole(mv)}</div>
          ${p.lastPrice != null
            ? `<div class="gd-pl" style="color:${UI.pnlColor(Math.abs(pl) < 0.5 ? 0 : pl)}">${compact(pl)}${plPct != null ? ' (' + U.fmtPct(plPct) + ')' : ''}</div>`
            : '<div class="gd-pl" style="color:var(--sub)">尚無報價</div>'}
        </div>
      </div>`;
    }

    root.innerHTML = `<div class="page"><div class="page-top">${topHtml}</div><div class="page-list">${listHtml}</div></div>`;

    root.querySelector('.gd-back').addEventListener('click', () => { as.detailGroup = null; as.groupAllocSel = null; assets(root); });
    bindAllocCard(root, {
      toggle: () => {}, setBy: () => {},
      getSel: () => as.groupAllocSel, setSel: k => { as.groupAllocSel = k; }, rerender: () => groupDetail(root, gid),
    });
    { const fb = root.querySelector('#gd-fold'); if (fb) fb.addEventListener('click', () => { S.setAllocUi({ groupOpen: !topOpen }); as.groupAllocSel = null; groupDetail(root, gid); }); }
    { const sb = root.querySelector('.gd-sort'); if (sb) sb.addEventListener('click', () => { as.detailAsc = !as.detailAsc; assets(root); }); }
    { const rb = root.querySelector('#gd-realized'); if (rb) rb.addEventListener('click', () => openGroupSells(gid)); }
    root.querySelector('.gd-trend').addEventListener('click', () => { as.groupTrend = gid; as.gtCache = null; assets(root); });
    root.querySelector('.gd-menu').addEventListener('click', () => openGroupMenu(gid, () => assets(root)));
    root.querySelector('.gd-plus').addEventListener('click', () =>
      openTxForm(null, null, { onAdded: sym => { const m = S.getGroupMap(); m[sym] = gid; S.setGroupMap(m); if (App.Sync) App.Sync.markDirty(); } }));
    root.querySelectorAll('.gd-row').forEach(r => r.addEventListener('click', () => openStock(root, r.dataset.sym)));
  }

  /* ---- 個股頁：損益、走勢對成本、交易紀錄 ---- */
  function openStock(root, sym) { as.detailSym = sym; as.stk.range = { range: 'all', from: null, to: null }; assets(root); }
  // 抓這一檔的歷史價並算出每日走勢；抓失敗就丟錯（不拿成本估算當成真的走勢）
  async function fetchSymbolSeries(sym) {
    const txs = S.getTransactions().filter(t => t.symbol === sym);
    if (!txs.length) return { points: [], trades: [] };
    const meta = S.metaMap()[sym];
    const mk = U.normalizeMarketKey((meta && meta.market) || U.guessMarketBySymbol(sym));
    const firstDate = U.isoDate(new Date(Math.min(...txs.map(t => t.time))));
    await App.Api.fetchFx();
    const h = await (mk === U.Market.us ? App.Api.fetchUsHistory([sym], firstDate)
      : mk === U.Market.crypto ? App.Api.fetchCryptoHistory([sym], firstDate) : App.Api.fetchTwHistory([sym], firstDate));
    if ((h._failed || []).length) throw new Error('歷史價格抓取失敗：' + sym);
    return C.symbolSeries(sym, h, S.getFxRate());
  }
  // 右上角選單：新增交易／分類群組
  function openStockMenu(sym, onDone) {
    const gid = S.getGroupMap()[sym], g = gid ? S.getGroups().find(x => x.id === gid) : null;
    const item = (id, icon, title, sub, cls) => `<button class="stk-mi${cls || ''}" id="${id}"><span class="stk-mic">${icon}</span><span class="stk-mit"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><i>›</i></button>`;
    const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const body = `<div class="stk-menu">
      ${item('stk-add', svg('<path d="M12 5.5v13M5.5 12h13"/>'), '新增交易', '買進或賣出這一檔')}
      ${item('stk-grp', svg('<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>'), '分類群組', g ? '目前：' + esc(g.name) : '目前：未分組')}
      ${item('stk-ren', svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>'), '重新命名', '改這一檔顯示的名稱')}
      ${item('stk-del', svg('<path d="M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13"/>'), '刪除此檔', '刪掉這一檔的所有交易與損益', ' danger')}
    </div>`;
    const ov = UI.openSheet(esc(sym), body, '');
    ov.querySelector('#stk-add').addEventListener('click', () => { UI.closeSheet(); openTxForm(null, sym); });
    ov.querySelector('#stk-grp').addEventListener('click', () => openGroupAssign(sym, onDone));
    ov.querySelector('#stk-ren').addEventListener('click', () => openRename(sym));
    ov.querySelector('#stk-del').addEventListener('click', () =>
      UI.confirmDialog(`確定刪除 ${esc(sym)} 的所有交易與損益？這個動作無法復原。`, () => { C.deleteSymbol(sym); UI.closeSheet(); App.afterDataChange([]); }, '刪除'));
  }
  // ctx：{ get() 目前顯示的代號, close() 離開個股頁, render() 重繪所在分頁 }——資產頁與投資頁各自提供
  function stockDetail(root, sym, ctx) {
    const txs = S.getTransactions().filter(t => t.symbol === sym).sort((a, b) => b.time - a.time);
    if (!txs.length) { ctx.close(); return ctx.render(); }   // 這檔的交易被刪光了
    const rate = S.getFxRate() || 31.5;
    const meta = S.metaMap()[sym] || {};
    const mk = U.normalizeMarketKey(meta.market || U.guessMarketBySymbol(sym));
    const isUsd = mk === U.Market.us || mk === U.Market.crypto, conv = isUsd ? rate : 1, cur = isUsd ? '$' : '';
    const allPos = C.buildPositions();
    const p = allPos.find(x => x.symbol === sym);                      // 已賣光 → undefined
    const mv = p ? mvTwdOf(p, rate) : 0;
    const gp = C.groupPnl([sym], allPos, rate);
    // 今日漲跌（與資產頁同一算法：台股日模式下未開盤的市場計 0；今天賣光的也算）
    const gated = S.getDayMode() === 'twday' && (mk === U.Market.us ? !U.usCountsTowardToday() : !isUsd && !U.twCountsTowardToday());
    const closed = (allPos.closedToday || []).find(c => c.symbol === sym);
    const day = gated ? 0 : (((p && p.dayPnl) || 0) + ((closed && closed.dayPnl) || 0)) * conv;
    const prev = mv - day, dayPct = Math.abs(prev) > 1e-9 ? day / Math.abs(prev) * 100 : 0;
    const compact = x => Math.abs(x) < 0.5 ? '0' : U.fmtBannerSigned(x);
    const colorOf = x => UI.pnlColor(Math.abs(x) < 0.5 ? 0 : x);
    const bigCls = mv >= 1e9 ? ' xs' : mv >= 1e8 ? ' sm' : '';
    const name = meta.alias || (meta.name && meta.name !== sym ? meta.name : '');
    const fact = (k, val) => `<div><span>${k}</span><b>${val}</b></div>`;
    const rangeText = rangeLabel(as.stk.range);
    const hasReal = Math.abs(gp.realizedTwd) >= 0.5;

    const topHtml = `<div class="gd-head">
      <button class="gd-back" aria-label="返回">‹</button>
      <div class="gd-title">${esc(sym)}${name ? ` <em>${esc(name)}</em>` : ''}</div>
      <div class="gd-actions"><button id="stk-more" aria-label="更多：新增交易、分類群組、重新命名、刪除">⋯</button></div>
    </div>
    <div class="gd-hero">
      <div class="gd-blk">
        <div class="gd-cap">市值 (TWD)</div>
        <div class="gd-big${bigCls}">${U.fmtWhole(mv)}</div>
        <div class="gd-s" style="color:${UI.pnlColor(day)}">${day > 0 ? '▲' : day < 0 ? '▼' : '–'} ${U.fmtWhole(Math.abs(day))} (${Math.abs(dayPct).toFixed(2)}%) <span>今日</span></div>
      </div>
      <div class="gd-blk r">
        <div class="gd-cap">目前損益</div>
        <div class="gd-mid" style="color:${colorOf(gp.unrealizedTwd)}">${compact(gp.unrealizedTwd)}</div>
        <div class="gd-s" style="color:${colorOf(gp.unrealizedTwd)}">${gp.unrealizedPct != null ? U.fmtPct(gp.unrealizedPct) : ''}</div>
      </div>
    </div>`;

    const rzOf = C.realizedByTxId();
    const txRows = txs.map(t => {
      const d = U.isoDate(new Date(t.time));
      if (t.type === 'STOCK_DIV') return `<button class="stk-tx" data-id="${t.id}"><span class="tx-type evt">配</span><span class="stk-txm"><b>配股 +${U.formatShares(t.shares)}${shareUnit(mk)}</b><small>${d}</small></span><em></em></button>`;
      const buy = t.type === 'BUY', rz = !buy ? rzOf[t.id] : null;
      const right = buy ? `NT$ ${U.fmtBanner((t.shares * t.price + (t.fee || 0)) * conv)}`
        : rz ? `<span style="color:${UI.pnlColor(rz.realizedPnl)}">${U.fmtBannerSigned(rz.realizedPnl * conv)}</span>` : `NT$ ${U.fmtBanner(t.shares * t.price * conv)}`;
      return `<button class="stk-tx" data-id="${t.id}"><span class="tx-type ${buy ? 'buy' : 'sell'}">${buy ? 'Buy' : 'Sell'}</span><span class="stk-txm"><b>${U.formatShares(t.shares)}${shareUnit(mk)} @ ${cur}${U.formatPrice(t.price)}</b><small>${d}</small></span><em>${right}</em></button>`;
    }).join('');

    const listHtml = `
      <div class="card stk-facts">
        ${fact('持有', p ? U.formatShares(p.shares) + shareUnit(mk) : '0')}${fact('均價', p ? cur + U.formatPrice(p.avgCost) : '--')}${fact('現價', p && p.lastPrice != null ? cur + U.formatPrice(p.lastPrice) : '--')}${fact('成本', U.fmtBanner(gp.costTwd))}
      </div>
      ${hasReal ? `<div class="gd-sub"><span>已實現 <b style="color:${colorOf(gp.realizedTwd)}">${compact(gp.realizedTwd)}</b></span><span>含已實現合計 <b style="color:${colorOf(gp.totalTwd)}">${compact(gp.totalTwd)}</b></span></div>` : ''}
      <div class="card stk-chart">
        <div class="seg seg-wide" id="stk-mode"><button class="seg-btn ${as.stk.mode === 'value' ? 'active' : ''}" data-v="value">市值與成本</button><button class="seg-btn ${as.stk.mode === 'price' ? 'active' : ''}" data-v="price">股價與均價</button></div>
        <div class="stk-lg"><span><i class="l1"></i>${as.stk.mode === 'value' ? '市值' : '股價'}</span><span><i class="l2"></i>${as.stk.mode === 'value' ? '成本' : '均價'}</span><span><i class="d1"></i>Buy</span><span><i class="d2"></i>Sell</span>
          <button class="stk-cal${as.stk.range.range !== 'all' ? ' on' : ''}" id="stk-cal" aria-label="選擇走勢範圍，目前：${rangeText || '全部'}">${rangeText ? `<em>${rangeText}</em>` : ''}${CAL_SVG}</button></div>
        <div class="stk-host" id="stk-host"></div>
      </div>
      <div class="gd-lh"><span>交易紀錄 ${txs.length} 筆</span></div>
      <div class="card stk-txs">${txRows}</div>`;

    root.innerHTML = `<div class="page"><div class="page-top">${topHtml}</div><div class="page-list">${listHtml}</div></div>`;
    const rerender = () => ctx.render();
    root.querySelector('.gd-back').addEventListener('click', () => { ctx.close(); ctx.render(); });
    root.querySelector('#stk-more').addEventListener('click', () => openStockMenu(sym, rerender));
    root.querySelectorAll('#stk-mode .seg-btn').forEach(b => b.addEventListener('click', () => { as.stk.mode = b.dataset.v; rerender(); }));
    root.querySelectorAll('.stk-tx').forEach(b => b.addEventListener('click', () => {
      const tx = S.getTransactions().find(t => t.id === b.dataset.id);
      if (!tx) return;
      if (tx.type === 'STOCK_DIV') openDividendForm('stock', { id: tx.id, symbol: tx.symbol, name: meta.name || tx.symbol, market: meta.market, shares: tx.shares, date: U.isoDate(new Date(tx.time)) });
      else openTxForm(tx);
    }));

    // 走勢：有快取直接畫；否則抓歷史價（抓完若還在這一頁就重畫）
    const host = root.querySelector('#stk-host');
    const key = sym + '|' + txs.length + '|' + txs.reduce((s, t) => s + t.shares * t.price, 0).toFixed(2) + '|' + U.isoDate();
    const st = as.stk;
    const draw = data => {
      const pts = applyRange(data.points, st.range), n = pts.length;   // 只畫所選範圍
      const pos = {}; pts.forEach((q, i) => { pos[q.date] = i; });
      const value = st.mode === 'value';
      const series = pts.map(q => value ? { date: q.date, a: q.mv, b: q.shares > 0 ? q.cost : null } : { date: q.date, a: q.price, b: q.avgCost });
      // X 軸標籤：平均取 5 個；跨年帶年份
      const multiYear = n > 0 && pts[0].date.slice(0, 4) !== pts[n - 1].date.slice(0, 4);
      const lab = iso => multiYear ? iso.slice(2, 4) + '/' + (+iso.slice(5, 7)) : (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10));
      const xLabels = n < 2 ? [] : [0, 1, 2, 3, 4].map(k => Math.round(k * (n - 1) / 4)).filter((x, i, a) => a.indexOf(x) === i).map(idx => ({ idx, label: lab(pts[idx].date) }));
      App.Charts.compareChart(host, series, {
        aLabel: value ? '市值' : '股價', bLabel: value ? '成本' : '均價', height: 220, xLabels,
        valueFmt: x => value ? 'NT$ ' + U.fmtKMBB(x) : cur + U.formatPrice(x),
        marks: data.trades.filter(t => pos[t.date] != null).map(t => ({ idx: pos[t.date], type: t.type, text: `${t.type === 'BUY' ? 'Buy' : 'Sell'} ${U.formatShares(t.shares)}${shareUnit(mk)} @ ${cur}${U.formatPrice(t.price)}` })),
        extremeFmt: x => value ? U.fmtKMBB(x) : cur + U.formatPrice(x),   // 主線的最高／最低點標示
      });
    };
    root.querySelector('#stk-cal').addEventListener('click', () => openRangeDialog(as.stk.range, U.isoDate(new Date(txs[txs.length - 1].time)), r => { as.stk.range = r; rerender(); }));
    if (st.key === key && st.data) draw(st.data);
    else if (st.error === key) {
      host.innerHTML = '<div class="chart-empty">走勢載入失敗<br><button class="cal-retry" id="stk-retry">點此重試</button></div>';
      host.querySelector('#stk-retry').addEventListener('click', () => { st.error = null; rerender(); });
    } else {
      host.innerHTML = '<div class="chart-empty">載入走勢中…</div>';
      if (st.loading !== key) {
        st.loading = key;
        fetchSymbolSeries(sym)
          .then(data => { st.key = key; st.data = data; st.error = null; })
          .catch(e => { console.error(e); st.error = key; })
          .then(() => { st.loading = null; if (ctx.get() === sym && root.querySelector('#stk-host')) rerender(); });
      }
    }
  }

  // 群組走勢頁：折線（市值走勢）/ 長條（漲幅），X 軸 天/週/月/年
  function gtHead(title) {
    return `<div class="gd-head">
      <button class="gd-back" aria-label="返回">‹</button>
      <div class="gd-title">${title}</div>
      <div class="gd-actions" style="visibility:hidden"><button>＋</button></div>
    </div>`;
  }
  function bucketXLabels(buckets) {
    if (!buckets.length) return [];
    const step = Math.max(1, Math.ceil(buckets.length / 6));
    const out = [];
    for (let i = 0; i < buckets.length; i += step) out.push({ idx: i, label: buckets[i].label });
    return out;
  }
  async function fetchGroupSeries(symbols) {
    if (!symbols.length) return [];
    const txs = S.getTransactions().filter(t => symbols.includes(t.symbol));
    if (!txs.length) return [];
    const mmap = S.metaMap();
    const firstDate = U.isoDate(new Date(Math.min(...txs.map(t => t.time))));
    const mkOf = c => U.normalizeMarketKey((mmap[c] && mmap[c].market) || U.guessMarketBySymbol(c));
    const tw = symbols.filter(c => mkOf(c) !== U.Market.us && mkOf(c) !== U.Market.crypto);
    const us = symbols.filter(c => mkOf(c) === U.Market.us);
    const cr = symbols.filter(c => mkOf(c) === U.Market.crypto);
    await App.Api.fetchFx();
    const [twH, usH, crH] = await Promise.all([
      App.Api.fetchTwHistory(tw, firstDate),
      App.Api.fetchUsHistory(us, firstDate),
      App.Api.fetchCryptoHistory(cr, firstDate),
    ]);
    const failed = [twH, usH, crH].reduce((a, h) => a.concat(h._failed || []), []);
    if (failed.length) throw new Error('歷史價格抓取失敗：' + failed.join('、'));   // 不拿成本估算當成真的走勢／損益
    return C.buildGroupSeries(symbols, Object.assign({}, twH, usH, crH), S.getFxRate());
  }
  async function groupTrendPage(root, gid) {
    const g = S.getGroups().find(x => x.id === gid);
    if (!g) { as.groupTrend = null; return assets(root); }
    const gmap = S.getGroupMap();
    const symbols = Object.keys(gmap).filter(s => gmap[s] === gid);

    // 尚無資料 → 顯示載入、抓歷史、快取後重繪
    if (!as.gtCache || as.gtCache.gid !== gid) {
      root.innerHTML = `<div class="page-full">${gtHead(esc(g.name))}<div class="empty" style="padding:70px 16px">載入走勢中…</div></div>`;
      root.querySelector('.gd-back').addEventListener('click', () => { as.groupTrend = null; assets(root); });
      let series = [];
      try { series = await fetchGroupSeries(symbols); }
      catch (e) { console.error(e); UI.toast('載入走勢失敗', 'error'); }
      if (as.groupTrend !== gid) return; // 使用者已離開
      as.gtCache = { gid, series };
      return groupTrendPage(root, gid);
    }

    const series = as.gtCache.series;
    const st = as.gt;
    const isBar = st.metric === 'change';
    const CL = { cashTwd: 0, liabTwd: 0 };
    const dates = series.map(s => s.date);
    const years = [...new Set(series.map(s => +s.date.slice(0, 4)))].sort((a, b) => a - b);
    const GC_MV = '#6D5FD5', GC_COST = '#A8A29E';        // 市值紫實線、成本灰虛線
    const BAR_IN = '#4B3F9E', BAR_PL = '#8B7FE0';         // 投入深紫、損益淺紫
    const sfMoney = v => (v >= 0 ? '+' : '−') + 'NT$ ' + U.fmtKMBB(Math.abs(v));
    const money = v => 'NT$ ' + U.fmtKMBB(v);

    // net（走勢）局部重繪：只更新摘要 + 圖，不重建控制列 → 選日期時原生選擇器不會被關掉
    function paintGt() {
      const fSeries = applyRange(series, chartRange);
      const gran = autoGran(fSeries.length ? fSeries[0].date : null, fSeries.length ? fSeries[fSeries.length - 1].date : null);
      const mvB = C.netWorthBuckets(fSeries.map(s => ({ date: s.date, netWorth: s.mv })), gran, CL, true);
      const coB = C.netWorthBuckets(fSeries.map(s => ({ date: s.date, netWorth: s.cost })), gran, CL, true);
      const XL = chartLabels(mvB, gran);
      let sHtml = '';
      if (mvB.length) {
        const p = iso => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7) });
        const a = p(mvB[0].date), b = p(mvB[mvB.length - 1].date);
        const periodTxt = a.y === b.y ? `${a.y}年${a.m}月至${b.m}月` : `${a.y}年${a.m}月至${b.y}年${b.m}月`;
        const mvChg = mvB[mvB.length - 1].nw - mvB[0].nw, mvBase = mvB[0].nw;
        const coChg = coB[coB.length - 1].nw - coB[0].nw, coBase = coB[0].nw;
        const pctTxt = (chg, base) => Math.abs(base) > 1e-9 ? '，較期初 ' + (chg >= 0 ? '+' : '−') + Math.abs(chg / base * 100).toFixed(0) + '%' : '';
        sHtml = `<div class="gt-sum"><div class="gt-period">${periodTxt}</div>
          <div>市值 ${mvChg >= 0 ? '增加了' : '減少了'} <b>${money(Math.abs(mvChg))}</b>${pctTxt(mvChg, mvBase)}</div>
          <div>成本 ${coChg >= 0 ? '增加了' : '減少了'} <b>${money(Math.abs(coChg))}</b>${pctTxt(coChg, coBase)}</div></div>`;
      }
      const sumEl = root.querySelector('#gt-summary'); if (sumEl) sumEl.innerHTML = sHtml;
      const host = root.querySelector('#gt-chart');
      if (!host) return;
      if (!mvB.length) { host.innerHTML = `<div class="chart-empty" style="padding:50px 0">此群組尚無走勢資料</div>`; return; }
      const pts = mvB.map((bb, i) => ({ date: new Date(bb.date + 'T00:00:00+08:00'), values: { mv: bb.nw, cost: coB[i].nw } }));
      App.Charts.lineChart(host, pts, {
        height: 260,
        series: [{ key: 'mv', label: '市值', color: GC_MV, fill: true }, { key: 'cost', label: '成本', color: GC_COST, dash: true }],
        xLabels: XL.xLabels,
        valueFmt: v => 'NT$ ' + U.fmtKMBB(v),
      });
    }

    // 漲幅（isBar）：選年份、月刻度；net 由 paintGt 局部填入
    let summary = '', mvB = null, coB = null;
    if (isBar) {
      if (!years.includes(st.year)) st.year = years.length ? years[years.length - 1] : new Date().getFullYear();
      const ySeries = series.filter(s => s.date.slice(0, 4) === String(st.year));
      mvB = C.netWorthBuckets(ySeries.map(s => ({ date: s.date, netWorth: s.mv })), 'month', CL, true);
      coB = C.netWorthBuckets(ySeries.map(s => ({ date: s.date, netWorth: s.cost })), 'month', CL, true);
      if (mvB.length) {
        const invTot = coB.reduce((s, b) => s + b.change, 0);                       // 投入合計
        const plTot = mvB.reduce((s, b, i) => s + (b.change - coB[i].change), 0);     // 損益合計
        summary = `<div class="gt-sum"><div class="gt-period">${st.year}年</div>
          <div>投入合計 <b>${sfMoney(invTot)}</b></div>
          <div>持倉盈虧 <b style="color:${UI.pnlColor(plTot)}">${sfMoney(plTot)}</b></div></div>`;
      }
    }

    let html = gtHead(esc(g.name)) + `<div class="card">
      <div class="seg seg-wide" id="gt-metric">${seg('line', '走勢', st.metric)}${seg('change', '漲幅', st.metric)}</div>
      ${isBar ? yearControlHtml(st, 'gt', years) : rangeControlHtml(chartRange, 'gt')}
      ${isBar
        ? `${summary}<div class="gt-subtitle">投入</div><div class="chart-host" id="gt-chart-a"></div>
           <div class="gt-subtitle" style="margin-top:16px">持倉盈虧</div><div class="chart-host" id="gt-chart-b"></div>`
        : `<div id="gt-summary"></div><div class="chart-host" id="gt-chart" style="margin-top:10px"></div>`}
    </div>`;
    root.innerHTML = `<div class="page-full">${html}</div>`;

    root.querySelector('.gd-back').addEventListener('click', () => { as.groupTrend = null; assets(root); });
    root.querySelectorAll('#gt-metric .seg-btn').forEach(b => b.addEventListener('click', () => { as.gt.metric = b.dataset.v; groupTrendPage(root, gid); }));
    if (isBar) bindYearControl(root, st, 'gt', () => groupTrendPage(root, gid));
    else bindRangeControl(root, chartRange, 'gt', dates, () => groupTrendPage(root, gid), paintGt);

    if (!isBar) { paintGt(); return; }
    if (!mvB.length) { root.querySelector('#gt-chart-a').innerHTML = `<div class="chart-empty" style="padding:50px 0">此群組尚無走勢資料</div>`; return; }
    // 投入(帳戶改變)＝成本變化；持倉盈虧＝市值變化 − 成本變化 → 拆成兩張圖
    const sfBar = v => (v >= 0 ? '+' : '−') + 'NT$ ' + U.fmtKMBB(Math.abs(v));
    const invItems = mvB.map((b, i) => ({ label: b.label, fullLabel: b.full, value: coB[i].change }));
    const plItems = mvB.map((b, i) => ({ label: b.label, fullLabel: b.full, value: b.change - coB[i].change }));
    App.Charts.barChart(root.querySelector('#gt-chart-a'), invItems, { height: 190, colorOf: () => BAR_IN, valueFmt: sfBar });
    App.Charts.barChart(root.querySelector('#gt-chart-b'), plItems, { height: 190, colorOf: v => UI.pnlColor(v), valueFmt: sfBar });
  }

  // 統一新增選單：現金 / 投資 / 負債 / 群組
  function openAddChooser(onDone) {
    const ov = UI.openSheet('新增', `
      <div class="ga-list">
        <div class="ga-item" data-k="cash"><b>現金帳戶</b><span class="ga-sub">台幣 / 美金，計入流動資金</span></div>
        <div class="ga-item" data-k="invest"><b>投資</b><span class="ga-sub">買入股票 / 加密貨幣（可選擇扣款帳戶）</span></div>
        <div class="ga-item" data-k="liab"><b>負債</b><span class="ga-sub">信貸、房貸等，自淨資產扣除</span></div>
        <div class="ga-item" data-k="fut"><b>期貨</b><span class="ga-sub">台指期建倉／加碼（大台、小台、微台）</span></div>
        <div class="ga-item" data-k="group"><b>投資群組</b><span class="ga-sub">將持倉分類（例：ETF、核心持股）</span></div>
      </div>`, '');
    ov.querySelectorAll('.ga-item').forEach(it => it.addEventListener('click', () => {
      const k = it.dataset.k;
      UI.closeSheet();
      if (k === 'cash') openMoneyForm('cash', null, onDone);
      else if (k === 'liab') openMoneyForm('liab', null, onDone);
      else if (k === 'group') openGroupCreate(onDone);
      else if (k === 'fut') App.ViewsFutures.openTradeForm(null, onDone);
      else openTxForm(null); // 投資 → 新增交易（完成後 afterDataChange 會重繪）
    }));
  }

  // 現金 / 負債帳戶表單（新增或編輯；含快速增減）
  function openMoneyForm(kind, editing, onDone) {
    const isCash = kind === 'cash';
    const a = editing || {};
    const cur0 = a.currency || 'TWD';
    const body = `
      <label class="fld">名稱<input class="input" id="mf-name" value="${esc(a.name)}" placeholder="${isCash ? '例：Firstrade、台幣' : '例：信貸、房貸'}"></label>
      <label class="fld">幣別
        <div class="fee-mode">
          <button class="fm-btn ${cur0 === 'TWD' ? 'active' : ''}" data-c="TWD">台幣</button>
          <button class="fm-btn ${cur0 === 'USD' ? 'active' : ''}" data-c="USD">美金</button>
        </div>
      </label>
      <label class="fld">${isCash ? '餘額' : '負債金額'}<input class="input" id="mf-bal" type="number" inputmode="decimal" value="${a.balance != null ? Math.round(a.balance * 100) / 100 : ''}" placeholder="0"></label>
      <label class="fld">快速增減
        <div class="adj-row">
          <input class="input" id="mf-adj" type="number" inputmode="decimal" placeholder="金額">
          <button class="btn btn-ghost btn-sm" id="mf-plus">＋存入</button>
          <button class="btn btn-ghost btn-sm" id="mf-minus">−提出</button>
        </div>
      </label>`;
    const footer = `${editing ? '<button class="btn btn-danger" id="mf-del">刪除</button>' : ''}
      <button class="btn btn-ghost" id="mf-cancel">取消</button><button class="btn btn-primary" id="mf-ok">${editing ? '儲存' : '新增'}</button>`;
    const ov = UI.openSheet(editing ? '編輯' + (isCash ? '現金帳戶' : '負債') : '新增' + (isCash ? '現金帳戶' : '負債'), body, footer);
    const $ = s => ov.querySelector(s);
    let cur = cur0;
    ov.querySelectorAll('.fm-btn').forEach(b => b.addEventListener('click', () => {
      cur = b.dataset.c; ov.querySelectorAll('.fm-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
    }));
    const applyAdj = sign => {
      const d = parseFloat($('#mf-adj').value);
      if (isNaN(d) || d === 0) return;
      $('#mf-bal').value = String(((parseFloat($('#mf-bal').value) || 0) + sign * d));
      $('#mf-adj').value = '';
    };
    $('#mf-plus').addEventListener('click', () => applyAdj(1));
    $('#mf-minus').addEventListener('click', () => applyAdj(-1));
    $('#mf-cancel').addEventListener('click', UI.closeSheet);
    if ($('#mf-del')) $('#mf-del').addEventListener('click', () => UI.confirmDialog('刪除「' + (a.name || '') + '」?', () => {
      if (isCash) S.setCashAccounts(S.getCashAccounts().filter(x => x.id !== a.id));
      else S.setLiabilities(S.getLiabilities().filter(x => x.id !== a.id));
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    }, '刪除'));
    $('#mf-ok').addEventListener('click', () => {
      const name = ($('#mf-name').value || '').trim();
      const bal = parseFloat($('#mf-bal').value);
      if (!name) return UI.toast('請輸入名稱', 'info');
      if (isNaN(bal)) return UI.toast('請輸入金額', 'info');
      const list = isCash ? S.getCashAccounts() : S.getLiabilities();
      // 名稱不可與其他同類帳戶重複（避免新增同名時看似覆蓋原本資金）
      const dup = list.find(x => (x.name || '').trim() === name && (!editing || x.id !== a.id));
      if (dup) return UI.toast('已有同名' + (isCash ? '現金帳戶' : '負債') + '「' + name + '」，請改用其他名稱或直接點該項目編輯', 'info');
      if (editing) { const x = list.find(i => i.id === a.id); if (x) { x.name = name; x.currency = cur; x.balance = bal; } }
      else list.push({ id: S.uuid(), name, currency: cur, balance: bal });
      if (isCash) S.setCashAccounts(list); else S.setLiabilities(list);
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    });
  }

  // 新增群組
  function openGroupCreate(onDone) {
    const ov = UI.openSheet('新增群組', `<label class="fld">群組名稱<input class="input" id="gc-name" placeholder="例：ETF、核心持股"></label>`,
      `<button class="btn btn-ghost" id="gc-cancel">取消</button><button class="btn btn-primary" id="gc-ok">建立</button>`);
    ov.querySelector('#gc-cancel').addEventListener('click', UI.closeSheet);
    ov.querySelector('#gc-name').focus();
    ov.querySelector('#gc-ok').addEventListener('click', () => {
      const name = (ov.querySelector('#gc-name').value || '').trim();
      if (!name) return UI.toast('請輸入名稱', 'info');
      const gs = S.getGroups(); gs.push({ id: S.uuid(), name }); S.setGroups(gs);
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    });
  }

  // 群組選單：重新命名 / 解散
  function openGroupMenu(gid, onDone) {
    const g = S.getGroups().find(x => x.id === gid); if (!g) return;
    const ov = UI.openSheet(esc(g.name),
      `<label class="fld">重新命名<input class="input" id="gm-name" value="${esc(g.name)}"></label>`,
      `<button class="btn btn-danger" id="gm-del">解散群組</button><button class="btn btn-ghost" id="gm-cancel">取消</button><button class="btn btn-primary" id="gm-ok">儲存</button>`);
    ov.querySelector('#gm-cancel').addEventListener('click', UI.closeSheet);
    ov.querySelector('#gm-ok').addEventListener('click', () => {
      const name = (ov.querySelector('#gm-name').value || '').trim();
      if (!name) return UI.toast('請輸入名稱', 'info');
      const gs = S.getGroups(); const x = gs.find(i => i.id === gid); if (x) x.name = name; S.setGroups(gs);
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    });
    ov.querySelector('#gm-del').addEventListener('click', () => UI.confirmDialog('解散「' + g.name + '」？成員將變為未分組。', () => {
      S.setGroups(S.getGroups().filter(x => x.id !== gid));
      const gm = S.getGroupMap();
      for (const sym in gm) if (gm[sym] === gid) delete gm[sym];
      S.setGroupMap(gm);
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    }, '解散'));
  }

  // 指定持倉的群組（資產頁群組成員、群組詳情頁點個股）；底部可直接新增這檔的交易
  function openGroupAssign(sym, onDone) {
    const groups = S.getGroups();
    const gm = S.getGroupMap();
    const cur = gm[sym];
    let body = `<div class="ga-list">
      <div class="ga-item ${!cur ? 'on' : ''}" data-gid="">未分組${!cur ? ' ✓' : ''}</div>
      ${groups.map(g => `<div class="ga-item ${cur === g.id ? 'on' : ''}" data-gid="${g.id}">${esc(g.name)}${cur === g.id ? ' ✓' : ''}</div>`).join('')}
    </div>
    <div class="adj-row" style="margin-top:10px">
      <input class="input" id="ga-new" placeholder="或建立新群組">
      <button class="btn btn-ghost btn-sm" id="ga-create">建立並加入</button>
    </div>`;
    const ov = UI.openSheet(esc(sym) + ' 的群組', body, `<button class="btn btn-ghost" id="ga-cancel">關閉</button><button class="btn btn-primary" id="ga-tx">新增交易</button>`);
    ov.querySelector('#ga-cancel').addEventListener('click', UI.closeSheet);
    ov.querySelector('#ga-tx').addEventListener('click', () => { UI.closeSheet(); openTxForm(null, sym); });
    ov.querySelectorAll('.ga-item').forEach(it => it.addEventListener('click', () => {
      const gid = it.dataset.gid;
      const m = S.getGroupMap();
      if (gid) m[sym] = gid; else delete m[sym];
      S.setGroupMap(m);
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    }));
    ov.querySelector('#ga-create').addEventListener('click', () => {
      const name = (ov.querySelector('#ga-new').value || '').trim();
      if (!name) return UI.toast('請輸入名稱', 'info');
      const gs = S.getGroups(); const g = { id: S.uuid(), name }; gs.push(g); S.setGroups(gs);
      const m = S.getGroupMap(); m[sym] = g.id; S.setGroupMap(m);
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    });
  }

  /* ===================== 設定 ===================== */
  const SET_ICON = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const SET_ICONS = {
    cloud: SET_ICON('<path d="M7 18a4 4 0 1 1 .6-7.96A5.5 5.5 0 0 1 18 10.5a3.5 3.5 0 0 1-.5 7Z"/>'),
    lock: SET_ICON('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    moon: SET_ICON('<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z"/>'),
    pie: SET_ICON('<path d="M12 3a9 9 0 1 0 9 9h-9Z"/>'),
    cal: SET_ICON('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
    down: SET_ICON('<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>'),
    up: SET_ICON('<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>'),
    refresh: SET_ICON('<path d="M20 11a8 8 0 0 0-14.7-3.3M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 3.3M20 19v-4h-4"/>'),
    wrench: SET_ICON('<path d="M14.6 6.4a3.5 3.5 0 0 0-4.7 4.3L4 16.6 7.4 20l5.9-5.9a3.5 3.5 0 0 0 4.3-4.7l-2.2 2.2-2.3-.6-.6-2.3Z"/>'),
    gear: SET_ICON('<circle cx="12" cy="12" r="3"/><path d="M12 3v2m0 14v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    info: SET_ICON('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>'),
    flask: SET_ICON('<path d="M9 3v6l-4.5 8A2 2 0 0 0 6.3 20h11.4a2 2 0 0 0 1.8-3L15 9V3M8 3h8"/>'),
    trash: SET_ICON('<path d="M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13"/>'),
    repeat: SET_ICON('<path d="M17 3l3 3-3 3"/><path d="M20 6H8a4 4 0 0 0-4 4v1"/><path d="M7 21l-3-3 3-3"/><path d="M4 18h12a4 4 0 0 0 4-4v-1"/>'),
    scale: SET_ICON('<path d="M12 3v18M4 7h16"/><path d="M4 7l-2.5 6a3 3 0 0 0 5 0L4 7ZM20 7l-2.5 6a3 3 0 0 0 5 0L20 7Z"/>'),
    bell: SET_ICON('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
    coin: SET_ICON('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.4-2.5 1.7-2.5.7-2.5 1.7 1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>'),
  };
  const set = { sub: null }; // 設定頁內導覽：null | 'sync' | 'lock' | 'adv'
  function resetSettingsNav() { set.sub = null; }
  function setSubHead(title) { return `<div class="gd-head"><button class="gd-back" aria-label="返回">‹</button><div class="gd-title">${title}</div><div class="gd-actions"></div></div>`; }
  function setSubBack(root) { const b = root.querySelector('.gd-back'); if (b) b.addEventListener('click', () => { set.sub = null; settings(root); }); }
  // 單選選擇器（打勾）：供佔比基準／當日漲跌等
  function openChooser(title, opts, current, onPick) {
    const rows = opts.map(o => `<button class="chooser-row" data-v="${o.v}">
      <div class="chooser-txt"><div class="chooser-label">${esc(o.label)}</div>${o.hint ? `<div class="chooser-hint">${esc(o.hint)}</div>` : ''}</div>
      <span class="chooser-check">${o.v === current ? '✓' : ''}</span></button>`).join('');
    const ov = UI.openSheet(title, `<div class="chooser">${rows}</div>`, '');
    ov.querySelectorAll('.chooser-row').forEach(b => b.addEventListener('click', () => { UI.closeSheet(); onPick(b.dataset.v); }));
  }

  function settings(root) {
    if (set.sub === 'sync') return settingsSync(root);
    if (set.sub === 'lock') return settingsLock(root);
    if (set.sub === 'adv') return settingsAdv(root);
    if (set.sub === 'recurring') return settingsRecurring(root);
    if (set.sub === 'autodiv') return settingsAutoDiv(root);
    if (set.sub === 'lev') return settingsLeverage(root);
    const lastTs = S.getPricesTs(), rate = S.getFxRate();
    const syncOn = !!(App.Sync && App.Sync.enabled());
    const lockOn = !!(App.Auth && App.Auth.isEnabled());
    const pbLabel = { group: '組內', invest: '投資', net: '淨資產' }[S.getPctBasis()] || '投資';
    const dmLabel = { native: '原始', twday: '台股日' }[S.getDayMode()] || '原始';
    const nav = (k, id, label, val) => `<button class="s-row" id="${id}"><span class="s-ic">${SET_ICONS[k]}</span><span class="s-label">${label}</span>${val ? `<span class="s-val">${val}</span>` : ''}<span class="s-chev">›</span></button>`;
    const info = (label, val) => `<div class="s-row s-info"><span class="s-label">${label}</span><span class="s-val">${val}</span></div>`;
    let html = `
    <div class="s-topbar">設定</div>
    <div class="s-head">同步與安全</div>
    <div class="s-list">
      ${nav('cloud', 'set-sync', '雲端同步', syncOn ? '已啟用' : '未啟用')}
      ${nav('lock', 'set-lock', 'App 鎖定', lockOn ? '已啟用' : '未啟用')}
    </div>
    <div class="s-head">顯示</div>
    <div class="s-list">
      ${nav('moon', 'set-theme', '外觀', { auto: '跟隨系統', light: '淺色', dark: '深色' }[S.getTheme()])}
      ${nav('pie', 'set-pb', '投資佔比基準', pbLabel)}
      ${nav('cal', 'set-dm', '當日漲跌計算', dmLabel)}
      ${nav('scale', 'set-lev', '槓桿倍率', S.getLeverage().show ? '顯示' : '關閉')}
    </div>
    <div class="s-head">自動化</div>
    <div class="s-list">
      ${nav('repeat', 'set-recurring', '定期定額・定期繳款', (() => { const n = S.getRecurringPlans().filter(p => p && p.enabled !== false).length; return n ? n + ' 個' : ''; })())}
      ${nav('bell', 'set-autodiv-page', '自動股利匯入', (() => {
        const tw = S.getAutoDivImport(), us = S.getAutoDivUs() && App.Api.finnhubKey();
        return tw && us ? '台股・美股' : tw ? '台股' : us ? '美股' : '關閉';
      })())}
    </div>
    <div class="s-head">資料</div>
    <div class="s-list">
      ${nav('refresh', 'set-refresh-now', '立即更新報價')}
      ${nav('down', 'set-export', '匯出備份')}
      ${nav('up', 'set-import', '匯入備份')}
      ${nav('refresh', 'set-rebuild', '重建歷史走勢圖')}
      ${nav('wrench', 'set-fixfee', '修正異常手續費')}
    </div>
    <div class="s-head">進階</div>
    <div class="s-list">${nav('gear', 'set-adv', '報價來源與代理')}</div>
    <div class="s-head">關於</div>
    <div class="s-list">
      ${info('版本', App.VERSION || '?')}
      ${info('最後更新報價', lastTs ? new Date(lastTs).toLocaleString('zh-TW') : '尚未更新')}
      ${info('USD / TWD 匯率', rate ? rate.toFixed(3) : '--')}
      ${info('交易 / 快照', S.getTransactions().length + ' / ' + S.getSnapshots().length)}
    </div>
    <div class="s-head">其他</div>
    <div class="s-list">
      ${nav('flask', 'set-seed', '載入示範資料')}
      <button class="s-row s-danger" id="set-clear"><span class="s-ic">${SET_ICONS.trash}</span><span class="s-label">清空所有資料</span></button>
    </div>
    <input type="file" id="file-import" accept=".csv,text/csv" style="display:none">
    <div style="height:16px"></div>`;
    root.innerHTML = `<div class="page-full">${html}</div>`;

    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
    on('set-sync', () => { set.sub = 'sync'; settings(root); });
    on('set-lock', () => { set.sub = 'lock'; settings(root); });
    on('set-adv', () => { set.sub = 'adv'; settings(root); });
    on('set-recurring', () => { set.sub = 'recurring'; settings(root); });
    on('set-autodiv-page', () => { set.sub = 'autodiv'; settings(root); });
    on('set-lev', () => { set.sub = 'lev'; settings(root); });
    on('set-refresh-now', () => { UI.toast('更新中…', 'info'); App.refresh(undefined, true); });
    on('set-theme', () => openChooser('外觀', [
      { v: 'auto', label: '跟隨系統', hint: '依 iOS 深/淺色模式自動切換' },
      { v: 'light', label: '淺色', hint: '固定淺色主題' },
      { v: 'dark', label: '深色', hint: '固定深色主題' },
    ], S.getTheme(), v => { S.setTheme(v); if (App.applyTheme) App.applyTheme(); settings(root); }));
    on('set-pb', () => openChooser('投資佔比基準', [
      { v: 'group', label: '組內', hint: '以所屬群組總額為分母' },
      { v: 'invest', label: '投資', hint: '以投資總市值為分母' },
      { v: 'net', label: '淨資產', hint: '以淨資產為分母' },
    ], S.getPctBasis(), v => { S.setPctBasis(v); if (App.Sync) App.Sync.markDirty(); settings(root); }));
    on('set-dm', () => openChooser('當日漲跌計算', [
      { v: 'native', label: '原始', hint: '各市場自己的當日漲跌相加' },
      { v: 'twday', label: '台股日', hint: '以台股 09:00 起算歸零：台股開盤前與週末顯示 0（不顯示前一交易日漲跌）；美股白天顯示 0，晚上開盤才計入（凌晨那盤歸昨天）' },
    ], S.getDayMode(), v => { S.setDayMode(v); settings(root); }));
    on('set-export', doExport);
    on('set-import', () => root.querySelector('#file-import').click());
    root.querySelector('#file-import').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => UI.confirmDialog(`匯入「${esc(f.name)}」？備份裡有的分段（交易、快照、帳戶…）會取代目前資料，沒有的分段保留不動。建議先匯出備份。`, async () => {
        const res = App.Csv.importCsv(String(reader.result));
        if (res.ok) {
          UI.toast(`匯入成功：${res.txCount} 筆交易${res.snapCount ? '、' + res.snapCount + ' 筆快照' : ''}${res.divCount ? '、' + res.divCount + ' 筆股利' : ''}${res.planCount ? '、' + res.planCount + ' 個定期計畫' : ''}${res.futCount ? '、' + res.futCount + ' 筆期貨' : ''}`, 'success');
          if (res.feeWarnSymbols && res.feeWarnSymbols.length)
            UI.toast(`⚠️ ${res.feeWarnSymbols.join('、')} 手續費異常偏高，請檢查交易紀錄`, 'error');
          App.afterDataChange();
          if (!res.snapCount) { UI.toast('重建歷史走勢中…', 'info'); const n = await App.rebuildHistory(); if (n) UI.toast('已重建歷史走勢', 'success'); }
        } else UI.toast(res.msg || '匯入失敗', 'error');
      }, '匯入');
      reader.readAsText(f);
      e.target.value = '';
    });
    on('set-rebuild', async () => { UI.toast('重建歷史走勢中…', 'info'); const n = await App.rebuildHistory(); if (n) UI.toast(`已重建 ${n} 天歷史走勢`, 'success'); });
    on('set-fixfee', () => {
      const rep = C.repairFees();
      if (!rep.fixed.length) { UI.toast('沒有發現異常手續費', 'info'); return; }
      C.saveTodaySnapshot(); if (App.Sync) App.Sync.markDirty();
      const syms = [...new Set(rep.fixed.map(f => f.symbol))].join('、');
      UI.toast(`已修正 ${rep.fixed.length} 筆（${syms}）`, 'success'); settings(root);
    });
    on('set-seed', () => UI.confirmDialog('載入示範資料？會覆蓋你目前所有資料（可先匯出備份）。', () => { App.seedDemo(); UI.toast('已載入示範資料', 'success'); }, '載入'));
    on('set-clear', () => UI.confirmDialog('確定清空所有交易、損益與快照？此動作無法復原。', () => { S.clearAll(); UI.toast('已清空所有資料', 'info'); App.afterDataChange([]); }, '清空'));
  }

  // ── 設定子頁：雲端同步 ──
  function settingsSync(root) {
    const onEnabled = !!(App.Sync && App.Sync.enabled());
    const conflict = App.Sync && App.Sync.conflictInfo();
    root.innerHTML = `<div class="page-full">${setSubHead('雲端同步')}
      <div class="card setting-card">
        <div class="set-row">
          <input class="input" id="sync-token" type="password" placeholder="貼上 GitHub Token（gist 權限）" value="${onEnabled ? '••••••••••••' : ''}">
          <button class="btn btn-primary" id="sync-save">${onEnabled ? '更新' : '啟用'}</button>
        </div>
        <div class="set-row" style="margin-top:8px">
          <button class="btn btn-ghost" id="sync-now" style="flex:1" ${onEnabled ? '' : 'disabled'}>立即同步</button>
          ${onEnabled ? '<button class="btn btn-ghost" id="sync-off" style="flex:1">停用同步</button>' : ''}
        </div>
        <div class="set-hint" id="sync-status">${onEnabled ? '同步已啟用' : '各裝置貼同一組 token 即可自動同步同一份資料'}</div>
        <div class="set-hint"><a href="https://github.com/settings/tokens/new?scopes=gist&description=dives-sync" target="_blank" style="color:${COL.tw}">→ 點此產生 GitHub Token（已預選 gist 權限）</a></div>
      </div>
      ${conflict ? `<div class="card setting-card">
        <div class="set-sub">⚠️ 同步衝突（${new Date(conflict.savedAt).toLocaleString('zh-TW')}）</div>
        <div class="set-hint">另一台裝置也改過資料，目前顯示雲端版本；本機當時的版本已另存。</div>
        <div class="set-row" style="margin-top:8px">
          <button class="btn btn-ghost" id="sync-use-local" style="flex:1">改用本機版本</button>
          <button class="btn btn-ghost" id="sync-keep-remote" style="flex:1">保留雲端版本</button>
        </div>
      </div>` : ''}</div>`;
    setSubBack(root);
    const syncStatusEl = root.querySelector('#sync-status');
    function fmtSyncStatus(s) {
      if (!s || !syncStatusEl) return;
      if (s === 'syncing') { syncStatusEl.textContent = '同步中…'; return; }
      if (s.startsWith('synced:')) { const ts = +s.slice(7); syncStatusEl.textContent = ts ? ('已同步 · ' + new Date(ts).toLocaleString('zh-TW')) : '已同步'; return; }
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
      settings(root);
    });
    const nowBtn = root.querySelector('#sync-now');
    if (nowBtn) nowBtn.addEventListener('click', async () => { const r = await App.Sync.pull(); if (r.error) UI.toast('同步失敗：' + r.error, 'error'); else { UI.toast('同步完成', 'success'); if (r.changed) App.renderCurrent(); } });
    const useLocal = root.querySelector('#sync-use-local');
    if (useLocal) useLocal.addEventListener('click', () => UI.confirmDialog('改用本機版本？雲端（另一台裝置）的變更會被覆蓋。', async () => {
      const r = await App.Sync.useConflictLocal();
      UI.toast(r.ok ? '已改用本機版本並上傳' : '找不到另存版本', r.ok ? 'success' : 'error');
      App.renderCurrent(); settingsSync(root);
    }, '改用本機'));
    const keepRemote = root.querySelector('#sync-keep-remote');
    if (keepRemote) keepRemote.addEventListener('click', () => { App.Sync.dismissConflict(); settingsSync(root); });
    const offBtn = root.querySelector('#sync-off');
    if (offBtn) offBtn.addEventListener('click', () => UI.confirmDialog('停用同步？(本機資料會保留，雲端 Gist 不刪除)', () => { App.Sync.disable(); UI.toast('已停用同步', 'info'); settings(root); }, '停用'));
  }

  // ── 設定子頁：App 鎖定 ──
  function settingsLock(root) {
    root.innerHTML = `<div class="page-full">${setSubHead('App 鎖定')}<div class="card setting-card"><div id="lock-body"></div></div></div>`;
    setSubBack(root);
    renderLockBody(root.querySelector('#lock-body'), root);
  }

  // ── 設定子頁：報價來源與代理 ──
  function settingsAdv(root) {
    root.innerHTML = `<div class="page-full">${setSubHead('報價來源與代理')}
      <div class="card setting-card">
        <div class="set-sub">Finnhub API 金鑰（美股即時報價，選填）</div>
        <input class="input" id="set-finnhub" placeholder="留空 = 美股用收盤價（免金鑰）" value="${esc(localStorage.getItem('dives_finnhub_key'))}">
        <div class="set-hint">留空時美股改用 FinMind 收盤價（近日、非即時）。想要即時報價與美股搜尋，可到 <a href="https://finnhub.io/register" target="_blank" style="color:${COL.tw}">finnhub.io</a> 免費註冊取得金鑰後填入。</div>
        <div class="set-sub" style="margin-top:12px">FinMind Token（台股／美股收盤，可留空；註冊後填入可提高速率上限）</div>
        <input class="input" id="set-finmind" placeholder="免金鑰可用，額度有限" value="${esc(localStorage.getItem('dives_finmind_token'))}">
        <div class="set-sub">CORS 代理（選填；直連失敗時先試這裡，再改走 r.jina.ai）</div>
        <input class="input" id="set-proxy" placeholder="留空 = 直接改走 r.jina.ai" value="${esc(S.getProxy())}">
        <button class="btn btn-block btn-ghost" id="btn-adv-save" style="margin-top:10px">儲存進階設定</button>
      </div></div>`;
    setSubBack(root);
    root.querySelector('#btn-adv-save').addEventListener('click', () => {
      const fk = root.querySelector('#set-finnhub').value.trim();
      const fm = root.querySelector('#set-finmind').value.trim();
      const px = root.querySelector('#set-proxy').value.trim();
      if (fk) localStorage.setItem('dives_finnhub_key', fk); else localStorage.removeItem('dives_finnhub_key');
      if (fm) localStorage.setItem('dives_finmind_token', fm); else localStorage.removeItem('dives_finmind_token');
      S.setProxy(px);
      UI.toast('已儲存進階設定', 'success');
    });
  }

  // ── 設定子頁：自動股利匯入（台股/美股 分組 + iOS 開關）──
  function settingsAutoDiv(root) {
    const hasKey = !!App.Api.finnhubKey();
    const twOn = S.getAutoDivImport();
    const usOn = S.getAutoDivUs();
    const acctName = (id, fallback) => { const a = S.getCashAccounts().find(x => x.id === id); return a ? esc(a.name) : fallback; };
    const swRow = (label, id, on) => `<div class="s-row s-info"><span class="s-label">${label}</span>
      <label class="switch" style="margin-left:auto"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span></span></label></div>`;
    const navRow = (id, label, val) => `<button class="s-row" id="${id}"><span class="s-label">${label}</span><span class="s-val">${val}</span><span class="s-chev">›</span></button>`;

    let usHtml;
    if (!hasKey) {
      usHtml = `<button class="s-row" id="ad-us-key"><span class="s-label">需 Finnhub 金鑰，前往填寫</span><span class="s-chev">›</span></button>`;
    } else {
      usHtml = swRow('自動匯入', 'ad-us-sw', usOn)
        + navRow('ad-us-acct', '入帳帳戶', acctName(S.getAutoDivAcctUs(), '不入帳'))
        + navRow('ad-us-tax', '預扣稅率', S.getAutoDivUsTax() + '%');
    }
    root.innerHTML = `<div class="page-full">${setSubHead('自動股利匯入')}
      <div class="s-head">台股（FinMind・免金鑰）</div>
      <div class="s-list">
        ${swRow('自動匯入', 'ad-tw-sw', twOn)}
        ${navRow('ad-tw-acct', '入帳帳戶', acctName(S.getAutoDivAcct(), '不入帳'))}
      </div>
      <div class="s-head">美股（Finnhub 金鑰・Yahoo 後備）</div>
      <div class="s-list">${usHtml}</div>
      <div class="set-hint" style="margin-top:12px">開啟後每日自動掃描一次：依「除息日當時持股」計算，現金股息入帳所選帳戶（未選 → 只計入收益統計）、配股自動加股，並推播通知。美股以稅後淨額(USD)入帳；Finnhub 免費方案無股利權限時自動改用 Yahoo（以除息日入帳）。</div>
      <div style="height:16px"></div></div>`;
    setSubBack(root);

    const rescan = label => {
      UI.toast('掃描' + label + '股利中…', 'info');
      App.autoImportDividends(true).then(n => { UI.toast(n > 0 ? `已自動匯入 ${n} 筆股利` : '沒有新的股利', n > 0 ? 'success' : 'info'); App.renderCurrent(); });
    };
    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
    const tw = root.querySelector('#ad-tw-sw');
    if (tw) tw.addEventListener('change', () => { S.setAutoDivImport(tw.checked); if (tw.checked) rescan('台股'); });
    on('ad-tw-acct', () => {
      const accts = S.getCashAccounts().filter(a => a.currency === 'TWD');
      openChooser('台股股息入帳帳戶', [
        { v: '', label: '不入帳', hint: '只計入收益統計，不動現金帳戶' },
        ...accts.map(a => ({ v: a.id, label: a.name, hint: 'NT$ ' + U.formatPrice(a.balance || 0) })),
      ], S.getAutoDivAcct(), v => { S.setAutoDivAcct(v); settingsAutoDiv(root); });
    });
    on('ad-us-key', () => { set.sub = 'adv'; settings(root); });
    const us = root.querySelector('#ad-us-sw');
    if (us) us.addEventListener('change', () => { S.setAutoDivUs(us.checked); if (us.checked) rescan('美股'); });
    on('ad-us-acct', () => {
      const accts = S.getCashAccounts().filter(a => a.currency === 'USD');
      openChooser('美股股息入帳帳戶', [
        { v: '', label: '不入帳', hint: '只計入收益統計，不動現金帳戶' },
        ...accts.map(a => ({ v: a.id, label: a.name, hint: '$ ' + U.formatPrice(a.balance || 0) })),
      ], S.getAutoDivAcctUs(), v => { S.setAutoDivAcctUs(v); settingsAutoDiv(root); });
    });
    on('ad-us-tax', () => openChooser('美股股息預扣稅率', [
      { v: '30', label: '30%', hint: '台灣投資人預設（非稅約國預扣）' },
      { v: '15', label: '15%', hint: '稅約國稅率' },
      { v: '10', label: '10%' },
      { v: '0', label: '0%', hint: '記稅前全額' },
    ], String(S.getAutoDivUsTax()), v => { S.setAutoDivUsTax(+v); settingsAutoDiv(root); }));
  }

  // ── 設定子頁：槓桿倍率（顯示開關、期貨／負債計法、自訂倍數）──
  function settingsLeverage(root) {
    const cfg = S.getLeverage();
    const syms = Object.keys(cfg.mult).sort();
    const swRow = (label, id, on) => `<div class="s-row s-info"><span class="s-label">${label}</span>
      <label class="switch" style="margin-left:auto"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span></span></label></div>`;
    const navRow = (id, label, val, extra) => `<button class="s-row"${id ? ` id="${id}"` : ''}${extra || ''}><span class="s-label">${label}</span><span class="s-val">${val}</span><span class="s-chev">›</span></button>`;
    root.innerHTML = `<div class="page-full">${setSubHead('槓桿倍率')}
      <div class="s-list">${swRow('在資產頁顯示', 'lv-show', cfg.show)}</div>
      <div class="set-hint" style="margin:8px 16px 0">槓桿 ＝ (持股市值 × 倍數 ＋ 期貨契約值) ÷ 淨資產</div>
      <div class="s-head">計算方式</div>
      <div class="s-list">
        ${navRow('lv-fut', '期貨', cfg.futures === 'none' ? '不計' : '契約值')}
        ${navRow('lv-liab', '負債', cfg.liab === 'gross' ? '不計' : '從淨資產扣除')}
      </div>
      <div class="s-head">自訂倍數</div>
      <div class="s-list">
        ${syms.map(sym => navRow('', esc(sym), cfg.mult[sym] + ' 倍', ` data-sym="${esc(sym)}"`)).join('')}
        <button class="s-row" id="lv-add"><span class="s-label" style="color:var(--primary)">＋ 新增標的</span></button>
      </div>
      <div class="set-hint" style="margin:8px 16px 0">未列出的標的一律 1 倍；正二填 2、三倍 ETF 填 3、反向可填 −1。</div>
      <div style="height:16px"></div></div>`;
    setSubBack(root);
    const rerender = () => settingsLeverage(root);
    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
    root.querySelector('#lv-show').addEventListener('change', e => { S.setLeverage({ show: e.target.checked }); if (App.Sync) App.Sync.markDirty(); });
    on('lv-fut', () => openChooser('期貨', [
      { v: 'notional', label: '契約值', hint: '口數 × 指數 × 乘數 計入曝險' },
      { v: 'none', label: '不計', hint: '只看股票' },
    ], cfg.futures, v => { S.setLeverage({ futures: v }); rerender(); }));
    on('lv-liab', () => openChooser('負債', [
      { v: 'net', label: '從淨資產扣除', hint: '分母＝淨資產，借錢投資會拉高槓桿' },
      { v: 'gross', label: '不計', hint: '分母＝不扣負債的總資產' },
    ], cfg.liab, v => { S.setLeverage({ liab: v }); rerender(); }));
    // 新增／編輯：代號 + 倍數；倍數留空或 1 = 移除
    const edit = sym => {
      // 建議清單：先列持股（代號／名稱比對），再補線上搜尋結果
      const held = C.buildPositions().filter(p => !(p.symbol in cfg.mult)).map(p => ({ code: p.symbol, name: p.name || p.symbol, market: p.market }));
      const ov = UI.openSheet(sym ? esc(sym) : '新增標的', `
        ${sym ? '' : `<label class="fld">代號<input class="input" id="lv-sym" placeholder="例：00631L、TQQQ" autocomplete="off" autocapitalize="characters"></label><div class="suggest" id="lv-suggest"></div>`}
        <label class="fld">倍數<input class="input" id="lv-mult" type="number" inputmode="decimal" step="0.1" value="${sym ? cfg.mult[sym] : 2}"></label>`,
        `${sym ? '<button class="btn btn-ghost" id="lv-del">移除</button>' : '<button class="btn btn-ghost" id="lv-cancel">取消</button>'}<button class="btn btn-primary" id="lv-ok">儲存</button>`);
      const save = (code, m) => { const mult = Object.assign({}, S.getLeverage().mult); if (m == null || m === 1) delete mult[code]; else mult[code] = m; S.setLeverage({ mult }); if (App.Sync) App.Sync.markDirty(); UI.closeSheet(); rerender(); };
      on('lv-cancel', UI.closeSheet); on('lv-del', () => save(sym, null));
      const symInput = ov.querySelector('#lv-sym'), sug = ov.querySelector('#lv-suggest');
      if (symInput) {
        let timer = null, seq = 0;
        const render = list => {
          sug.innerHTML = list.map(r => `<div class="sug-item" data-code="${esc(r.code)}"><span class="sc">${esc(r.code)}</span><span class="sn">${esc(r.name)}</span><span class="sm">${U.marketLabel(r.market)}</span></div>`).join('');
          sug.querySelectorAll('.sug-item').forEach(it => it.addEventListener('click', () => { symInput.value = it.dataset.code; sug.innerHTML = ''; ov.querySelector('#lv-mult').focus(); }));
        };
        const show = () => {
          const q = symInput.value.trim().toUpperCase();
          clearTimeout(timer); const my = ++seq;
          const local = held.filter(h => !q || h.code.toUpperCase().includes(q) || (h.name || '').toUpperCase().includes(q));
          render(local);
          if (q.length < 2) return;
          timer = setTimeout(async () => {
            const res = await App.Api.searchSymbols(q).catch(() => []);
            if (my !== seq) return;
            const seen = new Set(local.map(h => h.code));
            render(local.concat(res.filter(r => !seen.has(r.code)).slice(0, 8)));
          }, 220);
        };
        symInput.addEventListener('input', show);
        symInput.addEventListener('focus', show);
      }
      const okBtn = ov.querySelector('#lv-ok');
      okBtn.addEventListener('click', () => {
        const code = sym || (ov.querySelector('#lv-sym').value || '').trim().toUpperCase();
        const m = parseFloat(ov.querySelector('#lv-mult').value);
        if (!code) return UI.toast('請輸入代號', 'info');
        if (isNaN(m)) return UI.toast('請輸入倍數', 'info');
        save(code, m);
      });
      const first = ov.querySelector(sym ? '#lv-mult' : '#lv-sym'); if (first) first.focus();
    };
    on('lv-add', () => edit(null));
    root.querySelectorAll('.s-row[data-sym]').forEach(b => b.addEventListener('click', () => edit(b.dataset.sym)));
  }

  // ── 設定子頁：定期定額 / 定期繳款 ──
  function settingsRecurring(root) {
    const plans = S.getRecurringPlans();
    const today = U.isoDate();
    const liabMap = {}; for (const l of S.getLiabilities()) liabMap[l.id] = l;
    const acctMap = {}; for (const a of S.getCashAccounts()) acctMap[a.id] = a;
    const WD = ['日', '一', '二', '三', '四', '五', '六'];
    const freqLabel = f => f === 'weekly' ? '每週' : f === 'biweekly' ? '每兩週' : '每月';
    const whenLabel = p => p.freq === 'monthly' ? ('每月 ' + (p.day || 6) + ' 日') : (freqLabel(p.freq) + '・星期' + WD[p.day != null ? p.day : 1]);
    const nextLabel = p => {
      if (p.enabled === false) return '已暫停';
      const nx = C.recurringDueDates(p, C.isoAddDays(today, 400)).find(d => d > today);
      return nx ? ('下次 ' + nx.slice(5)) : (p.endDate && p.endDate < today ? '已結束' : '—');
    };
    const curOf = p => {
      if (p.kind === 'dca') { const mk = U.normalizeMarketKey(p.market); return (mk === U.Market.us || mk === U.Market.crypto) ? '$' : 'NT$'; }
      const l = liabMap[p.liabilityId]; return l && l.currency === 'USD' ? '$' : 'NT$';
    };
    const card = p => {
      const title = p.kind === 'dca'
        ? ((p.name && p.name !== p.symbol) ? (p.symbol + ' ' + p.name) : p.symbol)
        : ((liabMap[p.liabilityId] && liabMap[p.liabilityId].name) || '（負債已刪除）');
      const badge = p.kind === 'dca' ? U.marketLabel(p.market) : '繳款';
      const acct = p.accountId && acctMap[p.accountId] ? ('・' + acctMap[p.accountId].name) : '';
      return `<button class="rp-card${p.enabled === false ? ' rp-paused' : ''}" data-id="${p.id}">
        <div class="rp-main">
          <div class="rp-title">${esc(title)} <span class="rp-badge">${badge}</span></div>
          <div class="rp-sub">${curOf(p) + U.fmtWhole(p.amount || 0)}／期・${whenLabel(p)}${esc(acct)}</div>
        </div>
        <div class="rp-next">${nextLabel(p)}<span class="s-chev">›</span></div>
      </button>`;
    };
    const dca = plans.filter(p => p.kind === 'dca');
    const liab = plans.filter(p => p.kind === 'liability');
    let html = setSubHead('定期定額・定期繳款');
    html += `<div style="padding:2px 14px 20px">
      <button class="btn btn-block btn-primary" id="rp-add">＋ 新增計畫</button>`;
    if (!plans.length) html += `<div class="empty" style="padding:28px 8px">尚無計畫。<br>可設定股票／加密「定期定額」自動買入，<br>或負債「定期繳款」自動扣減餘額。</div>`;
    else {
      if (dca.length) html += `<div class="s-head">定期定額</div><div class="rp-list">${dca.map(card).join('')}</div>`;
      if (liab.length) html += `<div class="s-head">定期繳款</div><div class="rp-list">${liab.map(card).join('')}</div>`;
    }
    html += `<div class="set-hint" style="margin-top:14px">定期定額依排程日的歷史價自動建立買入（非即時成交價，可事後編輯校正）；沒開 App 期間到期的會在下次開啟時一次補齊。</div></div>`;
    root.innerHTML = `<div class="page-full">${html}</div>`;
    setSubBack(root);
    root.querySelector('#rp-add').addEventListener('click', () => openRecurringChooser(() => settings(root)));
    root.querySelectorAll('.rp-card').forEach(c => c.addEventListener('click', () => {
      const p = S.getRecurringPlans().find(x => x.id === c.dataset.id);
      if (p) openRecurringForm(p.kind, p, () => settings(root));
    }));
  }

  // 新增計畫類型選擇
  function openRecurringChooser(onDone) {
    const hasLiab = S.getLiabilities().length > 0;
    const ov = UI.openSheet('新增計畫', `
      <div class="ga-list">
        <div class="ga-item" data-k="dca"><b>定期定額（股票 / 加密）</b><span class="ga-sub">依排程自動買入固定金額</span></div>
        <div class="ga-item" data-k="liability"><b>定期繳款（負債）</b><span class="ga-sub">${hasLiab ? '依排程自動扣減負債餘額' : '請先於資產頁新增負債'}</span></div>
      </div>`, '');
    ov.querySelectorAll('.ga-item').forEach(it => it.addEventListener('click', () => {
      const k = it.dataset.k;
      if (k === 'liability' && !S.getLiabilities().length) { UI.toast('請先於資產頁新增負債', 'info'); return; }
      UI.closeSheet();
      openRecurringForm(k, null, onDone);
    }));
  }

  // 計畫編輯表單（新增 / 編輯定期定額 or 定期繳款）
  function openRecurringForm(kind, editing, onDone) {
    const isDca = kind === 'dca';
    const p = editing || {};
    const today = U.isoDate();
    const liabs = S.getLiabilities();
    const st = {
      freq: p.freq || 'monthly',
      basis: p.priceBasis || 'close',
      feeMode: p.feeMode || 'rate',
      enabled: p.enabled !== false,
      picked: editing && isDca ? { code: p.symbol, name: p.name, market: p.market } : null,
    };
    const dom = Math.min(28, (p.freq !== 'monthly' && p.day != null) ? 6 : (p.day || 6));
    const dow = (p.freq && p.freq !== 'monthly' && p.day != null) ? p.day : 1;
    const target = isDca
      ? `<label class="fld">標的（股票 / 加密貨幣）
          ${editing ? `<div class="locked">${esc(p.symbol)}${p.name && p.name !== p.symbol ? ' · ' + esc(p.name) : ''} <span>🔒</span></div>`
            : `<input class="input" id="rp-sym" autocomplete="off" placeholder="代碼或名稱（2330、台積電、AAPL、BTC…）">
               <div class="suggest" id="rp-suggest"></div>`}
        </label>`
      : `<label class="fld">負債
          <select class="input" id="rp-liab">${liabs.map(l => `<option value="${l.id}"${p.liabilityId === l.id ? ' selected' : ''}>${esc(l.name)}（${l.currency} ${U.formatPrice(l.balance || 0)}）</option>`).join('')}</select>
        </label>`;
    const body = `
      ${target}
      <label class="fld">${isDca ? '每期投入金額' : '每期繳款金額'}<input class="input" id="rp-amount" type="number" inputmode="decimal" value="${p.amount != null ? p.amount : ''}" placeholder="0"></label>
      <label class="fld">頻率
        <div class="fee-mode" id="rp-freq">
          <button type="button" class="fm-btn ${st.freq === 'monthly' ? 'active' : ''}" data-f="monthly">每月</button>
          <button type="button" class="fm-btn ${st.freq === 'biweekly' ? 'active' : ''}" data-f="biweekly">每兩週</button>
          <button type="button" class="fm-btn ${st.freq === 'weekly' ? 'active' : ''}" data-f="weekly">每週</button>
        </div>
      </label>
      <label class="fld" id="rp-dom-fld" style="${st.freq === 'monthly' ? '' : 'display:none'}">每月執行日<input class="input" id="rp-dom" type="number" inputmode="numeric" min="1" max="28" value="${dom}" placeholder="1–28"></label>
      <label class="fld" id="rp-dow-fld" style="${st.freq === 'monthly' ? 'display:none' : ''}">每週執行日
        <select class="input" id="rp-dow">${WD_OPTS(dow)}</select>
      </label>
      <div class="fld-row">
        <label class="fld">開始日期<input class="input" id="rp-start" type="date" value="${p.startDate || today}"></label>
        <label class="fld">結束日期（可留空）<input class="input" id="rp-end" type="date" value="${p.endDate || ''}"></label>
      </div>
      ${isDca ? `
      <label class="fld">買入價格基準
        <div class="fee-mode" id="rp-basis">
          <button type="button" class="fm-btn ${st.basis === 'close' ? 'active' : ''}" data-b="close">收盤價</button>
          <button type="button" class="fm-btn ${st.basis === 'open' ? 'active' : ''}" data-b="open">開盤價</button>
        </div>
        <div class="set-hint">依排程日歷史價自動建立買入（非即時成交價）。加密貨幣一律用當日價。</div>
      </label>
      <label class="fld">手續費
        <div class="fee-mode" id="rp-feemode">
          <button type="button" class="fm-btn ${st.feeMode === 'rate' ? 'active' : ''}" data-m="rate">費率 %</button>
          <button type="button" class="fm-btn ${st.feeMode === 'fixed' ? 'active' : ''}" data-m="fixed">固定金額</button>
          <button type="button" class="fm-btn ${st.feeMode === 'none' ? 'active' : ''}" data-m="none">無</button>
        </div>
        <input class="input" id="rp-feeval" type="number" inputmode="decimal" value="${p.feeVal != null ? p.feeVal : '0.1425'}" ${st.feeMode === 'none' ? 'disabled' : ''}>
      </label>` : ''}
      <label class="fld">${isDca ? '扣款現金帳戶（選填）' : '繳款來源現金帳戶（選填）'}
        <select class="input" id="rp-acct"><option value="">不使用現金帳戶</option></select>
      </label>
      <label class="fld">狀態
        <div class="fee-mode" id="rp-enabled">
          <button type="button" class="fm-btn ${st.enabled ? 'active' : ''}" data-e="1">啟用</button>
          <button type="button" class="fm-btn ${st.enabled ? '' : 'active'}" data-e="0">暫停</button>
        </div>
      </label>
      <div class="set-hint">${isDca ? '每次到期自動建立買入交易；儲存後會立即補齊「開始日～今天」的期數。' : '每期自動扣減負債餘額；有選帳戶則同步扣款。儲存後立即補齊已到期期數。'}</div>`;
    const footer = `${editing ? '<button class="btn btn-danger" id="rp-del">刪除</button>' : ''}<button class="btn btn-ghost" id="rp-cancel">取消</button><button class="btn btn-primary" id="rp-ok">${editing ? '儲存' : '建立'}</button>`;
    const ov = UI.openSheet(editing ? '編輯計畫' : (isDca ? '新增定期定額' : '新增定期繳款'), body, footer);
    const $ = s => ov.querySelector(s);

    function curForDca() {
      const mk = st.picked ? U.normalizeMarketKey(st.picked.market)
        : U.guessMarketBySymbol(U.sanitizeSymbol($('#rp-sym') ? $('#rp-sym').value : (p.symbol || '')));
      return (mk === U.Market.us || mk === U.Market.crypto) ? 'USD' : 'TWD';
    }
    function curForLiab() { const l = liabs.find(x => x.id === ($('#rp-liab') ? $('#rp-liab').value : p.liabilityId)); return l ? l.currency : 'TWD'; }
    function refreshAcct() {
      const sel = $('#rp-acct'); if (!sel) return;
      const want = isDca ? curForDca() : curForLiab();
      const keep = sel.value || (editing ? p.accountId : '');
      const opts = S.getCashAccounts().filter(a => a.currency === want);
      sel.innerHTML = '<option value="">不使用現金帳戶</option>' + opts.map(a => `<option value="${a.id}">${esc(a.name)}（${a.currency} ${U.formatPrice(a.balance || 0)}）</option>`).join('');
      if (keep && opts.some(a => a.id === keep)) sel.value = keep;
    }
    refreshAcct();

    // 頻率切換 → 顯示對應的執行日欄位
    ov.querySelectorAll('#rp-freq .fm-btn').forEach(b => b.addEventListener('click', () => {
      st.freq = b.dataset.f;
      ov.querySelectorAll('#rp-freq .fm-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
      $('#rp-dom-fld').style.display = st.freq === 'monthly' ? '' : 'none';
      $('#rp-dow-fld').style.display = st.freq === 'monthly' ? 'none' : '';
    }));
    if (isDca) {
      ov.querySelectorAll('#rp-basis .fm-btn').forEach(b => b.addEventListener('click', () => {
        st.basis = b.dataset.b; ov.querySelectorAll('#rp-basis .fm-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
      }));
      ov.querySelectorAll('#rp-feemode .fm-btn').forEach(b => b.addEventListener('click', () => {
        st.feeMode = b.dataset.m; ov.querySelectorAll('#rp-feemode .fm-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
        $('#rp-feeval').disabled = st.feeMode === 'none';
      }));
    }
    ov.querySelectorAll('#rp-enabled .fm-btn').forEach(b => b.addEventListener('click', () => {
      st.enabled = b.dataset.e === '1'; ov.querySelectorAll('#rp-enabled .fm-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
    }));
    if (!isDca) { const ls = $('#rp-liab'); if (ls) ls.addEventListener('change', refreshAcct); }

    // 標的自動完成（定期定額，新增時）
    if (isDca && !editing) {
      const symInput = $('#rp-sym'), sug = $('#rp-suggest');
      let timer = null;
      symInput.addEventListener('input', () => {
        const q = symInput.value.trim();
        clearTimeout(timer);
        st.picked = null; refreshAcct();
        if (!q) { sug.innerHTML = ''; return; }
        timer = setTimeout(async () => {
          const res = await App.Api.searchSymbols(q);
          sug.innerHTML = res.map(r => `<div class="sug-item" data-code="${esc(r.code)}" data-name="${encodeURIComponent(r.name)}" data-mk="${r.market}"${r.cgid ? ` data-cgid="${r.cgid}"` : ''}>
            <span class="sc">${esc(r.code)}</span><span class="sn">${esc(r.name)}</span><span class="sm">${U.marketLabel(r.market)}</span></div>`).join('');
          sug.querySelectorAll('.sug-item').forEach(it => it.addEventListener('click', () => {
            const name = decodeURIComponent(it.dataset.name);
            symInput.value = it.dataset.code + ' ' + name;
            sug.innerHTML = '';
            st.picked = { code: it.dataset.code, name, market: it.dataset.mk };
            if (it.dataset.cgid) App.Api.cacheCgId(it.dataset.code, it.dataset.cgid);
            if (st.feeMode === 'rate') $('#rp-feeval').value = defaultFeeRate(it.dataset.mk);
            refreshAcct();
          }));
        }, 220);
      });
    }

    $('#rp-cancel').addEventListener('click', UI.closeSheet);
    if ($('#rp-del')) $('#rp-del').addEventListener('click', () => UI.confirmDialog('刪除此計畫？（已建立的交易不會被刪除）', () => {
      S.setRecurringPlans(S.getRecurringPlans().filter(x => x.id !== p.id));
      UI.closeSheet(); if (App.Sync) App.Sync.markDirty(); onDone && onDone();
    }, '刪除'));

    $('#rp-ok').addEventListener('click', () => {
      const amount = parseFloat($('#rp-amount').value);
      if (!(amount > 0)) return UI.toast('請輸入正確的金額', 'info');
      const startDate = $('#rp-start').value || today;
      const endDate = $('#rp-end').value || null;
      if (endDate && endDate < startDate) return UI.toast('結束日期不能早於開始日期', 'info');
      const day = st.freq === 'monthly' ? Math.min(28, Math.max(1, parseInt($('#rp-dom').value, 10) || 6)) : parseInt($('#rp-dow').value, 10);
      const accountId = $('#rp-acct').value || null;
      const base = { freq: st.freq, day, startDate, endDate, enabled: st.enabled, accountId };

      let plan;
      if (isDca) {
        let symbol, market, name;
        if (editing) { symbol = p.symbol; market = p.market; name = p.name; }
        else {
          const raw = $('#rp-sym').value;
          symbol = U.sanitizeSymbol(raw);
          if (!symbol) return UI.toast('請輸入標的代碼', 'info');
          const pk = (st.picked && st.picked.code === symbol) ? st.picked : null;
          market = pk ? U.normalizeMarketKey(pk.market) : U.guessMarketBySymbol(symbol);
          name = pk ? pk.name : symbol;
        }
        const feeMode = st.feeMode;
        const feeVal = feeMode === 'none' ? 0 : (parseFloat($('#rp-feeval').value) || 0);
        plan = Object.assign({}, editing || {}, base, { kind: 'dca', symbol, market, name, priceBasis: st.basis, feeMode, feeVal });
      } else {
        const liabilityId = $('#rp-liab').value;
        if (!liabilityId) return UI.toast('請選擇負債', 'info');
        plan = Object.assign({}, editing || {}, base, { kind: 'liability', liabilityId });
      }
      plan.amount = amount;
      if (!plan.id) { plan.id = S.uuid(); plan.createdAt = Date.now(); plan.lastRun = null; }

      const list = S.getRecurringPlans();
      const idx = list.findIndex(x => x.id === plan.id);
      if (idx >= 0) list[idx] = plan; else list.push(plan);
      S.setRecurringPlans(list);
      UI.closeSheet();
      if (App.Sync) App.Sync.markDirty();
      onDone && onDone();
      // 立即補齊已到期期數（DCA 會回補歷史買入 → 重建走勢）
      if (App.runRecurringPlans) App.runRecurringPlans().then(async n => {
        if (n > 0) { if (plan.kind === 'dca' && App.rebuildHistory) await App.rebuildHistory(); UI.toast(`已補齊 ${n} 筆`, 'success'); }
        App.renderCurrent(); onDone && onDone();
      });
    });
  }
  const WD_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
  function WD_OPTS(sel) { return WD_LABELS.map((w, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>星期${w}</option>`).join(''); }

  async function renderLockBody(el, root) {
    if (!el || !App.Auth) return;
    const A = App.Auth;
    if (!A.isEnabled()) {
      el.innerHTML = `<div class="set-hint">啟用後，開啟 App 需以密碼或 Face ID 解鎖（資料仍存本機）</div>
        <button class="btn btn-block btn-primary" id="lock-enable" style="margin-top:8px">啟用 App 鎖定</button>`;
      el.querySelector('#lock-enable').addEventListener('click', () => openLockSetup(false, () => settings(root)));
      return;
    }
    // 優先用已快取的可用性（同步）→ 一次填完，避免鎖定卡先空再撐開造成閃動
    let faceAvail = A.webAuthnAvailableSync ? A.webAuthnAvailableSync() : null;
    if (faceAvail === null) faceAvail = await A.isWebAuthnAvailable();
    const hasFace = A.hasWebAuthn();
    const t = A.getTimeout();
    el.innerHTML = `
      <div class="lock-row"><span>密碼</span><button class="btn btn-ghost btn-sm" id="lock-chpin">變更</button></div>
      ${faceAvail ? `<div class="lock-row"><span>Face ID / Touch ID</span><label class="switch"><input type="checkbox" id="lock-face" ${hasFace ? 'checked' : ''}><span></span></label></div>`
        : `<div class="set-hint">此裝置不支援生物辨識</div>`}
      <div class="lock-row"><span>自動鎖定</span>
        <select class="select" id="lock-timeout">
          <option value="0">立即</option><option value="1">1 分鐘</option>
          <option value="5">5 分鐘</option><option value="15">15 分鐘</option><option value="60">1 小時</option>
        </select></div>
      <button class="btn btn-block btn-danger" id="lock-disable" style="margin-top:10px">停用 App 鎖定</button>`;
    el.querySelector('#lock-timeout').value = String(t);
    el.querySelector('#lock-chpin').addEventListener('click', () => openLockSetup(true, () => UI.toast('密碼已變更', 'success')));
    el.querySelector('#lock-timeout').addEventListener('change', e => { A.setTimeout(+e.target.value); UI.toast('已更新自動鎖定', 'success'); });
    el.querySelector('#lock-disable').addEventListener('click', () =>
      UI.confirmDialog('停用 App 鎖定？開啟 App 將不再需要驗證。', () => { A.disable(); UI.toast('已停用 App 鎖定', 'info'); settings(root); }, '停用'));
    const faceToggle = el.querySelector('#lock-face');
    if (faceToggle) faceToggle.addEventListener('change', async () => {
      if (faceToggle.checked) {
        try { await A.registerWebAuthn(); UI.toast('已啟用 Face ID', 'success'); }
        catch (e) { faceToggle.checked = false; UI.toast('Face ID 設定取消或失敗', 'error'); }
      } else { A.disableWebAuthn(); UI.toast('已關閉 Face ID', 'info'); }
    });
  }

  // PIN 設定 / 變更：輸入兩次確認（4–6 碼）
  function openLockSetup(isChange, onDone) {
    const body = `
      <label class="fld">設定密碼（4–6 位數字）
        <input class="input" id="pin1" type="password" inputmode="numeric" maxlength="6" placeholder="輸入密碼">
      </label>
      <label class="fld">再次輸入
        <input class="input" id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="再次輸入">
      </label>
      <div class="set-hint" id="pin-err" style="color:${UI.LOSS};min-height:16px"></div>`;
    const ov = UI.openSheet(isChange ? '變更密碼' : '設定 App 鎖定密碼', body,
      `<button class="btn btn-ghost" id="pin-cancel">取消</button><button class="btn btn-primary" id="pin-ok">確認</button>`);
    const $ = s => ov.querySelector(s);
    $('#pin-cancel').addEventListener('click', UI.closeSheet);
    $('#pin1').focus();
    $('#pin-ok').addEventListener('click', async () => {
      const p1 = $('#pin1').value, p2 = $('#pin2').value;
      if (!/^\d{4,6}$/.test(p1)) { $('#pin-err').textContent = '請輸入 4–6 位數字'; return; }
      if (p1 !== p2) { $('#pin-err').textContent = '兩次輸入不一致'; return; }
      if (isChange) await App.Auth.setPin(p1);
      else await App.Auth.enable(p1);
      UI.closeSheet();
      onDone && onDone();
    });
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
  // 股利/配股 輸入表單。kind: 'cash'(現金股利) | 'stock'(配股)
  function openDividendForm(kind, editing, onDone) {
    const isCash = kind === 'cash';
    const p = editing || {};
    const today = U.isoDate();
    const st = { picked: editing ? { code: p.symbol, name: p.name, market: p.market } : null };
    const symField = editing
      ? `<div class="locked">${esc(p.symbol)}${p.name && p.name !== p.symbol ? ' · ' + esc(p.name) : ''} <span>🔒</span></div>`
      : `<input class="input" id="dv-sym" autocomplete="off" placeholder="代碼或名稱（2330、台積電、AAPL…）">
         <div class="suggest" id="dv-suggest"></div>`;
    const body = `
      <label class="fld">標的${symField}</label>
      ${isCash
        ? `<label class="fld">實收金額（美股填已扣稅後淨額）<input class="input" id="dv-amount" type="number" inputmode="decimal" value="${p.amount != null ? p.amount : ''}" placeholder="0"></label>`
        : `<label class="fld">配發股數<input class="input" id="dv-shares" type="number" inputmode="decimal" value="${p.shares != null ? p.shares : ''}" placeholder="0"></label>`}
      <label class="fld">日期<input class="input" id="dv-date" type="date" value="${p.date || today}"></label>
      ${isCash ? `<label class="fld">導入現金帳戶（選填）
        <select class="input" id="dv-acct"><option value="">不導入（只計入報酬統計）</option></select>
      </label>
      <div class="set-hint">選帳戶 → 股息入帳、淨資產增加；不選 → 只計入含息報酬與股息統計。</div>` : ''}`;
    // 配股(stock)編輯模式僅供檢視/刪除(股數不改,要改則刪除重加) → 不顯示儲存鈕
    const footer = `${editing ? '<button class="btn btn-danger" id="dv-del">刪除</button>' : ''}<button class="btn btn-ghost" id="dv-cancel">取消</button>${(editing && !isCash) ? '' : `<button class="btn btn-primary" id="dv-ok">${editing ? '儲存' : '新增'}</button>`}`;
    const ov = UI.openSheet(editing ? (isCash ? '編輯現金股利' : '編輯配股') : (isCash ? '新增現金股利' : '新增配股（股票股利）'), body, footer);
    const $ = s => ov.querySelector(s);

    function marketOf() {
      return st.picked ? U.normalizeMarketKey(st.picked.market)
        : U.guessMarketBySymbol(U.sanitizeSymbol($('#dv-sym') ? $('#dv-sym').value : (p.symbol || '')));
    }
    function refreshAcct() {
      const sel = $('#dv-acct'); if (!sel) return;
      const mk = marketOf();
      const want = (mk === U.Market.us || mk === U.Market.crypto) ? 'USD' : 'TWD';
      const keep = sel.value || (editing ? p.accountId : '');
      const opts = S.getCashAccounts().filter(a => a.currency === want);
      sel.innerHTML = '<option value="">不導入（只計入報酬統計）</option>' + opts.map(a => `<option value="${a.id}">${esc(a.name)}（${a.currency} ${U.formatPrice(a.balance || 0)}）</option>`).join('');
      if (keep && opts.some(a => a.id === keep)) sel.value = keep;
    }
    refreshAcct();

    if (!editing) {
      const symInput = $('#dv-sym'), sug = $('#dv-suggest');
      let timer = null;
      symInput.addEventListener('input', () => {
        const q = symInput.value.trim(); clearTimeout(timer); st.picked = null; refreshAcct();
        if (!q) { sug.innerHTML = ''; return; }
        timer = setTimeout(async () => {
          const res = await App.Api.searchSymbols(q);
          sug.innerHTML = res.map(r => `<div class="sug-item" data-code="${esc(r.code)}" data-name="${encodeURIComponent(r.name)}" data-mk="${r.market}"${r.cgid ? ` data-cgid="${r.cgid}"` : ''}>
            <span class="sc">${esc(r.code)}</span><span class="sn">${esc(r.name)}</span><span class="sm">${U.marketLabel(r.market)}</span></div>`).join('');
          sug.querySelectorAll('.sug-item').forEach(it => it.addEventListener('click', () => {
            const name = decodeURIComponent(it.dataset.name);
            symInput.value = it.dataset.code + ' ' + name; sug.innerHTML = '';
            st.picked = { code: it.dataset.code, name, market: it.dataset.mk };
            if (it.dataset.cgid) App.Api.cacheCgId(it.dataset.code, it.dataset.cgid);
            refreshAcct();
          }));
        }, 220);
      });
    }

    $('#dv-cancel').addEventListener('click', UI.closeSheet);
    if ($('#dv-del')) $('#dv-del').addEventListener('click', () => UI.confirmDialog('刪除這筆？', () => {
      if (isCash) C.deleteDividend(p.id);
      else { const r = C.deleteTransaction(p.id); if (!r.ok) return UI.toast(r.msg, 'error'); }
      UI.closeSheet(); App.afterDataChange([p.symbol]);
    }, '刪除'));

    if ($('#dv-ok')) $('#dv-ok').addEventListener('click', () => {
      let symbol, market, name;
      if (editing) { symbol = p.symbol; market = p.market; name = p.name; }
      else {
        symbol = U.sanitizeSymbol($('#dv-sym').value);
        if (!symbol) return UI.toast('請輸入標的代碼', 'info');
        const pk = (st.picked && st.picked.code === symbol) ? st.picked : null;
        market = pk ? U.normalizeMarketKey(pk.market) : U.guessMarketBySymbol(symbol);
        name = pk ? pk.name : symbol;
      }
      const date = $('#dv-date').value || U.isoDate();
      if (isCash) {
        const amount = parseFloat($('#dv-amount').value);
        if (!(amount > 0)) return UI.toast('請輸入正確金額', 'info');
        const accountId = $('#dv-acct') ? ($('#dv-acct').value || undefined) : undefined;
        const res = editing ? C.updateDividend(p.id, { amount, date, accountId }) : C.addDividend({ symbolInput: symbol, market, name, amount, date, accountId });
        if (!res.ok) return UI.toast(res.msg, 'info');
      } else {
        const shares = parseFloat($('#dv-shares').value);
        if (!(shares > 0)) return UI.toast('請輸入正確配股股數', 'info');
        const res = C.addStockDividend({ symbolInput: symbol, market, name, shares, date });
        if (!res.ok) return UI.toast(res.msg, 'info');
      }
      UI.closeSheet(); App.afterDataChange([symbol]);
    });
  }

  let txState = null;
  function openTxForm(editing, presetSym, txOpts) {
    // txOpts.preset：由待確認交易帶入（代號、方向、日期、股數、價格、手續費金額、現金帳戶）；確認＝匯入
    const pre = (!editing && txOpts && txOpts.preset) || null;
    if (pre) presetSym = pre.symbol;
    txState = {
      editing: editing || null,
      isBuy: editing ? editing.type === 'BUY' : (pre ? !!pre.isBuy : true),
      symbol: editing ? editing.symbol : (presetSym || ''),
      feeMode: editing || pre ? 'amount' : 'rate', // 編輯／帶入：fee 是「絕對金額」，須用固定金額模式（否則被當費率%重算）
    };
    const ed = editing;
    const verb = pre ? '匯入' : '新增';
    // 由既有標的開表單（投資頁 → 新增交易）：市場/名稱取自 meta，預設費率、帳戶幣別、加密計價幣別才會跟著對
    if (!ed && presetSym) {
      const m = S.metaMap()[presetSym] || {};
      txState.picked = { code: presetSym, name: (pre && pre.name) || m.name || presetSym, market: U.normalizeMarketKey((pre && pre.market) || m.market || U.guessMarketBySymbol(presetSym)) };
    }
    const body = `${pre && pre.note ? `<div class="ibx-src">${esc(pre.note)}</div>` : ''}
      <div class="tx-toggle">
        <button class="tt-btn buy ${txState.isBuy ? 'active' : ''}" data-buy="1">買入</button>
        <button class="tt-btn sell ${!txState.isBuy ? 'active' : ''}" data-buy="0">賣出</button>
      </div>
      <label class="fld">股票代碼
        ${ed ? `<div class="locked">${ed.symbol} <span>🔒</span></div>`
        : `<input class="input" id="tx-sym" autocomplete="off" placeholder="代碼或名稱（2330、台積電、AAPL…）" value="${esc(presetSym)}">
           <div class="suggest" id="tx-suggest"></div>`}
      </label>
      <label class="fld">交易日期
        <input class="input" id="tx-date" type="date" value="${pre ? pre.date : U.isoDate(ed ? new Date(ed.time) : new Date())}">
      </label>
      <div class="fld-row">
        <label class="fld">股數<input class="input" id="tx-shares" type="number" inputmode="decimal" value="${ed ? ed.shares : pre ? pre.shares : ''}" placeholder="0"></label>
        <label class="fld">價格<input class="input" id="tx-price" type="number" inputmode="decimal" value="${ed ? ed.price : pre ? pre.price : ''}" placeholder="0.00"></label>
      </div>
      <label class="fld" id="price-cur-fld" style="display:none">計價幣別（虛擬貨幣）
        <div class="fee-mode">
          <button class="fm-btn pc-btn active" data-pc="USD">USD</button>
          <button class="fm-btn pc-btn" data-pc="TWD">台幣</button>
        </div>
        <div class="set-hint" id="price-cur-hint">在台灣交易所以台幣買入時選「台幣」，儲存時會依匯率換算為 USD</div>
      </label>
      <label class="fld">手續費
        <div class="fee-mode">
          <button class="fm-btn ${txState.feeMode === 'rate' ? 'active' : ''}" data-m="rate">費率 %</button>
          <button class="fm-btn ${txState.feeMode === 'amount' ? 'active' : ''}" data-m="amount">固定金額</button>
        </div>
        <input class="input" id="tx-fee" type="number" inputmode="decimal" value="${ed ? ed.fee : pre ? pre.fee : defaultFeeRate(txState.picked ? txState.picked.market : null)}">
      </label>
      ${!ed ? `<label class="fld">現金帳戶（買入扣款 / 賣出存入）
        <select class="input" id="tx-acct"><option value="">不使用現金帳戶</option></select>
      </label>` : ''}
      <div class="tx-preview" id="tx-preview"></div>`;
    const footer = `${pre && txOpts.onSkip ? '<button class="btn btn-ghost ibx-skipone" id="tx-skip">略過</button>' : ''}<button class="btn btn-ghost" id="tx-cancel">取消</button><button class="btn btn-primary" id="tx-submit">${pre ? '匯入這筆' : '確認'}</button>`;
    const ov = UI.openSheet(ed ? '編輯交易' : verb + (txState.isBuy ? '買入' : '賣出'), body, footer);

    const $ = s => ov.querySelector(s);
    function setTitle() { ov.querySelector('.sheet-title').textContent = ed ? '編輯交易' : verb + (txState.isBuy ? '買入' : '賣出'); }

    // 目前標的的市場：建議清單/既有標的 > 由輸入的代碼格式猜
    const marketSel = () => txState.picked ? U.normalizeMarketKey(txState.picked.market)
      : U.guessMarketBySymbol(U.sanitizeSymbol($('#tx-sym') ? $('#tx-sym').value : txState.symbol));
    // 依市場套用預設費率（台股 0.1425 / 美股 0.08 / 加密 0.1）；使用者自填的費率不動
    const applyDefaultFee = () => {
      if (txState.feeMode !== 'rate') return;
      const cur = $('#tx-fee').value;
      if (cur && !Object.values(FEE_RATE).includes(cur)) return;
      $('#tx-fee').value = defaultFeeRate(marketSel());
    };
    // 加密計價幣別（USD/台幣）：選台幣時儲存前依匯率換算為 USD
    txState.priceCur = 'USD';
    const isCryptoSel = () => ed
      ? U.normalizeMarketKey((S.metaMap()[ed.symbol] || {}).market) === U.Market.crypto
      : marketSel() === U.Market.crypto;
    function syncPriceCur() {
      const f = $('#price-cur-fld'); if (!f) return;
      const show = isCryptoSel();
      f.style.display = show ? 'block' : 'none';
      if (!show) {
        txState.priceCur = 'USD';
        ov.querySelectorAll('.pc-btn').forEach(x => x.classList.toggle('active', x.dataset.pc === 'USD'));
      }
    }
    ov.querySelectorAll('.pc-btn').forEach(b => b.addEventListener('click', () => {
      txState.priceCur = b.dataset.pc;
      ov.querySelectorAll('.pc-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      updatePreview();
    }));

    function updatePreview() {
      const sh = parseFloat($('#tx-shares').value) || 0;
      const pr = parseFloat($('#tx-price').value) || 0;
      const twdMode = isCryptoSel() && txState.priceCur === 'TWD';
      const fx = S.getFxRate() || 31.5;
      let fee = 0;
      if (txState.feeMode === 'rate') fee = sh * pr * ((parseFloat($('#tx-fee').value) || 0) / 100);
      else fee = parseFloat($('#tx-fee').value) || 0;
      if (sh > 0 && pr > 0) $('#tx-preview').innerHTML =
        `<div>${txState.isBuy ? '買入' : '賣出'}金額 <b>${twdMode ? 'NT$ ' : ''}${U.fmtKMBB(sh * pr)}</b></div>
         <div>預估手續費 <b>${U.formatPrice(fee)}</b></div>
         ${twdMode ? `<div>換算 <b>≈ $${U.formatPrice(pr / fx)} / 顆（匯率 ${fx.toFixed(3)}）</b></div>` : ''}`;
      else $('#tx-preview').innerHTML = '';
    }
    ov.querySelectorAll('.tt-btn').forEach(b => b.addEventListener('click', () => {
      txState.isBuy = b.dataset.buy === '1';
      ov.querySelectorAll('.tt-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); setTitle();
    }));
    // 僅費率/固定金額兩顆（[data-m]）：加密的 USD/台幣 計價鈕也是 .fm-btn，不能一起綁
    ov.querySelectorAll('.fm-btn[data-m]').forEach(b => b.addEventListener('click', () => {
      txState.feeMode = b.dataset.m;
      ov.querySelectorAll('.fm-btn[data-m]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (txState.feeMode === 'rate' && !$('#tx-fee').value) $('#tx-fee').value = defaultFeeRate(marketSel());
      updatePreview();
    }));
    ['#tx-shares', '#tx-price', '#tx-fee'].forEach(s => $(s).addEventListener('input', updatePreview));

    // 現金帳戶選項（依標的幣別過濾：台股=台幣、美股/加密=美金）
    function refreshAcctOptions() {
      const sel = $('#tx-acct'); if (!sel) return;
      const mk = marketSel();
      const wantCur = (mk === U.Market.us || mk === U.Market.crypto) ? 'USD' : 'TWD';
      const keep = sel.value;
      const opts = S.getCashAccounts().filter(a => a.currency === wantCur);
      sel.innerHTML = '<option value="">不使用現金帳戶</option>' +
        opts.map(a => `<option value="${a.id}">${esc(a.name)}（${a.currency} ${U.formatPrice(a.balance || 0)}）</option>`).join('');
      if (opts.some(a => a.id === keep)) sel.value = keep;
    }
    refreshAcctOptions(); syncPriceCur();
    if (pre && pre.accountId && $('#tx-acct') && [...$('#tx-acct').options].some(o => o.value === pre.accountId)) $('#tx-acct').value = pre.accountId;

    // 自動完成
    if (!ed) {
      const symInput = $('#tx-sym'), sug = $('#tx-suggest');
      let timer = null;
      symInput.addEventListener('input', () => {
        const q = symInput.value.trim();
        clearTimeout(timer);
        txState.picked = null; // 重新輸入即失效（先清掉，下面的市場推斷才不會沿用舊標的）
        if (!q) { sug.innerHTML = ''; return; }
        applyDefaultFee(); // 市場切換 → 自動更新預設費率
        refreshAcctOptions(); syncPriceCur();
        timer = setTimeout(async () => {
          const res = await App.Api.searchSymbols(q);
          sug.innerHTML = res.map(r => `<div class="sug-item" data-code="${esc(r.code)}" data-name="${encodeURIComponent(r.name)}" data-mk="${r.market}"${r.cgid ? ` data-cgid="${r.cgid}"` : ''}>
            <span class="sc">${esc(r.code)}</span><span class="sn">${esc(r.name)}</span><span class="sm">${U.marketLabel(r.market)}</span></div>`).join('');
          sug.querySelectorAll('.sug-item').forEach(it => it.addEventListener('click', () => {
            const name = decodeURIComponent(it.dataset.name);
            symInput.value = it.dataset.code + ' ' + name;
            sug.innerHTML = '';
            txState.picked = { code: it.dataset.code, name, market: it.dataset.mk };
            if (it.dataset.cgid) App.Api.cacheCgId(it.dataset.code, it.dataset.cgid);
            applyDefaultFee();
            refreshAcctOptions(); syncPriceCur();
            $('#tx-shares').focus();
          }));
        }, 220);
      });
    }
    updatePreview();

    $('#tx-cancel').addEventListener('click', () => { UI.closeSheet(); if (txOpts && txOpts.onCancel) txOpts.onCancel(); });
    if ($('#tx-skip')) $('#tx-skip').addEventListener('click', () => txOpts.onSkip());
    $('#tx-submit').addEventListener('click', () => {
      const sh = parseFloat($('#tx-shares').value);
      let pr = parseFloat($('#tx-price').value);
      const dateVal = $('#tx-date').value;
      // 新增：今天 → 當下時間（同日多筆維持輸入順序）；選了其他日期 → 那天中午。帶入的交易日期沒改 → 沿用原成交時間
      const time = !dateVal ? Date.now()
        : pre && dateVal === pre.date ? pre.time
        : !ed && dateVal === U.isoDate() ? Date.now()
        : new Date(dateVal + 'T12:00:00+08:00').getTime();
      // 加密以台幣計價 → 依匯率換算 USD 儲存（固定金額手續費同步換算）
      const twdMode = isCryptoSel() && txState.priceCur === 'TWD';
      const fx = S.getFxRate() || 31.5;
      if (twdMode && pr > 0) pr = pr / fx;
      let fee = 0;
      if (txState.feeMode === 'rate') fee = (sh || 0) * (pr || 0) * ((parseFloat($('#tx-fee').value) || 0) / 100);
      else { fee = parseFloat($('#tx-fee').value) || 0; if (twdMode) fee = fee / fx; }

      if (ed) {
        const res = C.updateTransaction(ed.id, { type: txState.isBuy ? 'BUY' : 'SELL', shares: sh, price: pr, fee, time });
        if (!res.ok) return UI.toast(res.msg, 'info');
        UI.closeSheet(); App.afterDataChange([res.symbol]);
      } else {
        const symbolInput = $('#tx-sym').value;
        // 從建議清單選取者，帶入明確市場與名稱（加密貨幣必要）
        const pk = (txState.picked && U.sanitizeSymbol(symbolInput) === txState.picked.code) ? txState.picked : null;
        const accountId = $('#tx-acct') ? ($('#tx-acct').value || undefined) : undefined;
        const res = C.addTransaction({ symbolInput, type: txState.isBuy ? 'BUY' : 'SELL', shares: sh, price: pr, fee, market: pk && pk.market, name: pk && pk.name, accountId,
          time, source: pre ? pre.source : undefined });
        if (!res.ok) return UI.toast(res.msg, 'info');
        if (txOpts && txOpts.onAdded) txOpts.onAdded(res.symbol); // 例：群組頁＋ → 自動歸入該群組
        UI.closeSheet(); App.afterDataChange([res.symbol]);
        if (txOpts && txOpts.after) txOpts.after(res.symbol, time);
      }
    });

    // 編輯模式提供刪除
    if (ed) {
      const foot = ov.querySelector('.sheet-foot');
      const del = document.createElement('button');
      del.className = 'btn btn-danger'; del.textContent = '刪除';
      del.addEventListener('click', () => UI.confirmDialog('確定刪除這筆交易？', () => {
        const sym = ed.symbol; const r = C.deleteTransaction(ed.id);
        if (!r.ok) return UI.toast(r.msg, 'error');
        UI.closeSheet(); App.afterDataChange([sym]);
      }, '刪除'));
      foot.insertBefore(del, foot.firstChild);
    }
  }
  // 交易表單預設手續費率 %：台股 0.1425、美股 0.08、加密 0.1（依標的市場帶入，使用者可改）
  const FEE_RATE = { tw: '0.1425', us: '0.08', crypto: '0.1' };
  function defaultFeeRate(market) {
    const mk = U.normalizeMarketKey(market);
    return FEE_RATE[mk === U.Market.us ? 'us' : mk === U.Market.crypto ? 'crypto' : 'tw'];
  }

  return { portfolio, history, report, assets, settings, openTxForm, resetAssetsNav, resetReportNav, resetPortfolioNav, resetSettingsNav, resetHistoryNav,
    // 共用元件（供 views-futures.js）
    seg, applyRange, autoGran, chartLabels, rangeControlHtml, bindRangeControl, yearControlHtml, bindYearControl, chartRange, openChooser, openMoneyForm, maskAmounts };
})();

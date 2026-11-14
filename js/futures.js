/* =========================================================================
 * futures.js — 台指期貨：部位重播、權益數／風險指標／槓桿、轉倉、外部資料解析（純運算，無 DOM）
 * 設計：docs/superpowers/specs/2026-09-17-futures-design.md
 * 保證金帳戶＝某個台幣現金帳戶（accountId）；平倉損益與費用自動加減，入出金用帳戶自己的快速增減
 * ======================================================================= */
window.App = window.App || {};

App.Futures = (function () {
  const S = App.Store;

  const MULT = { TX: 200, MTX: 50, TMF: 10 };           // 元／點
  const LABEL = { TX: '大台', MTX: '小台', TMF: '微台' };
  const CONTRACTS = ['TX', 'MTX', 'TMF'];
  const TAX_RATE = 0.00002;                               // 期交稅：契約值 × 十萬分之二（單邊）
  const DEFAULTS = {
    accountId: null,
    margin: { TX: { init: 701000, maint: 538000 }, MTX: { init: 175250, maint: 134500 }, TMF: { init: 35050, maint: 26900 } }, // 期交所 2026/08/12
    marginDate: '2026/08/12',
    marginAuto: true,
    feePerLot: { TX: 60, MTX: 30, TMF: 20 },
    alerts: { expiry: true, risk: true },
    trades: [],
  };
  const r2 = v => Math.round(v * 100) / 100;

  function priceKey(contract, month) { return 'FUT:' + contract + '@' + month; }
  function taxOf(contract, price, lots) { return r2((+price || 0) * (MULT[contract] || 0) * (+lots || 0) * TAX_RATE); }

  // 到期日：該月第三個星期三
  function expiryOf(month) {
    const y = +String(month).slice(0, 4), m = +String(month).slice(4, 6);
    const wd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0=Sun … 3=Wed
    const day = 1 + ((3 - wd + 7) % 7) + 14;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  // 自 fromIso 起尚未到期（到期日 ≥ fromIso）的 n 個月份
  function upcomingMonths(fromIso, n) {
    const out = [];
    let y = +fromIso.slice(0, 4), m = +fromIso.slice(5, 7);
    for (let g = 0; out.length < (n || 6) && g < 24; g++) {
      const mon = y + String(m).padStart(2, '0');
      if (expiryOf(mon) >= fromIso) out.push(mon);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  // ---- 狀態（預設值合併）----
  function getState() {
    const raw = S.getFutures() || {};
    const margin = {};
    for (const c of CONTRACTS) margin[c] = Object.assign({}, DEFAULTS.margin[c], (raw.margin || {})[c] || {});
    return {
      accountId: raw.accountId || null,
      margin,
      marginDate: raw.marginDate || DEFAULTS.marginDate,
      marginAuto: raw.marginAuto !== false,
      feePerLot: Object.assign({}, DEFAULTS.feePerLot, raw.feePerLot || {}),
      alerts: Object.assign({}, DEFAULTS.alerts, raw.alerts || {}),
      trades: Array.isArray(raw.trades) ? raw.trades : [],
      // 有日期的入出金紀錄 { id, time, amount(＋入金／−出金), src? }——由對帳單匯入；手動在帳戶上增減的不在這裡
      flows: Array.isArray(raw.flows) ? raw.flows : [],
    };
  }
  function saveState(st) { S.setFutures(st); }
  function patchState(patch) { const st = getState(); Object.assign(st, patch); saveState(st); return st; }

  // ---- 部位重播：以（合約, 月份）為單位，同方向開倉（均價加權）、反方向平倉（已實現）、超過口數反手 ----
  function replay(trades) {
    const sorted = [...(trades || [])].sort((a, b) => a.time - b.time);
    const st = {}, events = [];
    for (const t of sorted) {
      const key = t.contract + '@' + t.month;
      const p = st[key] || (st[key] = { contract: t.contract, month: t.month, netLots: 0, avgEntry: 0 });
      const dir = t.side === 'SELL' ? -1 : 1;
      const mult = MULT[t.contract] || 0;
      let lots = +t.lots || 0;
      if (p.netLots !== 0 && Math.sign(p.netLots) !== dir) {
        const posDir = Math.sign(p.netLots);
        const closed = Math.min(lots, Math.abs(p.netLots));
        events.push({ tradeId: t.id, contract: t.contract, month: t.month, lots: closed, price: t.price, avgEntry: p.avgEntry,
          realizedPnl: (t.price - p.avgEntry) * mult * closed * posDir, fee: t.fee || 0, tax: t.tax || 0, time: t.time, rollId: t.rollId || null });
        p.netLots -= closed * posDir;
        lots -= closed;
        if (p.netLots === 0) p.avgEntry = 0;
      }
      if (lots > 0) {
        const cur = Math.abs(p.netLots);
        p.avgEntry = cur > 0 ? (p.avgEntry * cur + t.price * lots) / (cur + lots) : t.price;
        p.netLots += lots * dir;
      }
    }
    const positions = Object.keys(st).map(k => Object.assign({ key: k, expiry: expiryOf(st[k].month) }, st[k]))
      .filter(p => p.netLots !== 0)
      .sort((a, b) => a.month !== b.month ? (a.month < b.month ? -1 : 1) : (a.contract < b.contract ? -1 : 1));
    return { positions, events };
  }

  // 當日損益（TWD）：逐合約月份模擬今天的交易。
  //   昨日留倉：以昨結算為基準 → 仍持有的用報價的 dailyChange，今日平掉的用（平倉價 − 昨結算）
  //   今日新開：以開倉價為基準 → 仍持有的用（現價 − 開倉均價），當沖平掉的用（平倉價 − 開倉均價）
  //   今日反向交易先平昨日留倉、再平今日新倉。沒有報價的月份，昨日留倉部分無從計算 → 0
  function dayPnlOf(trades, prices, todayIso) {
    const today = todayIso || App.Util.isoDate();
    const sorted = [...(trades || [])].sort((a, b) => a.time - b.time);
    const isToday = t => App.Util.isoDate(new Date(t.time)) === today;
    const old = {};
    for (const p of replay(sorted.filter(t => !isToday(t))).positions) old[p.key] = p.netLots;
    const st = {};
    const get = k => st[k] || (st[k] = { old: old[k] || 0, neu: 0, neuAvg: 0, pnl: 0 });
    for (const k in old) get(k);
    const quote = k => { const [c, m] = k.split('@'); return (prices || {})[priceKey(c, m)] || null; };
    // 昨結算：報價是今天的 → prevClose；報價還停在前一交易日（今天尚未更新）→ 該價本身就是昨結算
    const prevOf = q => !q ? null : (q.date && q.date < today) ? q.price : (q.prevClose != null ? q.prevClose : (q.price != null ? q.price - (q.dailyChange || 0) : null));
    for (const t of sorted) {
      if (!isToday(t)) continue;
      const k = t.contract + '@' + t.month, x = get(k), mult = MULT[t.contract] || 0, dir = t.side === 'SELL' ? -1 : 1;
      let lots = +t.lots || 0;
      if (x.old !== 0 && Math.sign(x.old) !== dir) {
        const c = Math.min(lots, Math.abs(x.old)), prev = prevOf(quote(k));
        if (prev != null) x.pnl += (t.price - prev) * mult * c * Math.sign(x.old);
        x.old -= c * Math.sign(x.old); lots -= c;
      }
      if (lots > 0 && x.neu !== 0 && Math.sign(x.neu) !== dir) {
        const c = Math.min(lots, Math.abs(x.neu));
        x.pnl += (t.price - x.neuAvg) * mult * c * Math.sign(x.neu);
        x.neu -= c * Math.sign(x.neu); lots -= c;
        if (x.neu === 0) x.neuAvg = 0;
      }
      if (lots > 0) {
        const cur = Math.abs(x.neu);
        x.neuAvg = cur > 0 ? (x.neuAvg * cur + t.price * lots) / (cur + lots) : t.price;
        x.neu += lots * dir;
      }
    }
    let total = 0;
    for (const k in st) {
      const x = st[k], q = quote(k), mult = MULT[k.split('@')[0]] || 0;
      if (q && q.price > 0) x.pnl += (q.dailyChange || 0) * mult * x.old + (q.price - x.neuAvg) * mult * x.neu;
      total += x.pnl;
    }
    return total;
  }

  function riskLevel(r) { return r == null ? null : r >= 1 ? 'safe' : r >= 0.5 ? 'warn' : 'danger'; }

  // 指標。state 空 → getState()；prices 為 S.getPrices() 格式
  // netWorthExFut = 不含期貨未平倉的淨資產、investTwd = 股票市值 → 整體曝險 = (股票市值 + 契約總值) ÷ 淨資產
  function summary(state, prices, netWorthExFut, investTwd) {
    const st = state || getState();
    const pr = prices || {};
    const margin = st.margin || DEFAULTS.margin;
    const { positions, events } = replay(st.trades);
    let unrealized = 0, initTotal = 0, maintTotal = 0, sens = 0, notional = 0;
    const dayPnl = dayPnlOf(st.trades, pr);   // 含今日平倉／轉倉
    const rows = positions.map(p => {
      const mult = MULT[p.contract] || 0;
      const q = pr[priceKey(p.contract, p.month)];
      const mark = q && q.price > 0 ? q.price : null;
      const unr = mark != null ? (mark - p.avgEntry) * mult * p.netLots : 0;
      const mk = margin[p.contract] || { init: 0, maint: 0 };
      const notl = Math.abs(p.netLots) * mult * (mark != null ? mark : p.avgEntry);
      unrealized += unr; initTotal += Math.abs(p.netLots) * mk.init; maintTotal += Math.abs(p.netLots) * mk.maint;
      sens += p.netLots * mult; notional += notl;
      return Object.assign({}, p, { mark, unrealized: unr, notional: notl, pts: mark != null ? (mark - p.avgEntry) * Math.sign(p.netLots) : null });
    });
    const acct = st.accountId ? S.getCashAccounts().find(a => a.id === st.accountId) : null;
    const balance = acct ? (acct.balance || 0) : 0;
    const equity = balance + unrealized;
    const fees = (st.trades || []).reduce((s, t) => s + (t.fee || 0) + (t.tax || 0), 0);
    const realizedGross = events.reduce((s, e) => s + e.realizedPnl, 0);
    const risk = initTotal > 0 ? equity / initTotal : null;
    const nw = netWorthExFut != null ? netWorthExFut + unrealized : null;
    return {
      positions: rows, events, balance, unrealized, equity, initTotal, maintTotal,
      risk, riskLevel: riskLevel(risk),
      callPts: sens ? (equity - maintTotal) / sens : null,
      liqPts: sens ? (equity - 0.25 * initTotal) / sens : null,
      sens, notional,
      accLev: equity > 0 && notional > 0 ? notional / equity : null,
      exposure: nw > 0 && (notional + (investTwd || 0)) > 0 ? (notional + (investTwd || 0)) / nw : null,
      dayPnl, fees, realizedGross, realizedNet: realizedGross - fees, cumulative: realizedGross - fees + unrealized,
      lots: rows.reduce((s, p) => s + Math.abs(p.netLots), 0), hasAccount: !!acct,
    };
  }

  // 紀錄列（新→舊）：同 rollId 的兩筆合併成一列轉倉
  function records(trades) {
    const list = trades || getState().trades;
    const evByTrade = {};
    for (const e of replay(list).events) evByTrade[e.tradeId] = e;
    const byRoll = {}, out = [];
    for (const t of [...list].sort((a, b) => b.time - a.time)) {
      const ev = evByTrade[t.id];
      if (t.rollId) {
        let g = byRoll[t.rollId];
        if (!g) { g = byRoll[t.rollId] = { kind: 'roll', rollId: t.rollId, contract: t.contract, time: t.time, trades: [], fees: 0, realized: 0, lots: 0 }; out.push(g); }
        g.trades.push(t); g.fees += (t.fee || 0) + (t.tax || 0); g.time = Math.min(g.time, t.time);
        if (ev) { g.from = t.month; g.closePrice = t.price; g.lots = ev.lots; g.realized += ev.realizedPnl; }
        else { g.to = t.month; g.openPrice = t.price; g.lots = g.lots || t.lots; }
        if (g.closePrice != null && g.openPrice != null) g.spread = g.openPrice - g.closePrice;
      } else {
        out.push({ kind: 'trade', trade: t, contract: t.contract, month: t.month, side: t.side, lots: t.lots, price: t.price, time: t.time,
          fees: (t.fee || 0) + (t.tax || 0), realized: ev ? ev.realizedPnl : null, closing: !!ev });
      }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  // ---- 交易（含保證金帳戶連動）----
  function validateTrade(t) {
    if (!MULT[t.contract]) return '請選擇合約';
    if (!/^\d{6}$/.test(String(t.month || ''))) return '月份格式須為 YYYYMM';
    if (!(t.lots > 0) || Math.round(t.lots) !== t.lots) return '口數須為正整數';
    if (!(t.price > 0)) return '請輸入成交價';
    return null;
  }
  function applyCash(st, delta) { if (st.accountId && delta) S.adjustCashBalance(st.accountId, r2(delta)); }
  // 重算每筆交易的現金效果（已實現 − 手續費 − 稅），回傳合計。
  //   改／刪／補登較早的交易會改變「之後」平倉的均價與已實現，所以不能只算被動到的那一筆：
  //   一律整批重播，並把合計的變化量套到保證金帳戶 → 餘額恆等於 入金 + 已實現淨額
  const cashSum = trades => trades.reduce((a, t) => a + (t.cash || 0), 0);
  function resyncCash(st, oldSum) {
    const ev = {};
    for (const e of replay(st.trades).events) ev[e.tradeId] = e.realizedPnl;
    for (const t of st.trades) t.cash = r2((ev[t.id] || 0) - (t.fee || 0) - (t.tax || 0));
    saveState(st);
    applyCash(st, cashSum(st.trades) - oldSum);
  }
  function realizedOf(trades, id) { const ev = replay(trades).events.find(e => e.tradeId === id); return ev ? ev.realizedPnl : 0; }

  // 新增交易：tax 未給則自動算；cash = 已實現 − 手續費 − 稅（有連結帳戶才套用）
  function addTrade({ contract, month, side, lots, price, fee, tax, time, rollId, note, src }) {
    const st = getState();
    const t = { id: S.uuid(), contract, month: String(month), side: side === 'SELL' ? 'SELL' : 'BUY', lots: +lots, price: +price,
      fee: r2(+fee || 0), tax: tax != null ? r2(+tax) : taxOf(contract, +price, +lots), time: time || Date.now() };
    if (rollId) t.rollId = rollId;
    if (note) t.note = note;
    if (src) t.src = src;
    const err = validateTrade(t); if (err) return { ok: false, msg: err };
    const oldSum = cashSum(st.trades);
    st.trades = [...st.trades, t];
    resyncCash(st, oldSum);
    return { ok: true, trade: t, realized: realizedOf(st.trades, t.id) };
  }
  // 入出金（有日期）：amount ＋入金／−出金。adjust=true → 同時加減保證金帳戶餘額；
  //   adjust=false → 只記錄日期（餘額已經手動調過，補記這筆是為了年化報酬與歷史餘額算得準）
  function addCashFlow({ amount, time, src, adjust }) {
    const st = getState();
    amount = r2(+amount || 0);
    if (!amount) return { ok: false, msg: '金額不可為 0' };
    if (!st.accountId || !S.getCashAccounts().some(a => a.id === st.accountId)) return { ok: false, msg: '尚未連結保證金帳戶（期貨 › 設定）' };
    const flow = { id: S.uuid(), time: time || Date.now(), amount };
    if (src) flow.src = src;
    st.flows = [...st.flows, flow];
    saveState(st);
    if (adjust !== false) S.adjustCashBalance(st.accountId, amount);
    return { ok: true, flow };
  }
  // 移除一筆入出金紀錄。adjust=true → 同時把保證金帳戶餘額沖回（當初新增時有動到餘額的才需要）
  function removeCashFlow(id, adjust) {
    const st = getState();
    const flow = st.flows.find(x => x.id === id); if (!flow) return { ok: false, msg: '找不到這筆入出金' };
    st.flows = st.flows.filter(x => x.id !== id);
    saveState(st);
    if (adjust && st.accountId && S.getCashAccounts().some(a => a.id === st.accountId)) S.adjustCashBalance(st.accountId, -flow.amount);
    return { ok: true };
  }
  // 期貨的資金流（供年化報酬）：{ time, amount }，投入為負、取回為正；最後一筆是目前權益數。
  //   紀錄以外的入金（手動調餘額）＝ 餘額 − 已實現淨額 − 有紀錄的入出金，當成第一筆交易那天投入。
  //   沒連結保證金帳戶 → 不知道本金，回傳 []
  function xirrFlows(prices, nowMs) {
    const st = getState();
    const acct = st.accountId ? S.getCashAccounts().find(a => a.id === st.accountId) : null;
    if (!acct || (!st.trades.length && !st.flows.length)) return [];
    const now = nowMs || Date.now();
    const sum = summary(st, prices || {}, null);
    const realizedNet = cashSum(st.trades.map(t => (t.cash != null ? t : Object.assign({}, t, { cash: 0 }))));
    const recorded = st.flows.reduce((a, x) => a + x.amount, 0);
    const implied = r2((acct.balance || 0) - realizedNet - recorded);
    const first = Math.min(now, ...st.trades.map(t => t.time), ...st.flows.map(x => x.time));
    const out = [];
    if (implied > 0.5) out.push({ time: first, amount: -implied });
    else if (implied < -0.5) out.push({ time: now, amount: -implied });   // 沒紀錄的出金：時間不明，算在現在
    for (const x of st.flows) out.push({ time: Math.min(x.time, now), amount: -x.amount });
    out.push({ time: now, amount: (acct.balance || 0) + (sum.unrealized || 0) });
    return out;
  }
  function deleteTrade(id) {
    const st = getState();
    const t = st.trades.find(x => x.id === id); if (!t) return { ok: false, msg: '找不到交易' };
    const oldSum = cashSum(st.trades);
    st.trades = st.trades.filter(x => x.id !== id);
    resyncCash(st, oldSum);
    return { ok: true };
  }
  // 更新：先沖回舊 cash，改完重播算新 cash 再套用；改價／口數／合約而未指定稅 → 重算稅
  function updateTrade(id, patch) {
    const st = getState();
    const t = st.trades.find(x => x.id === id); if (!t) return { ok: false, msg: '找不到交易' };
    patch = patch || {};
    const cand = Object.assign({}, t, patch);
    if (cand.lots != null) cand.lots = +cand.lots;
    if (cand.price != null) cand.price = +cand.price;
    if (cand.fee != null) cand.fee = r2(+cand.fee || 0);
    if (patch.tax == null && (patch.price != null || patch.lots != null || patch.contract)) cand.tax = taxOf(cand.contract, cand.price, cand.lots);
    else if (cand.tax != null) cand.tax = r2(+cand.tax);
    const err = validateTrade(cand); if (err) return { ok: false, msg: err };
    const oldSum = cashSum(st.trades);
    st.trades = st.trades.map(x => (x.id === id ? cand : x));
    resyncCash(st, oldSum);
    return { ok: true, trade: cand };
  }
  // 一鍵轉倉：先平近月（反方向）、再開遠月（同方向），兩筆共用 rollId
  function rollover({ contract, month, toMonth, lots, closePrice, openPrice, time, feePerLot }) {
    const st = getState();
    const pos = replay(st.trades).positions.find(p => p.contract === contract && p.month === String(month));
    if (!pos) return { ok: false, msg: '沒有這個部位' };
    lots = +lots;
    if (!(lots > 0) || lots > Math.abs(pos.netLots)) return { ok: false, msg: '口數超過持有（' + Math.abs(pos.netLots) + ' 口）' };
    if (!(String(toMonth) > String(month))) return { ok: false, msg: '轉倉月份須晚於目前月份' };
    if (!(closePrice > 0) || !(openPrice > 0)) return { ok: false, msg: '請輸入平倉價與新倉價' };
    const fpl = feePerLot != null ? +feePerLot : (st.feePerLot[contract] || 0);
    const rollId = S.uuid(), dir = pos.netLots > 0 ? 1 : -1, ts = time || Date.now();
    const c = addTrade({ contract, month, side: dir > 0 ? 'SELL' : 'BUY', lots, price: +closePrice, fee: fpl * lots, time: ts, rollId });
    if (!c.ok) return c;
    const o = addTrade({ contract, month: toMonth, side: dir > 0 ? 'BUY' : 'SELL', lots, price: +openPrice, fee: fpl * lots, time: ts + 1, rollId });
    if (!o.ok) { deleteTrade(c.trade.id); return o; }
    return { ok: true, rollId, closeTrade: c.trade, openTrade: o.trade, realized: c.realized, spread: +openPrice - +closePrice };
  }

  // ---- 外部資料解析（純函式，供 api.js 與測試）----
  // 期交所「股價指數類保證金一覽表」：HTML <tr>（首欄 臺股期貨／小型臺指／微型臺指，欄序 結算／維持／原始）
  // 或 r.jina.ai 轉出的 markdown 表格列「| 臺股期貨 | 519,000 | 538,000 | 701,000 |」；另抓「更新日期：YYYY/MM/DD」
  function parseTaifexMargins(html) {
    if (!html) return null;
    const strip = x => String(x).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const num = x => { const v = parseFloat(String(x).replace(/,/g, '')); return isFinite(v) && v > 0 ? v : null; };
    const NAME = { '臺股期貨': 'TX', '小型臺指': 'MTX', '小型臺指期貨': 'MTX', '微型臺指': 'TMF', '微型臺指期貨': 'TMF' };
    const margin = {};
    const rows = [];
    for (const r of (html.match(/<tr[\s\S]*?<\/tr>/gi) || [])) rows.push((r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(strip));
    for (const line of html.split('\n')) { const l = line.trim(); if (l.startsWith('|')) rows.push(l.split('|').slice(1, -1).map(c => c.trim())); }
    for (const cells of rows) {
      if (cells.length < 4) continue;
      const key = NAME[cells[0]];
      if (!key || margin[key]) continue;                 // 「客製化小型臺指期貨」等不在 NAME 內
      const maint = num(cells[2]), init = num(cells[3]);
      if (maint && init && init >= maint) margin[key] = { init, maint };
    }
    if (!margin.TX) return null;
    const dm = strip(html).match(/更新日期[:：]\s*(\d{4}\/\d{2}\/\d{2})/);
    return { margin, date: dm ? dm[1] : null };
  }
  // FinMind TaiwanFuturesDaily rows → 指定月份、日盤（trading_session=position）、結算價優先，升冪 [{date, close}]
  function parseFuturesDaily(rows, month) {
    const out = [];
    for (const r of (rows || [])) {
      if (String(r.contract_date) !== String(month)) continue;
      if (r.trading_session && r.trading_session !== 'position') continue;
      const px = (+r.settlement_price > 0) ? +r.settlement_price : +r.close;
      if (!(px > 0)) continue;
      out.push({ date: r.date, close: px });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  }

  // Yahoo 期貨總表（經 r.jina.ai 的 markdown）→ { TX: { YYYYMM: {price, prevClose} }, MTX: {...} }
  // 每檔一個區塊：名稱行（台指期2610 / 小型台指2610）、代碼行，接著 12 個欄位：
  //   成交, 買進, 賣出, 漲跌, 漲跌%, 量, 開盤, 最高, 最低, 振幅, 參考價(昨結算), 未平倉 → 再一行時間
  // 漲跌以「成交 − 參考價」自算（不依賴頁面上的正負號）；"近一/近二" 連續合約略過
  const YAHOO_NAME = { '台指期': 'TX', '小型台指': 'MTX' };
  function parseYahooFutures(md) {
    const out = { TX: {}, MTX: {} };
    const lines = String(md || '').split('\n').map(x => x.trim()).filter(Boolean);
    const num = v => { const x = parseFloat(String(v).replace(/,/g, '')); return isFinite(x) && x > 0 ? x : null; };
    for (let i = 0; i < lines.length; i++) {
      const m = /^(台指期|小型台指)(\d{4})$/.exec(lines[i]);
      if (!m) continue;
      const f = lines.slice(i + 2, i + 14);      // 跳過代碼行
      if (f.length < 12) continue;
      const price = num(f[0]), prevClose = num(f[10]);
      if (price == null) continue;               // 尚無成交
      out[YAHOO_NAME[m[1]]]['20' + m[2]] = { price, prevClose };
    }
    return out;
  }
  // 某合約月份的盤中報價；微台（Yahoo 無各月份）用同月份小台、再退大台；大小台缺一時互補（同一個加權指數，價差僅數點）
  function realtimeQuote(parsed, contract, month) {
    const pick = c => parsed && parsed[c] && parsed[c][month];
    const q = contract === 'TX' ? (pick('TX') || pick('MTX')) : (pick('MTX') || pick('TX'));
    if (!q) return null;
    return { price: q.price, dailyChange: q.prevClose != null ? q.price - q.prevClose : 0, prevClose: q.prevClose };
  }

  return { addCashFlow, removeCashFlow, xirrFlows, parseYahooFutures, realtimeQuote, dayPnlOf, MULT, LABEL, CONTRACTS, TAX_RATE, DEFAULTS, priceKey, taxOf, expiryOf, upcomingMonths, getState, saveState, patchState, replay, riskLevel, summary, records,
    addTrade, deleteTrade, updateTrade, rollover, parseTaifexMargins, parseFuturesDaily };
})();

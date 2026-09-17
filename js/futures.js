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

  function riskLevel(r) { return r == null ? null : r >= 1 ? 'safe' : r >= 0.5 ? 'warn' : 'danger'; }

  // 指標。state 空 → getState()；prices 為 S.getPrices() 格式；netWorthExFut = 不含期貨未平倉的淨資產（算整體曝險）
  function summary(state, prices, netWorthExFut) {
    const st = state || getState();
    const pr = prices || {};
    const margin = st.margin || DEFAULTS.margin;
    const { positions, events } = replay(st.trades);
    let unrealized = 0, initTotal = 0, maintTotal = 0, sens = 0, notional = 0, dayPnl = 0;
    const rows = positions.map(p => {
      const mult = MULT[p.contract] || 0;
      const q = pr[priceKey(p.contract, p.month)];
      const mark = q && q.price > 0 ? q.price : null;
      const unr = mark != null ? (mark - p.avgEntry) * mult * p.netLots : 0;
      const mk = margin[p.contract] || { init: 0, maint: 0 };
      const notl = Math.abs(p.netLots) * mult * (mark != null ? mark : p.avgEntry);
      unrealized += unr; initTotal += Math.abs(p.netLots) * mk.init; maintTotal += Math.abs(p.netLots) * mk.maint;
      sens += p.netLots * mult; notional += notl;
      dayPnl += (q && q.dailyChange ? q.dailyChange : 0) * mult * p.netLots;
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
      exposure: nw > 0 && notional > 0 ? notional / nw : null,
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

  return { MULT, LABEL, CONTRACTS, TAX_RATE, DEFAULTS, priceKey, taxOf, expiryOf, upcomingMonths, getState, saveState, patchState, replay, riskLevel, summary, records };
})();

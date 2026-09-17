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

  return { MULT, LABEL, CONTRACTS, TAX_RATE, DEFAULTS, priceKey, taxOf, expiryOf, upcomingMonths, getState, saveState, patchState, replay };
})();

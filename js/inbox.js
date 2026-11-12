/* =========================================================================
 * inbox.js — 待確認交易（券商對帳單由排程整理 → 使用者審核後才入帳）
 *
 * 來源：同一個同步 Gist 裡的獨立檔 dives-inbox.json（由排程腳本寫入，App 只讀不寫）：
 *   { app:'dives-inbox', version:1, updatedAt:ms, items:[ ... ] }
 *   股票：{ id, broker, kind:'stock', date:'YYYY-MM-DD', time?:'HH:MM[:SS]', symbol, name?, market?, side:'BUY'|'SELL',
 *           shares, price, fee?, tax?, source? }
 *   期貨：{ id, broker, kind:'fut',   date, time?, contract:'TX'|'MTX'|'TMF', month:'YYYYMM', side, lots, price,
 *           fee?(整筆合計), tax?(省略則依合約自動算), source? }
 *   id 由腳本產生、同一筆交易永遠相同（App 以它記住「已匯入／已略過」）；date/time 為台灣時間。
 *
 * App 端狀態：
 *   dives_inbox       本機快取（每次同步由 Gist 覆蓋）
 *   dives_inbox_done  { id: [狀態 'i'=已匯入|'s'=已略過, 時間ms] }（跟著主資料同步 → 別台裝置不會再問一次）
 *   dives_inbox_cfg   { acct: { 券商: 現金帳戶 id } }（各券商預設扣款／入款帳戶）
 * ======================================================================= */
window.App = window.App || {};

App.Inbox = (function () {
  const S = App.Store, U = App.Util;
  const FILENAME = 'dives-inbox.json';
  // 券商：[顯示名稱, 類別, 現金帳戶幣別（期貨走保證金帳戶 → null）]
  const BROKERS = {
    cathay: ['國泰', '美股', 'USD'],
    firstrade: ['Firstrade', '美股', 'USD'],
    yuanta: ['元大證券', '台股', 'TWD'],
    'yuanta-fut': ['元大期貨', '台指期', null],
  };
  const DAY = 86400000;
  const brokerName = b => (BROKERS[b] ? BROKERS[b][0] : String(b || '其他'));
  const brokerLabel = b => (BROKERS[b] ? BROKERS[b][0] + ' · ' + BROKERS[b][1] : String(b || '其他'));

  // ---- 檢查並整理單筆（格式不對 → null，整筆丟掉，不猜）----
  function normItem(x, i) {
    if (!x || typeof x !== 'object') return null;
    const id = String(x.id == null ? '' : x.id).trim();
    const date = String(x.date || '');
    const side = x.side === 'BUY' || x.side === 'SELL' ? x.side : null;
    const price = +x.price;
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !side || !(price > 0)) return null;
    const it = { id, broker: String(x.broker || 'other'), date, side, price, fee: Math.max(0, +x.fee || 0), source: x.source ? String(x.source) : '', ord: i };
    if (typeof x.time === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(x.time)) it.time = x.time;
    if (x.kind === 'fut') {
      const contract = String(x.contract || '').toUpperCase(), month = String(x.month || ''), lots = +x.lots;
      if (!App.Futures || !App.Futures.LABEL[contract] || !/^\d{6}$/.test(month) || !(lots > 0) || Math.round(lots) !== lots) return null;
      return Object.assign(it, { kind: 'fut', contract, month, lots, tax: x.tax != null && +x.tax >= 0 ? +x.tax : null });
    }
    const symbol = U.sanitizeSymbol(String(x.symbol || '')), shares = +x.shares;
    if (!symbol || !(shares > 0)) return null;
    const mk = x.market ? U.normalizeMarketKey(String(x.market)) : '';
    return Object.assign(it, { kind: 'stock', symbol, shares, name: x.name ? String(x.name) : '', market: mk && mk !== U.Market.unknown ? mk : '', tax: Math.max(0, +x.tax || 0) });
  }

  // Gist 檔內容 → 本機快取；回傳內容是否有變。json 為 null（Gist 裡沒有這個檔）→ 不動
  function setFromRemote(json) {
    if (!json || typeof json !== 'object') return false;
    const items = [], seen = new Set();
    (Array.isArray(json.items) ? json.items : []).forEach((x, i) => {
      const it = normItem(x, i);
      if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
    });
    const next = { updatedAt: +json.updatedAt || 0, items };
    if (JSON.stringify(S.getInbox()) === JSON.stringify(next)) return false;
    S.setInbox(next);
    pruneDone();
    return true;
  }

  // 已處理紀錄只留「還在收件匣裡的」或 200 天內的（腳本會把舊交易移出收件匣，紀錄不必永遠留著）
  function pruneDone(now) {
    const done = S.getInboxDone(), ids = new Set(S.getInbox().items.map(x => x.id));
    const limit = (now || Date.now()) - 200 * DAY;
    let changed = false;
    for (const id of Object.keys(done)) {
      const t = Array.isArray(done[id]) ? done[id][1] : 0;
      if (!ids.has(id) && !(t > limit)) { delete done[id]; changed = true; }
    }
    if (changed) S.setInboxDone(done);
  }

  function itemTime(it) {
    if (it.time) return new Date(it.date + 'T' + (it.time.length === 5 ? it.time + ':00' : it.time) + '+08:00').getTime();
    return new Date(it.date + 'T12:00:00+08:00').getTime() + (it.ord || 0) * 1000;   // 沒有時間 → 當天中午，同日依檔案順序
  }
  const byTime = (a, b) => itemTime(a) - itemTime(b) || a.ord - b.ord;

  // 還沒處理的（依時間新→舊）
  function pending() {
    const done = S.getInboxDone();
    return S.getInbox().items.filter(it => !done[it.id]).sort((a, b) => byTime(b, a));
  }
  function pendingCount() { return pending().length; }
  // 各券商筆數：[[券商, 筆數], ...]（依筆數多→少）
  function pendingByBroker() {
    const m = {};
    for (const it of pending()) m[it.broker] = (m[it.broker] || 0) + 1;
    return Object.keys(m).map(b => [b, m[b]]).sort((a, b) => b[1] - a[1]);
  }

  function markDone(ids, status) {
    const done = S.getInboxDone(), now = Date.now();
    for (const id of ids) done[id] = [status, now];
    S.setInboxDone(done);
  }
  function skip(ids) { markDone(ids, 's'); }

  // 是否和既有紀錄相同（多半是已經手動輸入過）：同標的、同方向、同數量、同價格，日期相差 3 天內
  //   日期放寬是因為手動輸入的日期常是「記帳那天」而不是成交日；結果只用來預設不勾選，仍可手動勾選匯入
  function isDuplicate(it) {
    const t0 = itemTime(it), near = t => Math.abs(t - t0) <= 3.5 * DAY;
    const samePrice = p => Math.abs(p - it.price) <= Math.max(0.005, it.price * 1e-4);
    if (it.kind === 'fut') {
      const trades = App.Futures ? App.Futures.getState().trades : [];
      return trades.some(t => t.contract === it.contract && String(t.month) === it.month && t.side === it.side && t.lots === it.lots && samePrice(t.price) && near(t.time));
    }
    return S.getTransactions().some(t => t.symbol === it.symbol && t.type === it.side && Math.abs(t.shares - it.shares) < 1e-6 && samePrice(t.price) && near(t.time));
  }

  // 匯入一筆：股票 → 交易紀錄；期貨 → 期貨帳。成功才記為已匯入
  function importItem(it, opts) {
    opts = opts || {};
    let res;
    if (it.kind === 'fut') {
      res = App.Futures.addTrade({ contract: it.contract, month: it.month, side: it.side, lots: it.lots, price: it.price, fee: it.fee,
        tax: it.tax != null ? it.tax : undefined, time: itemTime(it) });
    } else {
      res = App.Calc.addTransaction({ symbolInput: it.symbol, type: it.side, shares: it.shares, price: it.price, fee: it.fee + (it.tax || 0),
        market: it.market || undefined, name: it.name || undefined, accountId: opts.accountId || undefined, time: itemTime(it), source: 'inbox:' + it.broker });
    }
    if (res.ok) markDone([it.id], 'i');
    return res;
  }

  // 批次匯入（依成交時間舊→新，賣出才不會因順序而被擋）。acctOf(broker) → 現金帳戶 id
  //   回傳 { ok: 成功筆數, failed: [{ id, msg }], symbols: [要刷新報價的代號], backdated: 是否有今天以前的交易 }
  function importMany(items, acctOf) {
    const out = { ok: 0, failed: [], symbols: [], backdated: false };
    const today = U.isoDate();
    for (const it of items.slice().sort(byTime)) {
      const res = importItem(it, { accountId: it.kind === 'stock' && acctOf ? acctOf(it.broker) : undefined });
      if (!res.ok) { out.failed.push({ id: it.id, msg: res.msg || '匯入失敗' }); continue; }
      out.ok++;
      if (it.kind === 'stock' && !out.symbols.includes(it.symbol)) out.symbols.push(it.symbol);
      if (it.date < today) out.backdated = true;
    }
    return out;
  }

  // 各券商預設現金帳戶（帳戶已刪除 → 視為未設定）
  function accountFor(broker) {
    const id = (S.getInboxCfg().acct || {})[broker];
    return id && S.getCashAccounts().some(a => a.id === id) ? id : '';
  }
  function setAccountFor(broker, id) {
    const cfg = S.getInboxCfg(); cfg.acct = cfg.acct || {};
    if (id) cfg.acct[broker] = id; else delete cfg.acct[broker];
    S.setInboxCfg(cfg);
  }
  // 該券商可選的現金帳戶幣別：已知券商照表；未知券商看交易的市場
  function currencyFor(broker, sampleItem) {
    if (BROKERS[broker]) return BROKERS[broker][2];
    if (!sampleItem || sampleItem.kind === 'fut') return null;
    const mk = sampleItem.market || U.guessMarketBySymbol(sampleItem.symbol);
    return mk === U.Market.us || mk === U.Market.crypto ? 'USD' : 'TWD';
  }

  return { FILENAME, BROKERS, brokerName, brokerLabel, normItem, setFromRemote, pruneDone, itemTime, pending, pendingCount, pendingByBroker,
    markDone, skip, isDuplicate, importItem, importMany, accountFor, setAccountFor, currencyFor };
})();

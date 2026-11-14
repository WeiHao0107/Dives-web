/* =========================================================================
 * inbox.js — 待確認交易（券商對帳單由排程整理 → 使用者審核後才入帳）
 *
 * 來源：同一個同步 Gist 裡的獨立檔 dives-inbox.json（由排程腳本寫入，App 只讀不寫）：
 *   { app:'dives-inbox', version:1, updatedAt:ms, items:[ ... ] }
 *   股票：{ id, broker, kind:'stock', date:'YYYY-MM-DD', time?:'HH:MM[:SS]', symbol, name?, market?, side:'BUY'|'SELL',
 *           shares, price, fee?, tax?, feeEst?(費用是估算值：對帳單沒有列費用), source? }
 *   期貨：{ id, broker, kind:'fut',   date, time?, contract:'TX'|'MTX'|'TMF', month:'YYYYMM', side, lots, price,
 *           fee?(整筆合計), tax?(省略則依合約自動算), source? }
 *   期貨入出金：{ id, broker, kind:'fut-cash', date, type:'DEPOSIT'|'WITHDRAW', amount, source? }
 *   另有 balances:[{ broker, date, balance }]＝各券商最新一份對帳單的帳戶餘額（只供核對，不會自動改餘額）
 *   id 由腳本產生、同一筆交易永遠相同（App 以它記住「已匯入／已略過」）；date/time 為台灣時間。
 *
 * App 端狀態：
 *   dives_inbox       本機快取（每次同步由 Gist 覆蓋）
 *   dives_inbox_done  { id: [狀態, 時間ms, 對應紀錄的 id?] }（跟著主資料同步 → 別台裝置不會再問一次）
 *                     狀態：'i'=新增了一筆紀錄、'f'=校正了既有的手動紀錄、's'=略過。
 *                     對應紀錄 id（交易／期貨交易／入出金）讓「已處理」清單能再打開那筆紀錄來修改；
 *                     舊版處理的沒有這個 id → 用來源標記＋內容找回來（links）。
 *   已處理的項目只要還在收件匣裡（排程每次重抓最近 60 天）就會列在「已處理」，可再修改或取消匯入（undo）。
 *
 * 和既有紀錄相同的項目（多半是之前手動輸入的）：確認時不會再新增一筆，而是「校正」那筆既有紀錄
 *   ——把日期與手續費改成對帳單上的值（手動輸入的日期常是記帳那天、不是成交日）。
 *   費用是估算值（feeEst）時只校正日期：手動輸入的費用比估算可靠，不覆蓋。
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
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const base = { id, broker: String(x.broker || 'other'), date, source: x.source ? String(x.source) : '', ord: i };
    if (typeof x.time === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(x.time)) base.time = x.time;
    if (x.kind === 'fut-cash') {
      const amount = +x.amount, type = x.type === 'DEPOSIT' || x.type === 'WITHDRAW' ? x.type : null;
      if (!type || !(amount > 0)) return null;
      return Object.assign(base, { kind: 'fut-cash', type, amount });
    }
    const side = x.side === 'BUY' || x.side === 'SELL' ? x.side : null;
    const price = +x.price;
    if (!side || !(price > 0)) return null;
    const it = Object.assign(base, { side, price, fee: Math.max(0, +x.fee || 0) });
    if (x.kind === 'fut') {
      const contract = String(x.contract || '').toUpperCase(), month = String(x.month || ''), lots = +x.lots;
      if (!App.Futures || !App.Futures.LABEL[contract] || !/^\d{6}$/.test(month) || !(lots > 0) || Math.round(lots) !== lots) return null;
      return Object.assign(it, { kind: 'fut', contract, month, lots, tax: x.tax != null && +x.tax >= 0 ? +x.tax : null });
    }
    const symbol = U.sanitizeSymbol(String(x.symbol || '')), shares = +x.shares;
    if (!symbol || !(shares > 0)) return null;
    const mk = x.market ? U.normalizeMarketKey(String(x.market)) : '';
    return Object.assign(it, { kind: 'stock', symbol, shares, name: x.name ? String(x.name) : '', market: mk && mk !== U.Market.unknown ? mk : '', tax: Math.max(0, +x.tax || 0), feeEst: x.feeEst === true });
  }

  // Gist 檔內容 → 本機快取；回傳內容是否有變。json 為 null（Gist 裡沒有這個檔）→ 不動
  function setFromRemote(json) {
    if (!json || typeof json !== 'object') return false;
    const items = [], seen = new Set();
    (Array.isArray(json.items) ? json.items : []).forEach((x, i) => {
      const it = normItem(x, i);
      if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
    });
    const balances = (Array.isArray(json.balances) ? json.balances : [])
      .filter(b => b && b.broker && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) && isFinite(+b.balance))
      .map(b => ({ broker: String(b.broker), date: String(b.date), balance: +b.balance }));
    const next = { updatedAt: +json.updatedAt || 0, items, balances };
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

  function markDone(ids, status, ref) {
    const done = S.getInboxDone(), now = Date.now();
    for (const id of ids) done[id] = ref ? [status, now, ref] : [status, now];
    S.setInboxDone(done);
  }
  // 已處理的（還在收件匣裡的；依成交時間新→舊）
  function processed() {
    const done = S.getInboxDone();
    return S.getInbox().items.filter(it => done[it.id]).sort((a, b) => byTime(b, a));
  }
  function processedCount() { return processed().length; }
  // 某筆的處理狀態：{ status:'i'|'f'|'s', at:處理時間ms, ref? }；還沒處理 → null
  function doneOf(it) {
    const d = S.getInboxDone()[it.id];
    return Array.isArray(d) ? { status: d[0], at: +d[1] || 0, ref: d[2] || null } : null;
  }
  // 最近一次處理的時間（ms；沒有 → 0）
  function lastDoneAt() { return processed().reduce((m, it) => Math.max(m, doneOf(it).at), 0); }

  // 已處理項目 → 它在帳上對應的那筆紀錄：{ 項目 id: { kind:'tx'|'fut'|'flow', rec } }。已略過、或紀錄已被刪除 → 沒有。
  //   有記下紀錄 id 的直接找；舊版處理的沒有 id → 找「由對帳單匯入（有來源標記）、同標的／方向／數量／價格、同一天」的那筆
  //   （一筆紀錄只配一個項目；匯入後改過內容的舊紀錄找不回來，會顯示成「紀錄已刪除」）
  function links() {
    const done = S.getInboxDone(), out = {}, used = new Set();
    const txs = S.getTransactions(), st = App.Futures ? App.Futures.getState() : { trades: [], flows: [] };
    const live = processed().filter(it => done[it.id][0] !== 's');
    for (const it of live) {
      const ref = done[it.id][2]; if (!ref) continue;
      const kind = it.kind === 'fut-cash' ? 'flow' : it.kind === 'fut' ? 'fut' : 'tx';
      const rec = (kind === 'flow' ? st.flows : kind === 'fut' ? st.trades : txs).find(x => x.id === ref);
      if (rec) { used.add(rec.id); out[it.id] = { kind, rec }; }
    }
    for (const it of live.slice().sort(byTime)) {
      if (done[it.id][2]) continue;
      const sameDay = t => U.isoDate(new Date(t)) === it.date;
      const samePrice = p => Math.abs(p - it.price) <= Math.max(0.005, it.price * 1e-4);
      let kind, rec;
      if (it.kind === 'fut-cash') {
        const amt = it.type === 'DEPOSIT' ? it.amount : -it.amount;
        kind = 'flow'; rec = st.flows.find(x => !used.has(x.id) && x.src && Math.abs(x.amount - amt) < 0.005 && sameDay(x.time));
      } else if (it.kind === 'fut') {
        kind = 'fut'; rec = st.trades.find(t => !used.has(t.id) && t.src && t.contract === it.contract && String(t.month) === it.month && t.side === it.side && t.lots === it.lots && samePrice(t.price) && sameDay(t.time));
      } else {
        kind = 'tx'; rec = txs.find(t => !used.has(t.id) && t.source && String(t.source).startsWith('inbox:') && t.symbol === it.symbol && t.type === it.side && Math.abs(t.shares - it.shares) < 1e-6 && samePrice(t.price) && sameDay(t.time));
      }
      if (rec) { used.add(rec.id); out[it.id] = { kind, rec }; }
    }
    return out;
  }
  // 匯入後那筆紀錄被改過（日期、方向、數量或價格和對帳單不同；費用不算——估算的費用本來就會被改成實際值）
  function edited(it, link) {
    if (!link) return false;
    const r = link.rec, day = U.isoDate(new Date(r.time)) !== it.date;
    if (link.kind === 'flow') return day || Math.abs(Math.abs(r.amount) - it.amount) > 0.005;
    const price = Math.abs(r.price - it.price) > Math.max(0.005, it.price * 1e-4);
    if (link.kind === 'fut') return day || price || r.lots !== it.lots || r.side !== it.side || r.contract !== it.contract || String(r.month) !== it.month;
    return day || price || Math.abs(r.shares - it.shares) > 1e-6 || r.type !== it.side;
  }

  // 取消處理：把項目放回待確認。
  //   已略過 → 只拿掉處理紀錄；
  //   新增的（'i'）→ 連同那筆紀錄一起刪掉（現金帳戶／保證金沖回）；刪不掉（例如會讓之後的賣出超賣）→ 不動，回報原因；
  //   校正既有紀錄的（'f'）→ 那筆是原本手動輸入的，保留不刪，只拿掉來源標記（放回待確認後仍會被認成「已輸入」）。
  //   回傳 { ok, symbol?(股票代號), removed(有沒有刪掉紀錄), kept(紀錄保留) , msg? }
  function undo(it) {
    const d = doneOf(it);
    if (!d) return { ok: false, msg: '這筆還沒處理' };
    const link = d.status === 's' ? null : links()[it.id];
    const keep = d.status === 'f';
    let symbol = null;
    if (link) {
      let r = { ok: true };
      if (link.kind === 'tx') {
        symbol = link.rec.symbol;
        if (keep) { const txs = S.getTransactions(), t = txs.find(x => x.id === link.rec.id); if (t) { delete t.source; S.setTransactions(txs); } }
        else r = App.Calc.deleteTransaction(link.rec.id);
      } else if (link.kind === 'fut') {
        r = keep ? App.Futures.updateTrade(link.rec.id, { src: undefined }) : App.Futures.deleteTrade(link.rec.id);
      } else {
        r = App.Futures.removeCashFlow(link.rec.id, !keep);
      }
      if (!r.ok) return r;
    }
    const done = S.getInboxDone(); delete done[it.id]; S.setInboxDone(done);
    return { ok: true, symbol, removed: !!link && !keep, kept: !!link && keep };
  }
  function skip(ids) { markDone(ids, 's'); }

  // 期貨對帳單餘額核對：{ date, statement(對帳單餘額), dives(保證金帳戶目前餘額), diff }；沒有資料或沒連結帳戶 → null
  function balanceCheck(broker) {
    const b = S.getInbox().balances.filter(x => x.broker === broker).sort((x, y) => x.date < y.date ? 1 : -1)[0];
    if (!b || !App.Futures) return null;
    const st = App.Futures.getState();
    const acct = st.accountId ? S.getCashAccounts().find(a => a.id === st.accountId) : null;
    if (!acct) return null;
    return { date: b.date, statement: b.balance, dives: acct.balance || 0, diff: (acct.balance || 0) - b.balance };
  }

  // 把待確認項目和「既有的手動紀錄」配對：{ 項目 id: { kind:'tx'|'fut'|'bal', id? } }
  //   股票／期貨：同標的、同方向、同數量、同價格，日期相差 3 天內（手動輸入的日期常是記帳那天而不是成交日）；
  //     一筆既有紀錄只配一個項目；已經由對帳單匯入或校正過的（有 inbox 來源標記）不再配對。
  //   入出金：保證金帳戶餘額已經和對帳單相符 → 這筆入出金應該手動調過了（kind:'bal'，確認時只補記日期、不動餘額）。
  function matchExisting(items) {
    const out = {}, used = new Set();
    const txs = S.getTransactions().filter(t => !(t.source && String(t.source).startsWith('inbox:')));
    const trades = App.Futures ? App.Futures.getState().trades.filter(t => !t.src) : [];
    const balOk = {};
    for (const it of (items || []).slice().sort(byTime)) {
      const t0 = itemTime(it), near = t => Math.abs(t - t0) <= 3.5 * DAY;
      if (it.kind === 'fut-cash') {
        if (!(it.broker in balOk)) { const c = balanceCheck(it.broker); balOk[it.broker] = !!c && Math.abs(c.diff) < 1 && c.date >= it.date; }
        if (balOk[it.broker]) out[it.id] = { kind: 'bal' };
        continue;
      }
      const samePrice = p => Math.abs(p - it.price) <= Math.max(0.005, it.price * 1e-4);
      if (it.kind === 'fut') {
        const m = trades.find(t => !used.has(t.id) && t.contract === it.contract && String(t.month) === it.month && t.side === it.side && t.lots === it.lots && samePrice(t.price) && near(t.time));
        if (m) { used.add(m.id); out[it.id] = { kind: 'fut', id: m.id }; }
      } else {
        const m = txs.find(t => !used.has(t.id) && t.symbol === it.symbol && t.type === it.side && Math.abs(t.shares - it.shares) < 1e-6 && samePrice(t.price) && near(t.time));
        if (m) { used.add(m.id); out[it.id] = { kind: 'tx', id: m.id }; }
      }
    }
    return out;
  }
  function isDuplicate(it) { return !!matchExisting([it])[it.id]; }

  // 確認一筆。沒有配對 → 新增（股票進交易紀錄、期貨進期貨帳、入出金加減保證金帳戶並記錄日期）；
  //   有配對（opts.match）→ 校正既有紀錄的日期與費用，不新增。成功才記為已處理。回傳 { ok, fixed?, msg? }
  function importItem(it, opts) {
    opts = opts || {};
    const m = opts.match || null, src = 'inbox:' + it.broker;
    let res;
    if (it.kind === 'fut-cash') {
      res = App.Futures.addCashFlow({ amount: it.type === 'DEPOSIT' ? it.amount : -it.amount, time: itemTime(it), src, adjust: !m });
    } else if (it.kind === 'fut') {
      res = m && m.kind === 'fut'
        ? App.Futures.updateTrade(m.id, Object.assign({ fee: it.fee, time: itemTime(it), src }, it.tax != null ? { tax: it.tax } : {}))
        : App.Futures.addTrade({ contract: it.contract, month: it.month, side: it.side, lots: it.lots, price: it.price, fee: it.fee,
          tax: it.tax != null ? it.tax : undefined, time: itemTime(it), src });
    } else if (m && m.kind === 'tx') {
      const old = S.getTransactions().find(t => t.id === m.id);
      if (!old) return { ok: false, msg: '找不到要校正的那筆紀錄' };
      // 對帳單沒有列費用（feeEst）→ 保留原本手動輸入的費用，只校正日期
      res = App.Calc.updateTransaction(m.id, { type: old.type, shares: old.shares, price: old.price, fee: it.feeEst ? (old.fee || 0) : it.fee + (it.tax || 0), time: itemTime(it) });
      if (res.ok) { const txs = S.getTransactions(); const t = txs.find(x => x.id === m.id); if (t) { t.source = src; S.setTransactions(txs); } }
    } else {
      res = App.Calc.addTransaction({ symbolInput: it.symbol, type: it.side, shares: it.shares, price: it.price, fee: it.fee + (it.tax || 0),
        market: it.market || undefined, name: it.name || undefined, accountId: opts.accountId || undefined, time: itemTime(it), source: src });
    }
    if (res.ok) {
      // 記下對應的紀錄（之後在「已處理」可以再打開來修改、或取消匯入）
      const ref = it.kind === 'fut-cash' ? res.flow && res.flow.id : it.kind === 'fut' ? res.trade && res.trade.id : m && m.kind === 'tx' ? m.id : res.id;
      markDone([it.id], m ? 'f' : 'i', ref);
      return Object.assign({}, res, { fixed: !!m });
    }
    return res;
  }

  // 批次確認（依成交時間舊→新，賣出才不會因順序而被擋）。acctOf(broker) → 現金帳戶 id；matches＝matchExisting 的結果
  //   回傳 { ok: 新增筆數, fixed: 校正筆數, failed: [{ id, msg }], symbols: [要刷新報價的代號], backdated: 是否動到今天以前的日子 }
  function importMany(items, acctOf, matches) {
    const out = { ok: 0, fixed: 0, failed: [], symbols: [], backdated: false };
    const today = U.isoDate();
    matches = matches || {};
    for (const it of items.slice().sort(byTime)) {
      const res = importItem(it, { accountId: it.kind === 'stock' && acctOf ? acctOf(it.broker) : undefined, match: matches[it.id] });
      if (!res.ok) { out.failed.push({ id: it.id, msg: res.msg || '匯入失敗' }); continue; }
      if (res.fixed) out.fixed++; else out.ok++;
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
    if (!sampleItem || sampleItem.kind !== 'stock') return null;
    const mk = sampleItem.market || U.guessMarketBySymbol(sampleItem.symbol);
    return mk === U.Market.us || mk === U.Market.crypto ? 'USD' : 'TWD';
  }

  return { FILENAME, BROKERS, brokerName, brokerLabel, normItem, setFromRemote, pruneDone, itemTime, pending, pendingCount, pendingByBroker,
    markDone, skip, processed, processedCount, doneOf, lastDoneAt, links, edited, undo, isDuplicate, matchExisting, balanceCheck, importItem, importMany, accountFor, setAccountFor, currencyFor };
})();

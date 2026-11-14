/* 待確認交易：收件匣格式檢查、待處理清單、重複偵測、匯入（股票／期貨）、略過、紀錄清理 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const I = App.Inbox, S = App.Store, C = App.Calc, F = App.Futures, U = App.Util;
beforeEach(() => resetStore());
const T = (iso, hm) => Date.parse(iso + 'T' + (hm || '12:00') + ':00+08:00');

const stock = (o) => Object.assign({ id: 'c1', broker: 'cathay', kind: 'stock', date: '2026-11-11', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', market: 'us', side: 'BUY', shares: 2, price: 707.32, fee: 1.13 }, o);
const fut = (o) => Object.assign({ id: 'f1', broker: 'yuanta-fut', kind: 'fut', date: '2026-11-06', contract: 'TX', month: '202611', side: 'BUY', lots: 1, price: 27650, fee: 50, tax: 111 }, o);
const feed = items => I.setFromRemote({ app: 'dives-inbox', version: 1, updatedAt: 1, items });

test('格式檢查：不合格的整筆丟掉；重複 id 只留第一筆；內容沒變 → 回傳 false', () => {
  const ok = feed([
    stock(), fut(),
    stock({ id: 'c1', shares: 99 }),                 // id 重複
    stock({ id: 'bad1', price: 0 }), stock({ id: 'bad2', date: '2026/11/11' }), stock({ id: 'bad3', side: 'buy' }),
    stock({ id: 'bad4', shares: -1 }), stock({ id: '', symbol: 'QQQ' }),
    fut({ id: 'bad5', contract: 'XX' }), fut({ id: 'bad6', month: '2611' }), fut({ id: 'bad7', lots: 1.5 }),
    null, 'x',
  ]);
  assert.equal(ok, true);
  assert.deepEqual(S.getInbox().items.map(x => x.id), ['c1', 'f1']);
  assert.equal(S.getInbox().items[0].shares, 2);
  assert.equal(feed([stock(), fut()]), false);        // 同樣內容（壞資料被丟掉後）→ 沒變
  assert.equal(I.setFromRemote(null), false);         // Gist 沒有這個檔 → 不動
  assert.equal(I.pendingCount(), 2);
});

test('待處理清單：新→舊排序、各券商筆數；略過後不再出現', () => {
  feed([stock({ id: 'a', date: '2026-11-10' }), stock({ id: 'b', date: '2026-11-11' }), stock({ id: 'c', date: '2026-11-11', symbol: 'QQQ' }), fut()]);
  assert.deepEqual(I.pending().map(x => x.id), ['c', 'b', 'a', 'f1']);   // 同日依檔案順序，後面的較新
  assert.deepEqual(I.pendingByBroker(), [['cathay', 3], ['yuanta-fut', 1]]);
  I.skip(['a', 'f1']);
  assert.deepEqual(I.pending().map(x => x.id), ['c', 'b']);
  assert.equal(S.getInboxDone().a[0], 's');
});

test('匯入股票：寫進交易紀錄（日期＝成交日、手續費含稅、來源標記）、扣現金帳戶、記為已匯入', () => {
  S.setCashAccounts([{ id: 'usd', name: '國泰美金', currency: 'USD', balance: 5000 }]);
  feed([stock({ tax: 0.5 })]);
  const r = I.importItem(I.pending()[0], { accountId: 'usd' });
  assert.equal(r.ok, true);
  const tx = S.getTransactions()[0];
  assert.deepEqual([tx.symbol, tx.type, tx.shares, tx.price, tx.fee, tx.source, tx.accountId], ['VOO', 'BUY', 2, 707.32, 1.63, 'inbox:cathay', 'usd']);
  assert.equal(U.isoDate(new Date(tx.time)), '2026-11-11');
  assert.equal(S.metaMap().VOO.market, 'us');
  assert.equal(S.getCashAccounts()[0].balance, Math.round((5000 - 2 * 707.32 - 1.63) * 100) / 100);
  assert.equal(I.pendingCount(), 0);
  assert.equal(S.getInboxDone().c1[0], 'i');
});

test('匯入期貨：寫進期貨帳；沒給稅 → 依合約自動算', () => {
  feed([fut(), fut({ id: 'f2', side: 'SELL', price: 27820, tax: undefined, time: '13:10' })]);
  const r = I.importMany(I.pending(), null);
  assert.deepEqual([r.ok, r.failed.length], [2, 0]);
  const tr = F.getState().trades.slice().sort((a, b) => a.time - b.time);
  assert.deepEqual(tr.map(t => [t.contract, t.month, t.side, t.lots, t.price, t.fee]), [['TX', '202611', 'BUY', 1, 27650, 50], ['TX', '202611', 'SELL', 1, 27820, 50]]);
  assert.equal(tr[0].tax, 111);
  assert.equal(tr[1].tax, F.taxOf('TX', 27820, 1));
  assert.equal(tr[1].time, T('2026-11-06', '13:10'));
  assert.equal(I.pendingCount(), 0);
});

test('批次匯入依成交時間舊→新；失敗的留在待確認並回報原因', () => {
  // 檔案順序是「賣在前、買在後」，但買的日期較早 → 依時間排序後賣出才不會超賣
  feed([stock({ id: 's', side: 'SELL', date: '2026-11-11', shares: 2 }), stock({ id: 'b', side: 'BUY', date: '2026-11-10', shares: 2 }),
    stock({ id: 'x', side: 'SELL', date: '2026-11-11', symbol: 'QQQ', shares: 5 })]);   // 沒有 QQQ 持股 → 失敗
  const r = I.importMany(I.pending(), () => undefined);
  assert.equal(r.ok, 2);
  assert.deepEqual(r.failed.map(f => f.id), ['x']);
  assert.ok(r.failed[0].msg);
  assert.deepEqual(r.symbols, ['VOO']);
  assert.equal(r.backdated, true);
  assert.deepEqual(I.pending().map(x => x.id), ['x']);
  assert.equal(S.getTransactions().length, 2);
});

test('重複偵測：同標的／方向／數量／價格且日期相差 3 天內 → 視為已輸入', () => {
  C.addTransaction({ symbolInput: 'VOO', type: 'BUY', shares: 2, price: 707.32, fee: 1, market: 'us', time: T('2026-11-12', '09:30') });   // 隔天才手動記帳
  F.addTrade({ contract: 'TX', month: '202611', side: 'BUY', lots: 1, price: 27650, fee: 50, time: T('2026-11-06') });
  feed([stock(), stock({ id: 'c2', price: 707.5 }), stock({ id: 'c3', shares: 3 }), stock({ id: 'c4', date: '2026-11-01' }), fut(), fut({ id: 'f2', lots: 2 })]);
  const dup = {}; for (const it of S.getInbox().items) dup[it.id] = I.isDuplicate(it);
  assert.deepEqual(dup, { c1: true, c2: false, c3: false, c4: false, f1: true, f2: false });
});

test('各券商預設現金帳戶：記住選擇；帳戶被刪除 → 視為未設定；幣別依券商', () => {
  S.setCashAccounts([{ id: 'usd', name: '國泰美金', currency: 'USD', balance: 0 }]);
  I.setAccountFor('cathay', 'usd');
  assert.equal(I.accountFor('cathay'), 'usd');
  S.setCashAccounts([]);
  assert.equal(I.accountFor('cathay'), '');
  assert.equal(I.currencyFor('cathay'), 'USD');
  assert.equal(I.currencyFor('yuanta-fut'), null);
  assert.equal(I.currencyFor('other', { kind: 'stock', symbol: '2330', market: '' }), 'TWD');
  assert.equal(I.brokerLabel('cathay'), '國泰 · 美股');
  assert.equal(I.brokerLabel('abc'), 'abc');
});

test('處理紀錄清理：還在收件匣裡的、或 200 天內的保留，其餘刪除', () => {
  const now = Date.now(), DAY = 86400000;
  feed([stock({ id: 'keep-in-inbox' })]);
  S.setInboxDone({ 'keep-in-inbox': ['i', now - 300 * DAY], recent: ['s', now - 10 * DAY], old: ['i', now - 300 * DAY] });
  I.pruneDone(now);
  assert.deepEqual(Object.keys(S.getInboxDone()).sort(), ['keep-in-inbox', 'recent']);
});

test('處理紀錄與設定會跟著主資料同步；收件匣快取不會', () => {
  feed([stock()]); I.skip(['c1']); I.setAccountFor('cathay', 'usd');
  const data = App.Sync.getData();
  assert.ok(data.dives_inbox_done && data.dives_inbox_cfg);
  assert.equal(data.dives_inbox, undefined);
});

// ── 已處理清單：留著、可再修改、可取消匯入 ──
const cashIt = o => Object.assign({ id: 'k1', broker: 'yuanta-fut', kind: 'fut-cash', date: '2026-11-06', type: 'DEPOSIT', amount: 50000 }, o);

test('已處理清單：處理過的項目留著（新→舊），記下對應的紀錄；匯入後改過內容 → 標示已改', () => {
  feed([stock({ id: 'a', date: '2026-11-10' }), stock({ id: 'b', date: '2026-11-11', symbol: 'QQQ' }), stock({ id: 'c', date: '2026-11-12', symbol: 'SPY' }), fut()]);
  const byId = id => S.getInbox().items.find(x => x.id === id);
  assert.equal(I.importItem(byId('a')).ok, true);
  assert.equal(I.importItem(byId('f1')).ok, true);
  I.skip(['b']);
  assert.deepEqual(I.processed().map(x => x.id), ['b', 'a', 'f1']);
  assert.deepEqual([I.processedCount(), I.pendingCount()], [3, 1]);
  assert.ok(I.lastDoneAt() > 0);
  const tx = S.getTransactions()[0], tr = F.getState().trades[0];
  assert.deepEqual([I.doneOf(byId('a')).status, I.doneOf(byId('a')).ref], ['i', tx.id]);
  assert.deepEqual([I.doneOf(byId('f1')).status, I.doneOf(byId('f1')).ref], ['i', tr.id]);
  assert.deepEqual([I.doneOf(byId('b')).status, I.doneOf(byId('c'))], ['s', null]);
  const l = I.links();
  assert.deepEqual(Object.keys(l).sort(), ['a', 'f1']);              // 略過的沒有對應紀錄
  assert.deepEqual([l.a.kind, l.a.rec.id, l.f1.kind, l.f1.rec.id], ['tx', tx.id, 'fut', tr.id]);
  assert.equal(I.edited(byId('a'), l.a), false);
  C.updateTransaction(tx.id, { type: 'BUY', shares: 2, price: 707.32, fee: 9.99, time: tx.time });   // 只改費用 → 不算改過
  assert.equal(I.edited(byId('a'), I.links().a), false);
  C.updateTransaction(tx.id, { type: 'BUY', shares: 3, price: 707.32, fee: 9.99, time: tx.time });
  assert.equal(I.edited(byId('a'), I.links().a), true);
  C.deleteTransaction(tx.id);                                        // 紀錄被刪掉 → 找不到對應
  assert.equal(I.links().a, undefined);
});

test('取消匯入（新增的那種）：刪掉那筆紀錄、現金帳戶沖回、放回待確認', () => {
  S.setCashAccounts([{ id: 'usd', name: '國泰美金', currency: 'USD', balance: 5000 }]);
  feed([stock()]);
  const it = I.pending()[0];
  I.importItem(it, { accountId: 'usd' });
  assert.equal(S.getTransactions().length, 1);
  const r = I.undo(it);
  assert.deepEqual([r.ok, r.symbol, r.removed, r.kept], [true, 'VOO', true, false]);
  assert.equal(S.getTransactions().length, 0);
  assert.equal(S.getCashAccounts()[0].balance, 5000);
  assert.deepEqual([I.pendingCount(), I.processedCount()], [1, 0]);
  assert.equal(I.undo(it).ok, false);                                // 已經不在已處理裡
});

test('取消匯入（校正既有紀錄的那種）：手動輸入的紀錄保留，只拿掉來源標記；放回待確認後仍被認成已輸入', () => {
  C.addTransaction({ symbolInput: 'VOO', type: 'BUY', shares: 2, price: 707.32, fee: 2, market: 'us', time: T('2026-11-12') });
  feed([stock()]);
  const it = I.pending()[0];
  const r0 = I.importItem(it, { match: I.matchExisting([it])[it.id] });
  assert.deepEqual([r0.ok, r0.fixed], [true, true]);
  const id = S.getTransactions()[0].id;
  assert.deepEqual([I.doneOf(it).status, I.doneOf(it).ref, S.getTransactions()[0].source], ['f', id, 'inbox:cathay']);
  const r = I.undo(it);
  assert.deepEqual([r.ok, r.removed, r.kept], [true, false, true]);
  assert.equal(S.getTransactions().length, 1);
  assert.equal(S.getTransactions()[0].source, undefined);
  assert.equal(I.pendingCount(), 1);
  assert.equal(I.isDuplicate(it), true);                             // 再確認一次也只會校正，不會重複入帳
});

test('取消匯入：會讓之後的賣出超賣 → 不動、回報原因', () => {
  feed([stock({ id: 'buy', date: '2026-11-10' }), stock({ id: 'sell', date: '2026-11-11', side: 'SELL' })]);
  const r = I.importMany(I.pending(), null);
  assert.equal(r.ok, 2);
  const buy = S.getInbox().items.find(x => x.id === 'buy');
  const u = I.undo(buy);
  assert.equal(u.ok, false);
  assert.match(u.msg, /無法刪除/);
  assert.deepEqual([S.getTransactions().length, I.pendingCount(), I.doneOf(buy).status], [2, 0, 'i']);
});

test('取消匯入：已略過的只放回待確認；期貨交易刪除；入出金把保證金扣回', () => {
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 100000 }]);
  F.patchState({ accountId: 'm' });
  feed([stock(), fut(), cashIt()]);
  const byId = id => S.getInbox().items.find(x => x.id === id);
  I.skip(['c1']);
  assert.deepEqual([I.undo(byId('c1')).ok, I.pendingCount()], [true, 3]);
  I.importMany([byId('f1'), byId('k1')], null);
  const after = S.getCashAccounts()[0].balance;
  assert.equal(after, 100000 + 50000 - 50 - 111);                    // 入金 +50000、期貨手續費與稅
  assert.equal(I.doneOf(byId('k1')).ref, F.getState().flows[0].id);
  assert.deepEqual([I.undo(byId('k1')).removed, F.getState().flows.length, S.getCashAccounts()[0].balance], [true, 0, after - 50000]);
  assert.deepEqual([I.undo(byId('f1')).removed, F.getState().trades.length, S.getCashAccounts()[0].balance], [true, 0, 100000]);
  assert.equal(I.pendingCount(), 3);
});

test('舊版的處理紀錄沒有記下紀錄 id → 用來源標記與內容找回對應的那筆', () => {
  feed([stock(), stock({ id: 'c2' }), fut()]);                        // c1、c2 內容完全相同
  const items = S.getInbox().items;
  I.importMany(items, null);
  const done = S.getInboxDone();
  Object.keys(done).forEach(k => { done[k] = done[k].slice(0, 2); }); // 模擬舊版：只有 [狀態, 時間]
  S.setInboxDone(done);
  const l = I.links();
  assert.deepEqual(Object.keys(l).sort(), ['c1', 'c2', 'f1']);
  assert.notEqual(l.c1.rec.id, l.c2.rec.id);                         // 一筆紀錄只配一個項目
  assert.equal(l.f1.rec.id, F.getState().trades[0].id);
  C.addTransaction({ symbolInput: 'VOO', type: 'BUY', shares: 2, price: 707.32, fee: 1, market: 'us', time: T('2026-11-11') });   // 手動輸入的（沒有來源標記）不會被認走
  assert.deepEqual(Object.keys(I.links()).sort(), ['c1', 'c2', 'f1']);
  assert.equal(I.undo(items[0]).removed, true);
  assert.equal(S.getTransactions().length, 2);
});

test('removeCashFlow：移除入出金紀錄；adjust → 餘額沖回；找不到 → 失敗', () => {
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 500 }]);
  F.patchState({ accountId: 'm' });
  const a = F.addCashFlow({ amount: 1000, time: T('2026-11-06') }).flow, b = F.addCashFlow({ amount: -200, time: T('2026-11-07'), adjust: false }).flow;
  assert.equal(F.removeCashFlow(b.id, false).ok, true);
  assert.equal(S.getCashAccounts()[0].balance, 1500);
  assert.equal(F.removeCashFlow(a.id, true).ok, true);
  assert.deepEqual([S.getCashAccounts()[0].balance, F.getState().flows.length], [500, 0]);
  assert.equal(F.removeCashFlow('nope', true).ok, false);
});

/* 2026-10 review 修正：CSV 部分匯入不清資料、交易帳戶連結/期貨快照備份、刪除防超賣 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, Csv = App.Csv;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');

test('CSV 只有設定分段 → 不清交易／快照', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  S.setSnapshots([{ date: '2026-01-05', netWorth: 1 }]);
  const r = Csv.importCsv('# SETTINGS\nKey,Value\ndayMode,twday\n');
  assert.equal(r.ok, true);
  assert.equal(S.getTransactions().length, 1);
  assert.equal(S.getSnapshots().length, 1);
  assert.equal(S.getDayMode(), 'twday');
});

test('CSV 有交易分段但沒有快照分段 → 換交易、保留快照', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  S.setSnapshots([{ date: '2026-01-05', netWorth: 1 }]);
  Csv.importCsv('# TRANSACTIONS\nSymbol,Market,Type,Shares,Price,Fee,Time\n0050,tse,BUY,10,100,0,1700000000000\n');
  assert.deepEqual(S.getTransactions().map(t => t.symbol), ['0050']);
  assert.equal(S.getSnapshots().length, 1);
});

test('交易的現金帳戶連結：匯出→匯入依名稱重連，刪除仍會沖回現金', () => {
  S.setCashAccounts([{ id: 'old', name: '台幣', currency: 'TWD', balance: 100000 }]);
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05'), accountId: 'old' });
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const acct = S.getCashAccounts()[0];
  const tx = S.getTransactions()[0];
  assert.equal(tx.accountId, acct.id);
  assert.equal(acct.balance, 50000);
  C.deleteTransaction(tx.id);
  assert.equal(S.getCashAccounts()[0].balance, 100000);
});

test('快照期貨欄位進出 CSV', () => {
  S.setSnapshots([{ date: '2026-09-01', marketValue: 1, netWorth: 5, futUnrealizedTwd: 100, futRealizedPnl: -20, futNotionalTwd: 9000, futEquityTwd: 800, futDayPnl: 7 }]);
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const s = S.getSnapshots()[0];
  assert.deepEqual([s.futUnrealizedTwd, s.futRealizedPnl, s.futNotionalTwd, s.futEquityTwd, s.futDayPnl], [100, -20, 9000, 800, 7]);
});

test('刪除買入會讓後面的賣出超賣 → 擋下，不產生假獲利', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 600, fee: 0, market: 'tse', time: T('2026-02-05') });
  const buy = S.getTransactions().find(t => t.type === 'BUY');
  const r = C.deleteTransaction(buy.id);
  assert.equal(r.ok, false);
  assert.match(r.msg, /賣出/);
  assert.equal(S.getTransactions().length, 2);
  // 刪賣出本身沒問題
  const sell = S.getTransactions().find(t => t.type === 'SELL');
  assert.equal(C.deleteTransaction(sell.id).ok, true);
});

test('U.esc 跳脫 HTML 特殊字元', () => {
  assert.equal(App.Util.esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(App.Util.esc(null), '');
});

test('store 寫入失敗回傳 false、不丟例外', () => {
  const orig = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try { assert.doesNotThrow(() => S.setTransactions([{ id: 'x' }])); }
  finally { localStorage.setItem = orig; }
});

/* 已實現損益一致性：回填日期的賣出、同日多筆賣出、賣出不得超過「當時」持倉。
 * 背景：addTransaction 原本用「全部交易」的均價算已實現，與 recomputeRealized 的
 * 時間序重播結果不同（一編輯就變）；且賣出日期早於買入也會被接受，重播後
 * 全數賣價變成純獲利、持股卻沒減少。 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store;

beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');
const pnls = () => S.getRealized().map(r => r.realizedPnl);

test('回填日期的賣出：已實現損益以「賣出當時」均價計，與重播結果一致', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 100, fee: 0, market: 'tse', time: T('2026-01-01') });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 200, fee: 0, market: 'tse', time: T('2026-03-01') });
  const r = C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 150, fee: 0, market: 'tse', time: T('2026-02-01') });
  assert.equal(r.ok, true);
  assert.deepEqual(pnls(), [5000]);          // 2/1 當時均價 100 → (150−100)×100
  C.recomputeRealized('2330');
  assert.deepEqual(pnls(), [5000]);          // 編輯後重播不會改變
  const pos = C.buildPositions().find(p => p.symbol === '2330');
  assert.equal(pos.shares, 100);
  assert.equal(pos.avgCost, 200);            // 剩下的是 3/1 那批
});

test('賣出日期早於持有（當時無持股） → 拒絕，不寫入交易與已實現', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 100, fee: 0, market: 'tse', time: T('2026-03-01') });
  const r = C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 150, fee: 0, market: 'tse', time: T('2026-01-01') });
  assert.equal(r.ok, false);
  assert.equal(S.getTransactions().length, 1);
  assert.equal(S.getRealized().length, 0);
});

test('插入的賣出讓「後面」的賣出超賣 → 拒絕', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 100, fee: 0, market: 'tse', time: T('2026-01-01') });
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 120, fee: 0, market: 'tse', time: T('2026-03-01') });
  // 2/1 再賣 50 → 3/1 只剩 50 可賣，超賣 → 拒絕
  const r = C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 50, price: 110, fee: 0, market: 'tse', time: T('2026-02-01') });
  assert.equal(r.ok, false);
  assert.equal(S.getTransactions().length, 2);
  assert.deepEqual(pnls(), [2000]);
});

test('現金帳戶：被拒絕的賣出不得動到帳戶餘額', () => {
  S.setCashAccounts([{ id: 'a1', name: '台幣', currency: 'TWD', balance: 1000 }]);
  const r = C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 10, price: 100, fee: 0, market: 'tse', accountId: 'a1', time: T('2026-01-01') });
  assert.equal(r.ok, false);
  assert.equal(S.getCashAccounts()[0].balance, 1000);
});

test('編輯交易：改成超賣（把買入改為賣出 / 日期提前到持股前） → 拒絕且資料不變', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 100, fee: 0, market: 'tse', time: T('2026-01-01') });
  const sell = C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 120, fee: 0, market: 'tse', time: T('2026-03-01') });
  assert.equal(sell.ok, true);
  const sellTx = S.getTransactions().find(t => t.type === 'SELL');
  const r = C.updateTransaction(sellTx.id, { type: 'SELL', shares: 100, price: 120, fee: 0, time: T('2025-12-01') });
  assert.equal(r.ok, false);
  assert.equal(S.getTransactions().find(t => t.id === sellTx.id).time, T('2026-03-01')); // 未改動
  assert.deepEqual(pnls(), [2000]);
});

test('realizedByTxId：同一檔同一天兩筆賣出各自對到自己的已實現（不重複計）', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 200, price: 100, fee: 0, market: 'tse', time: T('2026-01-01') });
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 110, fee: 0, market: 'tse', time: T('2026-02-01') }); // +1000
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 130, fee: 0, market: 'tse', time: T('2026-02-01') }); // +3000
  const map = C.realizedByTxId();
  const sells = S.getTransactions().filter(t => t.type === 'SELL');
  assert.equal(sells.length, 2);
  const got = sells.map(t => map[t.id] && map[t.id].realizedPnl).sort((a, b) => a - b);
  assert.deepEqual(got, [1000, 3000]);
  assert.equal(got[0] + got[1], S.getRealized().reduce((s, r) => s + r.realizedPnl, 0));
});

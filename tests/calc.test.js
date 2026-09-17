/* calc.js — 損益/彙總/現金沖銷。SPEC §4 / I1 / I2 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store;

beforeEach(() => resetStore());

test('txCashDelta：買入為負(含手續費)、賣出為正(扣手續費) (SPEC I2)', () => {
  assert.equal(C.txCashDelta({ type: 'BUY', shares: 10, price: 100, fee: 5 }), -1005);
  assert.equal(C.txCashDelta({ type: 'SELL', shares: 10, price: 100, fee: 5 }), 995);
  assert.equal(C.txCashDelta({ type: 'BUY', shares: 3, price: 50, fee: 0 }), -150);
});

test('assetsSummary：netWorth = 現金 − 負債（無持倉）；USD × 匯率 (SPEC I1)', () => {
  S.setFxRate(30);
  S.setCashAccounts([
    { id: S.uuid(), name: '台幣', currency: 'TWD', balance: 100000 },
    { id: S.uuid(), name: '美金', currency: 'USD', balance: 1000 }, // ×30 = 30000
  ]);
  S.setLiabilities([{ id: S.uuid(), name: '信貸', currency: 'TWD', balance: 50000 }]);
  const sum = C.assetsSummary();
  assert.equal(sum.cashTwd, 130000);
  assert.equal(sum.liabTwd, 50000);
  assert.equal(sum.investTwd, 0);
  assert.equal(sum.netWorth, 80000); // 130000 + 0 − 50000
});

test('buildPositions：兩筆買入 → 加權平均成本；賣出減股數', () => {
  S.setFxRate(30);
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', name: '台積電' });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 600, fee: 0, market: 'tse', name: '台積電' });
  let pos = C.buildPositions().find(p => p.symbol === '2330');
  assert.equal(pos.shares, 200);
  assert.equal(Math.round(pos.avgCost), 550); // (100*500 + 100*600) / 200

  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 50, price: 700, fee: 0, market: 'tse', name: '台積電' });
  pos = C.buildPositions().find(p => p.symbol === '2330');
  assert.equal(pos.shares, 150);
});

test('adjustCashBalance：餘額存到小數 2 位，不累積浮點誤差', () => {
  S.setCashAccounts([{ id: 'a', name: 'x', currency: 'TWD', balance: 2655534.07 }]);
  S.adjustCashBalance('a', -245.99);                       // 直接相加會得到 2655288.0799999996
  assert.equal(S.getCashAccounts()[0].balance, 2655288.08);
  S.setCashAccounts([{ id: 'b', name: 'y', currency: 'TWD', balance: 0 }]);
  for (const d of [2150000, 471020, 219600, -1341.34, 35122, -246.63]) S.adjustCashBalance('b', d);
  assert.equal(S.getCashAccounts()[0].balance, 2874154.03);  // 不是 2874154.0300000003
});

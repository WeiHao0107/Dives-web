/* 持股分布：個股（前 8 + 其他）/ 市場 / 群組；分母＝股票市值（TWD），不含期貨 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');
const buy = (sym, shares, price, market) => C.addTransaction({ symbolInput: sym, type: 'BUY', shares, price, fee: 0, market, time: T('2026-01-05') });

test('個股：依市值排序，美股換成台幣，pct 加總 100', () => {
  S.setFxRate(30);
  buy('2330', 100, 500, 'tse'); buy('AAPL', 10, 200, 'us'); buy('0050', 100, 100, 'tse');
  S.setPrices({ '2330': { price: 600 }, 'AAPL': { price: 300 }, '0050': { price: 100 } });
  const a = C.allocation('symbol');
  assert.equal(a.total, 60000 + 90000 + 10000);
  assert.deepEqual(a.slices.map(s => [s.key, s.value]), [['AAPL', 90000], ['2330', 60000], ['0050', 10000]]);
  assert.ok(Math.abs(a.slices.reduce((x, s) => x + s.pct, 0) - 100) < 1e-9);
  assert.equal(a.marketCount, 2);
});

test('個股超過 8 檔 → 前 8 + 「其他」合併，帶檔數', () => {
  for (let i = 0; i < 11; i++) buy('10' + String(i).padStart(2, '0'), 100, 10 + i, 'tse');
  const a = C.allocation('symbol');
  assert.equal(a.slices.length, 9);
  const other = a.slices[8];
  assert.equal(other.other, true);
  assert.equal(other.count, 3);
  assert.equal(other.value, (10 + 11 + 12) * 100);  // 最小的 3 檔
  assert.equal(a.count, 11);
});

test('市場：台股（含上櫃）/ 美股 / 加密 合併', () => {
  S.setFxRate(30);
  buy('2330', 100, 500, 'tse'); buy('6488', 10, 500, 'otc'); buy('AAPL', 10, 100, 'us');
  const a = C.allocation('market');
  assert.deepEqual(a.slices.map(s => [s.key, s.value, s.count]), [['tw', 55000, 2], ['us', 30000, 1]]);
});

test('群組：依群組加總，未分組歸「獨立持股」；groupCount 為有持股的群組數', () => {
  buy('2330', 100, 500, 'tse'); buy('0050', 100, 100, 'tse'); buy('2881', 100, 50, 'tse');
  S.setGroups([{ id: 'g1', name: '核心' }, { id: 'g2', name: '空群組' }]);
  S.setGroupMap({ '2330': 'g1', '0050': 'g1' });
  const a = C.allocation('group');
  assert.deepEqual(a.slices.map(s => [s.key, s.label, s.value]), [['g1', '核心', 60000], ['_none', '獨立持股', 5000]]);
  assert.equal(a.groupCount, 1);
});

test('不含期貨；沒有持倉 → 空', () => {
  S.setFutures({ trades: [{ id: 'f', contract: 'TX', month: '202610', side: 'BUY', lots: 1, price: 40000, fee: 0, tax: 0, time: T('2026-08-20') }] });
  const a = C.allocation('symbol');
  assert.equal(a.total, 0);
  assert.deepEqual(a.slices, []);
});

test('allocation 限定群組：只算組內成員，分母＝群組合計', () => {
  buy('2330', 100, 500, 'tse'); buy('0050', 100, 100, 'tse'); buy('2881', 100, 50, 'tse');
  S.setGroups([{ id: 'g1', name: '核心' }]);
  S.setGroupMap({ '2330': 'g1', '0050': 'g1' });
  const a = C.allocation('symbol', 8, 'g1');
  assert.equal(a.total, 60000);
  assert.deepEqual(a.slices.map(s => [s.key, Math.round(s.pct * 10) / 10]), [['2330', 83.3], ['0050', 16.7]]);
  assert.equal(a.count, 2);
});

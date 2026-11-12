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

test('groupPnl：群組的未實現、已實現（含已賣光的成員）與合計；美股換匯', () => {
  resetStore();
  const S = App.Store, C = App.Calc;
  const T = iso => Date.parse(iso + 'T12:00:00+08:00');
  S.setFxRate(30);
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 40, price: 600, fee: 0, market: 'tse', time: T('2026-02-05') });   // 已實現 +4,000
  C.addTransaction({ symbolInput: 'AAPL', type: 'BUY', shares: 10, price: 100, fee: 0, market: 'us', time: T('2026-01-05') });
  C.addTransaction({ symbolInput: 'MSFT', type: 'BUY', shares: 5, price: 200, fee: 0, market: 'us', time: T('2026-01-05') });
  C.addTransaction({ symbolInput: 'MSFT', type: 'SELL', shares: 5, price: 220, fee: 0, market: 'us', time: T('2026-03-05') });     // 賣光：已實現 +100 USD
  C.addTransaction({ symbolInput: '0050', type: 'BUY', shares: 10, price: 100, fee: 0, market: 'tse', time: T('2026-01-05') });   // 不在群組
  S.setPrices({ 2330: { price: 550, dailyChange: 0, prevClose: 550 }, AAPL: { price: 90, dailyChange: 0, prevClose: 90 }, '0050': { price: 300, dailyChange: 0, prevClose: 300 } });
  const r = C.groupPnl(['2330', 'AAPL', 'MSFT']);
  assert.equal(r.costTwd, 60 * 500 + 10 * 100 * 30);
  assert.equal(r.unrealizedTwd, 60 * 50 + 10 * -10 * 30);        // +3,000 − 3,000 = 0
  assert.equal(r.realizedTwd, 4000 + 100 * 30);
  assert.equal(r.totalTwd, r.unrealizedTwd + r.realizedTwd);
  assert.equal(r.unrealizedPct, 0);
  assert.deepEqual(C.groupPnl([]), { costTwd: 0, mvTwd: 0, unrealizedTwd: 0, realizedTwd: 0, totalTwd: 0, unrealizedPct: null });
});

test('symbolSeries：個股每日走勢——市值、持股成本（賣出後減少）、均價，與買賣標記', () => {
  resetStore();
  const S = App.Store, C = App.Calc, U = App.Util;
  const day = n => { const d = new Date(Date.now() - n * 86400000); return U.isoDate(d); };
  const T = iso => Date.parse(iso + 'T12:00:00+08:00');
  S.setFxRate(30);
  C.addTransaction({ symbolInput: 'AAPL', type: 'BUY', shares: 10, price: 100, fee: 0, market: 'us', time: T(day(4)) });
  C.addTransaction({ symbolInput: 'AAPL', type: 'BUY', shares: 10, price: 120, fee: 0, market: 'us', time: T(day(2)) });
  C.addTransaction({ symbolInput: 'AAPL', type: 'SELL', shares: 5, price: 130, fee: 0, market: 'us', time: T(day(1)) });
  const hist = { AAPL: [{ date: day(4), close: 101 }, { date: day(3), close: 105 }, { date: day(2), close: 118 }, { date: day(1), close: 131 }] };
  const r = C.symbolSeries('AAPL', hist);
  assert.equal(r.points.length, 5);                                   // 第一筆交易日 → 今天，每天一點
  assert.deepEqual(r.points.map(p => p.date), [day(4), day(3), day(2), day(1), day(0)]);
  assert.deepEqual(r.points.map(p => p.shares), [10, 10, 20, 15, 15]);
  assert.deepEqual(r.points.map(p => p.price), [101, 105, 118, 131, 131]);   // 今天沒有收盤價 → 沿用前一日
  assert.deepEqual(r.points.map(p => p.avgCost), [100, 100, 110, 110, 110]);
  assert.deepEqual(r.points.map(p => p.mv), [10 * 101 * 30, 10 * 105 * 30, 20 * 118 * 30, 15 * 131 * 30, 15 * 131 * 30]);
  assert.deepEqual(r.points.map(p => p.cost), [30000, 30000, 66000, 49500, 49500]);   // 賣 5 股後成本跟著減少
  assert.deepEqual(r.trades.map(t => [t.idx, t.type, t.shares, t.price]), [[0, 'BUY', 10, 100], [2, 'BUY', 10, 120], [3, 'SELL', 5, 130]]);
  assert.deepEqual(C.symbolSeries('NOPE', {}), { points: [], trades: [] });
  // 全部賣光 → 之後沒有持股：均價為 null、市值與成本為 0
  C.addTransaction({ symbolInput: 'AAPL', type: 'SELL', shares: 15, price: 140, fee: 0, market: 'us', time: T(day(0)) });
  const last = C.symbolSeries('AAPL', hist).points.pop();
  assert.deepEqual([last.shares, last.avgCost, last.mv, last.cost], [0, null, 0, 0]);
  // 沒有歷史價 → 用均價估（市值＝成本）
  const noHist = C.symbolSeries('AAPL', {}).points[0];
  assert.equal(noHist.mv, noHist.cost);
});

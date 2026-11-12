/* dayPnl — 當日損益需考慮今日買入（定期定額/手動）：
 *   當日損益 = 昨日已持有股數 × (現價 − 昨收) + 今日買入股數 × (現價 − 買入價)
 * 今日買入不得以昨收為基準（避免把跳空缺口算進當日損益）。 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store;

const DAY = 86400000;
const YESTERDAY = Date.now() - 2 * DAY; // 保證是不同的台北日期

beforeEach(() => resetStore());

function seed2330Price() {
  // 昨收 515 → 現價 520，個股當日漲 5
  S.setPrices({ '2330': { price: 520, dailyChange: 5, prevClose: 515 } });
}

test('dayPnl：今日買入以買入價為基準，昨日持股以昨收為基準', () => {
  seed2330Price();
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: YESTERDAY });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 50, price: 518, fee: 0, market: 'tse', time: Date.now() });
  const pos = C.buildPositions().find(p => p.symbol === '2330');
  // 100 × (520−515) + 50 × (520−518) = 500 + 100 = 600（舊算法會是 150×5 = 750）
  assert.equal(Math.round(pos.dayPnl), 600);
});

test('dayPnl：全部持股皆今日買入 → 只算 現價 − 買入價', () => {
  seed2330Price();
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 50, price: 518, fee: 0, market: 'tse', time: Date.now() });
  const pos = C.buildPositions().find(p => p.symbol === '2330');
  assert.equal(Math.round(pos.dayPnl), 100); // 50 × (520−518)
});

test('dayPnl：今日買入且同日賣出部分 → 賣出先扣昨日持股', () => {
  seed2330Price();
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: YESTERDAY });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 50, price: 518, fee: 0, market: 'tse', time: Date.now() });
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 30, price: 521, fee: 0, market: 'tse', time: Date.now() });
  const pos = C.buildPositions().find(p => p.symbol === '2330');
  // 剩 120 股：昨日持股 70 × 5 + 今日買入 50 × (520−518) = 350 + 100 = 450
  // 加上今日賣出的 30 股（先賣昨日持股）：(521 − 昨收 515) × 30 = 180 → 630
  assert.equal(Math.round(pos.dayPnl), 630);
});

test('dayPnl：無報價資料 → 0', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: YESTERDAY });
  const pos = C.buildPositions().find(p => p.symbol === '2330');
  assert.equal(pos.dayPnl, 0);
});

test('buildSummary：twDayPnl 採用 dayPnl（含今日買入調整）', () => {
  seed2330Price();
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: YESTERDAY });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 50, price: 518, fee: 0, market: 'tse', time: Date.now() });
  const s = C.buildSummary(C.buildPositions());
  assert.equal(Math.round(s.twDayPnl), 600);
  assert.equal(Math.round(s.dayPnl), 600);
});

test('buildSummary：美股今日買入同樣調整且換算 TWD', () => {
  S.setFxRate(30);
  S.setPrices({ TSLA: { price: 310, dailyChange: 10, prevClose: 300 } });
  C.addTransaction({ symbolInput: 'TSLA', type: 'BUY', shares: 10, price: 250, fee: 0, market: 'us', time: YESTERDAY });
  C.addTransaction({ symbolInput: 'TSLA', type: 'BUY', shares: 5, price: 309, fee: 0, market: 'us', time: Date.now() });
  const s = C.buildSummary(C.buildPositions());
  // (10 × 10 + 5 × (310−309)) × 30 = 105 × 30 = 3150
  assert.equal(Math.round(s.usDayPnlTwd), 3150);
});

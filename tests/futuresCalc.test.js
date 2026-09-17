/* calc.js 併入期貨：淨資產、快照、重建歷史、統計、手續費。spec §4.4–4.5 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, F = App.Futures;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');

function seed() {
  S.setFxRate(30);
  S.setCashAccounts([{ id: 'm1', name: '期貨保證金', currency: 'TWD', balance: 2000000 }, { id: 'c1', name: '台幣', currency: 'TWD', balance: 500000 }]);
  S.setFutures({ accountId: 'm1' });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  S.setPrices({ '2330': { price: 600, dailyChange: 10, prevClose: 590 }, 'FUT:TX@202610': { price: 46764, dailyChange: 305, prevClose: 46459 } });
  F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 2, price: 45900, fee: 0, tax: 0, time: T('2026-08-20') });
}

test('assetsSummary：淨資產 = 現金(含保證金) + 投資 − 負債 + 期貨未平倉', () => {
  seed();
  const a = C.assetsSummary();
  assert.equal(a.fut.unrealized, 345600);
  assert.equal(a.netWorth, 2500000 + 60000 + 345600);
  assert.ok(Math.abs(a.fut.exposure - 46764 * 400 / a.netWorth) < 1e-9);
});

test('saveTodaySnapshot：期貨欄位 + totalPnl/dayPnl/netWorth 含期貨', () => {
  seed();
  C.saveTodaySnapshot();
  const s = S.getSnapshots()[0];
  assert.equal(s.futUnrealizedTwd, 345600);
  assert.equal(s.futRealizedPnl, 0);
  assert.equal(s.futEquityTwd, 2345600);
  assert.equal(s.futNotionalTwd, 46764 * 400);
  assert.equal(s.futDayPnl, 122000);
  assert.equal(s.unrealizedPnl, 10000 + 345600);
  assert.equal(s.totalPnl, 10000 + 345600);
  assert.equal(s.dayPnl, 1000 + 122000);
  assert.equal(s.netWorth, 2500000 + 60000 + 345600);
});

test('makeSnapshot：舊資料無期貨欄位 → 0', () => {
  const s = C.makeSnapshot('2026-01-01', { twMarketValue: 100, usMarketValueTwd: 0, twCostBasis: 80, usCostBasisTwd: 0, twUnrealizedPnl: 20, usUnrealizedPnlTwd: 0, twRealizedPnl: 0, usRealizedPnlTwd: 0 });
  assert.equal(s.futUnrealizedTwd, 0); assert.equal(s.totalPnl, 20);
});

test('rebuildSnapshots：期貨歷史 carry-forward，交易日前不計', () => {
  seed();
  const futHist = { 'TX@202610': [{ date: '2026-08-19', close: 45500 }, { date: '2026-08-21', close: 46000 }, { date: '2026-08-24', close: 46200 }] };
  C.rebuildSnapshots({ '2330': [{ date: '2026-01-05', close: 500 }] }, 30, futHist);
  const by = {}; for (const s of S.getSnapshots()) by[s.date] = s;
  assert.equal(by['2026-08-19'].futUnrealizedTwd, 0);                       // 尚未買
  assert.equal(by['2026-08-20'].futUnrealizedTwd, (45500 - 45900) * 400);    // 用 8/19 收盤 carry-forward
  assert.equal(by['2026-08-22'].futUnrealizedTwd, (46000 - 45900) * 400);    // 週末沿用 8/21
  assert.equal(by['2026-08-24'].futNotionalTwd, 46200 * 400);
  assert.equal(by['2026-08-24'].totalPnl, 0 + (46200 - 45900) * 400);       // 股票平盤→0，期貨 +120000
  assert.equal(by['2026-08-24'].futEquityTwd, 2000000 + (46200 - 45900) * 400);
});

test('rebuildSnapshots：只有期貨、沒有股票交易也能重建', () => {
  S.setFutures({ accountId: null });
  F.addTrade({ contract: 'MTX', month: '202610', side: 'BUY', lots: 1, price: 45000, fee: 0, tax: 0, time: T('2026-09-10') });
  const n = C.rebuildSnapshots({}, 30, { 'MTX@202610': [{ date: '2026-09-10', close: 45100 }] });
  assert.ok(n >= 1);
  assert.equal(S.getSnapshots()[0].futUnrealizedTwd, 100 * 50);
});

test('tradingStats / scopedStats：單筆之最含期貨平倉；feesSummary.fut', () => {
  seed();
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 50, price: 520, fee: 0, market: 'tse', time: T('2026-03-01') }); // +1000
  F.rollover({ contract: 'TX', month: '202610', toMonth: '202611', lots: 2, closePrice: 46764, openPrice: 46690, time: T('2026-10-15') }); // +345600
  const st = C.tradingStats();
  assert.equal(st.bestTrade.market, 'fut');
  assert.equal(st.bestTrade.amount, 345600);
  assert.equal(st.bestTrade.label, '大台 202610→202611');
  assert.equal(st.bestTrade.lots, 2);
  const sc = C.scopedStats('2026-10-01', '2026-10-31', ['day']);
  assert.equal(sc.bestTrade.amount, 345600);
  assert.equal(C.scopedStats('2026-01-01', '2026-03-31', ['day']).bestTrade.symbol, '2330');
  const fees = C.feesSummary('2026-10-01', '2026-10-31');
  assert.ok(Math.abs(fees.fut - (240 + F.taxOf('TX', 46764, 2) + F.taxOf('TX', 46690, 2))) < 1e-6);
  assert.equal(fees.total, fees.fut);
  assert.equal(fees.count, 2);
});

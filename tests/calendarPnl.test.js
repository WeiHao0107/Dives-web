/* 報表月曆：各日損益（總/台股/美股/加密/期貨/股息/群組）與格子金額格式 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, U = App.Util;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');
const snap = (date, tw, us, cr, futR, futU) => ({ date, twTotalPnl: tw, usTotalPnlTwd: us, cryptoTotalPnlTwd: cr, futRealizedPnl: futR, futUnrealizedTwd: futU, totalPnl: tw + us + cr + futR + futU });

function seedSnaps() {
  S.setSnapshots([
    snap('2026-09-30', 100, 50, 10, 0, 0),
    snap('2026-10-01', 150, 50, 10, 0, 200),     // 台股 +50、期貨 +200
    snap('2026-10-02', 120, 80, 10, 300, -100),  // 台股 −30、美股 +30、期貨 0（已實現 +300、未實現 −300）
    snap('2026-10-05', 120, 80, 25, 300, -100),  // 加密 +15
    snap('2026-11-02', 500, 80, 25, 300, -100),
  ]);
}

test('各分類：當日 = 累計 − 前一筆快照（跨月以上月最後一筆為基準）', () => {
  seedSnaps();
  assert.deepEqual(C.calendarPnl(2026, 10, 'tw'), { days: { 1: 50, 2: -30, 5: 0 }, sum: 20 });
  assert.deepEqual(C.calendarPnl(2026, 10, 'us').days, { 1: 0, 2: 30, 5: 0 });
  assert.deepEqual(C.calendarPnl(2026, 10, 'crypto').days, { 1: 0, 2: 0, 5: 15 });
  assert.deepEqual(C.calendarPnl(2026, 10, 'fut').days, { 1: 200, 2: 0, 5: 0 });
});

test('總損益含息 = 台股+美股+加密+期貨+股息；股息依入帳日', () => {
  seedSnaps();
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  C.addDividend({ symbolInput: '2330', market: 'tse', amount: 40, date: '2026-10-02' });
  const all = C.calendarPnl(2026, 10, 'all'), div = C.calendarPnl(2026, 10, 'div');
  assert.deepEqual(div, { days: { 2: 40 }, sum: 40 });
  assert.deepEqual(all.days, { 1: 250, 2: 40, 5: 15 });
  const parts = ['tw', 'us', 'crypto', 'fut', 'div'].reduce((s, c) => s + C.calendarPnl(2026, 10, c).sum, 0);
  assert.equal(all.sum, parts);
});

test('沒有快照的月份 → 空', () => {
  seedSnaps();
  assert.deepEqual(C.calendarPnl(2026, 8, 'all'), { days: {}, sum: 0 });
});

test('群組每日損益 = Δ(市值−成本) + 當日已實現（美股換匯）', () => {
  S.setFxRate(30);
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', time: T('2026-10-01') });
  C.addTransaction({ symbolInput: 'AAPL', type: 'BUY', shares: 10, price: 100, fee: 0, market: 'us', time: T('2026-10-01') });
  C.addTransaction({ symbolInput: '2330', type: 'SELL', shares: 100, price: 560, fee: 0, market: 'tse', time: T('2026-10-05') });
  // 序列（buildGroupSeries 的輸出形狀）：10/2 2330 漲到 520、AAPL 漲到 110；10/5 2330 以 560 全賣
  const series = [
    { date: '2026-10-01', mv: 50000 + 30000, cost: 50000 + 30000 },
    { date: '2026-10-02', mv: 52000 + 33000, cost: 50000 + 30000 },
    { date: '2026-10-05', mv: 33000, cost: 30000 },
  ];
  const r = C.groupCalendarPnl(['2330', 'AAPL'], series, 2026, 10);
  assert.deepEqual(r.days, { 1: 0, 2: 5000, 5: 4000 });   // 10/5：未實現 −2000（賣掉的 2330）＋已實現 +6000
  assert.equal(r.sum, 9000);
});

test('fmtCalCell：格子金額格式', () => {
  assert.equal(U.fmtCalCell(8450), '+8,450');
  assert.equal(U.fmtCalCell(-931), '-931');
  assert.equal(U.fmtCalCell(174000), '+17.4萬');
  assert.equal(U.fmtCalCell(20000), '+2萬');
  assert.equal(U.fmtCalCell(-1325000), '-133萬');        // 100 萬以上取整數萬
  assert.equal(U.fmtCalCell(13370000), '+1337萬');       // 1,000 萬以上不加千分位
  assert.equal(U.fmtCalCell(123400000), '+1.23億');
  assert.equal(U.fmtCalCell(9999.6), '+1萬');            // 進位後跨級
});

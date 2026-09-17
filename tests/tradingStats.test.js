/* App.Calc.tradingStats — 統計頁：區間/交易/持倉之最。SPEC §10 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, U = App.Util;

beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T00:00:00+08:00');

test('區間最佳/最差獲利：以 totalPnl 的期間變化計算', () => {
  // 每日累計損益：+0 → +100 → +50(−50) → +300(+250) → +280(−20)
  S.setSnapshots([
    { date: '2026-03-01', totalPnl: 0 },
    { date: '2026-03-02', totalPnl: 100 },
    { date: '2026-03-03', totalPnl: 50 },
    { date: '2026-03-04', totalPnl: 300 },
    { date: '2026-03-05', totalPnl: 280 },
  ]);
  const st = C.tradingStats();
  assert.equal(st.period.all.day.best.amount, 250);   // 03-04 大漲
  assert.equal(st.period.all.day.best.date, '2026-03-04');
  assert.equal(st.period.all.day.worst.amount, -50);  // 03-03 大跌
  assert.equal(st.period.all.day.worst.date, '2026-03-03');
  assert.ok(!('year' in st.period.thisYear));         // 今年不含年度
});

test('全部上漲 → 最大虧損為 null（虧損必須為負）', () => {
  S.setSnapshots([
    { date: '2026-03-01', totalPnl: 0 },
    { date: '2026-03-02', totalPnl: 100 },
    { date: '2026-03-03', totalPnl: 250 },
  ]);
  const st = C.tradingStats();
  assert.ok(st.period.all.day.best);          // 有獲利
  assert.equal(st.period.all.day.worst, null); // 無虧損 → null
});

test('賣出全賺 → 最賠一筆為 null；持倉全賺 → 虧損王 null', () => {
  S.setRealized([{ id: '1', symbol: '2330', realizedPnl: 5000, time: T('2026-05-01') }]);
  const st = C.tradingStats();
  assert.equal(st.bestTrade.symbol, '2330');
  assert.equal(st.worstTrade, null);
});

test('單筆交易之最：最賺 / 最賠（依 realizedPnl，含股數/價格；美股金額換算 TWD）', () => {
  S.setFxRate(30);
  S.upsertMeta([{ code: '2330', name: '台積電', market: 'tse' }, { code: 'TSLA', name: 'Tesla', market: 'us' }, { code: 'NVDA', name: 'NVIDIA', market: 'us' }]);
  S.setRealized([
    { id: '1', symbol: '2330', shares: 100, sellPrice: 2500, avgCost: 1802, realizedPnl: 69800, time: T('2026-05-01') },
    { id: '2', symbol: 'TSLA', shares: 30, sellPrice: 300, avgCost: 700, realizedPnl: -12000, time: T('2026-05-10') },
    { id: '3', symbol: 'NVDA', shares: 10, sellPrice: 200, avgCost: 100, realizedPnl: 1000, time: T('2026-05-20') },
  ]);
  const st = C.tradingStats();
  assert.equal(st.bestTrade.symbol, '2330');
  assert.equal(st.bestTrade.amount, 69800);
  assert.equal(st.bestTrade.shares, 100);   // 成交股數
  assert.equal(st.bestTrade.price, 2500);    // 成交價（原幣別）
  assert.equal(st.worstTrade.symbol, 'TSLA');
  assert.equal(st.worstTrade.amount, -12000 * 30); // USD → TWD
  assert.equal(st.worstTrade.price, 300);           // 價格仍為 USD
});

test('單筆交易之最：跨幣別比較須先換算 TWD（$1,000 美股 > NT$2,000 台股）', () => {
  S.setFxRate(30);
  S.upsertMeta([{ code: '2330', name: '台積電', market: 'tse' }, { code: 'NVDA', name: 'NVIDIA', market: 'us' }]);
  S.setRealized([
    { id: '1', symbol: '2330', shares: 10, sellPrice: 1000, avgCost: 800, realizedPnl: 2000, time: T('2026-05-01') },
    { id: '2', symbol: 'NVDA', shares: 10, sellPrice: 200, avgCost: 100, realizedPnl: 1000, time: T('2026-05-02') },
    { id: '3', symbol: '2330', shares: 10, sellPrice: 700, avgCost: 800, realizedPnl: -1000, time: T('2026-05-03') },
    { id: '4', symbol: 'NVDA', shares: 1, sellPrice: 90, avgCost: 100, realizedPnl: -10, time: T('2026-05-04') },
  ]);
  const st = C.tradingStats();
  assert.equal(st.bestTrade.symbol, 'NVDA');
  assert.equal(st.bestTrade.amount, 30000);
  assert.equal(st.worstTrade.symbol, '2330');  // −NT$1,000 比 −$10(−NT$300) 更賠
  assert.equal(st.worstTrade.amount, -1000);
  const sc = C.scopedStats('2026-01-01', '2026-12-31', ['day']);
  assert.equal(sc.bestTrade.symbol, 'NVDA');
  assert.equal(sc.bestTrade.amount, 30000);
  assert.equal(sc.worstTrade.amount, -1000);
});

test('區間獲利之最：忽略第一個期間（第一天的變化不計入）', () => {
  S.setSnapshots([
    { date: '2026-03-01', totalPnl: 0 },
    { date: '2026-03-02', totalPnl: 1000 }, // 第一個變化 +1000 → 應忽略
    { date: '2026-03-03', totalPnl: 1200 }, // +200
    { date: '2026-03-04', totalPnl: 1100 }, // -100
  ]);
  const st = C.tradingStats();
  assert.equal(st.period.all.day.best.amount, 200);   // 不是 1000
  assert.equal(st.period.all.day.best.date, '2026-03-03');
  assert.equal(st.period.all.day.worst.amount, -100);
});

test('區間獲利之最：略過開頭 totalPnl=0 基準造成的假峰（重建歷史前幾天無報價）', () => {
  // 重建歷史時前 3 天無報價 → totalPnl=0，第 4 天報價進來一次認列 → 250000 假峰不可計入
  S.setSnapshots([
    { date: '2026-01-01', totalPnl: 0 },
    { date: '2026-01-02', totalPnl: 0 },
    { date: '2026-01-03', totalPnl: 0 },
    { date: '2026-01-04', totalPnl: 250000 }, // 0→首值的假峰 → 應略過
    { date: '2026-01-05', totalPnl: 251200 }, // +1200
    { date: '2026-01-06', totalPnl: 250100 }, // -1100
  ]);
  const st = C.tradingStats();
  assert.equal(st.period.all.day.best.amount, 1200);   // 不是 250000
  assert.equal(st.period.all.day.best.date, '2026-01-05');
  assert.equal(st.period.all.day.worst.amount, -1100);
});

test('目前持倉之最：未實現獲利/虧損/報酬率（無資料回 null）', () => {
  const empty = C.tradingStats();
  assert.equal(empty.bestTrade, null);
  assert.equal(empty.topGain, null);

  // 建持倉 + 報價：2330 大賺、TSLA 小賠
  S.setFxRate(30);
  S.upsertMeta([{ code: '2330', name: '台積電', market: 'tse' }, { code: 'TSLA', name: 'Tesla', market: 'us' }]);
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 0, market: 'tse', name: '台積電' });
  C.addTransaction({ symbolInput: 'TSLA', type: 'BUY', shares: 10, price: 300, fee: 0, market: 'us', name: 'Tesla' });
  S.setPrices({ '2330': { price: 800, dailyChange: 0, prevClose: 800 }, TSLA: { price: 290, dailyChange: 0, prevClose: 290 } });
  const st = C.tradingStats();
  assert.equal(st.topGain.symbol, '2330');           // +30000 TWD
  assert.equal(Math.round(st.topGain.amount), 30000);
  assert.equal(st.topLoss.symbol, 'TSLA');           // −100 USD ×30 = −3000
  assert.equal(Math.round(st.topLoss.amount), -3000);
  assert.equal(st.topPct.symbol, '2330');            // +60%
  assert.equal(Math.round(st.topPct.pct), 60);
});

/* scopedStats — 報表鑽取的區間統計 */
test('scopedStats：區間損益 = 區間末 − 區間前基準；報酬率以區間末成本計', () => {
  S.setSnapshots([
    { date: '2024-12-31', totalPnl: 10000, totalCostBasisTwd: 100000 },
    { date: '2025-06-30', totalPnl: 35000, totalCostBasisTwd: 175000 },
    { date: '2025-12-31', totalPnl: 50000, totalCostBasisTwd: 200000 },
    { date: '2026-06-30', totalPnl: 80000, totalCostBasisTwd: 260000 },
  ]);
  const y = C.scopedStats('2025-01-01', '2025-12-31', ['day', 'week', 'month']);
  assert.equal(y.periodPnl, 40000);                 // 50000 − 10000(2024末)
  assert.equal(Math.round(y.periodReturnPct), 20);  // 40000 / 200000
});

test('scopedStats：區間獲利之最只計區間內、以區間前為基準', () => {
  S.setSnapshots([
    { date: '2024-12-31', totalPnl: 10000, totalCostBasisTwd: 100000 }, // 基準
    { date: '2025-03-31', totalPnl: 30000, totalCostBasisTwd: 150000 }, // +20000
    { date: '2025-06-30', totalPnl: 25000, totalCostBasisTwd: 150000 }, // −5000
    { date: '2025-09-30', totalPnl: 60000, totalCostBasisTwd: 180000 }, // +35000
  ]);
  const y = C.scopedStats('2025-01-01', '2025-12-31', ['month']);
  assert.equal(y.period.month.best.amount, 35000);
  assert.equal(y.period.month.best.date, '2025-09-30');
  assert.equal(y.period.month.worst.amount, -5000);
  assert.equal(y.period.month.worst.date, '2025-06-30');
});

test('scopedStats：單筆交易之最依成交日過濾（只含區間內）', () => {
  S.setRealized([ // 台股代碼（純數字）→ 金額即 TWD，不經匯率
    { symbol: '1111', realizedPnl: 5000, time: T('2025-05-01'), shares: 10, sellPrice: 100, avgCost: 50 },
    { symbol: '2222', realizedPnl: 9000, time: T('2026-02-01'), shares: 10, sellPrice: 200, avgCost: 100 },
  ]);
  const y = C.scopedStats('2025-01-01', '2025-12-31', ['day']);
  assert.equal(y.bestTrade.symbol, '1111');   // 2026 的 2222 不計入
  assert.equal(y.bestTrade.amount, 5000);
  assert.equal(y.worstTrade, null);
});

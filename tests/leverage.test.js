/* 槓桿倍率：(持股市值 × 自訂倍數 ＋ 期貨契約值) ÷ 淨資產；設定可切期貨／負債計法 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, F = App.Futures;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');

function seed() {
  S.setFxRate(30);
  S.setCashAccounts([{ id: 'm1', name: '保證金', currency: 'TWD', balance: 1000000 }]);
  S.setLiabilities([{ id: 'l1', name: '信貸', currency: 'TWD', balance: 400000 }]);
  S.setFutures({ accountId: 'm1' });
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 1000, price: 500, fee: 0, market: 'tse', time: T('2026-01-05') });
  C.addTransaction({ symbolInput: '00631L', type: 'BUY', shares: 1000, price: 100, fee: 0, market: 'tse', time: T('2026-01-05') });
  C.addTransaction({ symbolInput: 'TQQQ', type: 'BUY', shares: 100, price: 50, fee: 0, market: 'us', time: T('2026-01-05') });
  S.setPrices({ '2330': { price: 600 }, '00631L': { price: 200 }, 'TQQQ': { price: 100 }, 'FUT:MTX@202610': { price: 40000 } });
  F.addTrade({ contract: 'MTX', month: '202610', side: 'BUY', lots: 1, price: 40000, fee: 0, tax: 0, time: T('2026-08-20') });
}
// 股票市值：2330 600,000 + 00631L 200,000 + TQQQ 300,000 = 1,100,000；契約值 40000×50 = 2,000,000
// 淨資產 = 1,000,000 + 1,100,000 − 400,000 + 0 = 1,700,000

test('預設：全部 1 倍 + 期貨契約值，分母淨資產', () => {
  seed();
  const l = C.leverageSummary();
  assert.equal(l.stockMv, 1100000);
  assert.equal(l.multExtra, 0);
  assert.equal(l.futNotional, 2000000);
  assert.equal(l.exposure, 3100000);
  assert.equal(l.denom, 1700000);
  assert.ok(Math.abs(l.ratio - 3100000 / 1700000) < 1e-9);
});

test('自訂倍數：00631L ×2、TQQQ ×3；倍數 1 不列入 items', () => {
  seed();
  S.setLeverage({ mult: { '00631L': 2, 'TQQQ': 3 } });
  const l = C.leverageSummary();
  assert.equal(l.multExtra, 200000 * 1 + 300000 * 2);
  assert.equal(l.exposure, 1100000 + 800000 + 2000000);
  assert.deepEqual(l.items.map(i => [i.symbol, i.mult, i.extra]), [['TQQQ', 3, 600000], ['00631L', 2, 200000]]);
});

test('期貨不計、負債不計（分母改總資產）', () => {
  seed();
  S.setLeverage({ futures: 'none', liab: 'gross' });
  const l = C.leverageSummary();
  assert.equal(l.futNotional, 0);
  assert.equal(l.exposure, 1100000);
  assert.equal(l.denom, 2100000);
  assert.ok(Math.abs(l.ratio - 1100000 / 2100000) < 1e-9);
});

test('淨資產 ≤ 0 → ratio null；沒有持倉也不會炸', () => {
  S.setLiabilities([{ id: 'l1', name: '信貸', currency: 'TWD', balance: 1 }]);
  const l = C.leverageSummary();
  assert.equal(l.ratio, null);
  assert.equal(l.exposure, 0);
});

test('getLeverage 預設關閉；setLeverage 只覆蓋給的欄位', () => {
  assert.equal(S.getLeverage().show, false);
  S.setLeverage({ show: true });
  S.setLeverage({ mult: { A: 2 } });
  assert.equal(S.getLeverage().show, true);
  assert.equal(S.getLeverage().mult.A, 2);
});

test('備份：lev* 設定列匯出→匯入', () => {
  S.setLeverage({ show: true, futures: 'none', liab: 'gross', mult: { '00631L': 2, TQQQ: 3 } });
  const csv = App.Csv.exportCsv();
  resetStore();
  App.Csv.importCsv(csv);
  assert.deepEqual(S.getLeverage(), { show: true, futures: 'none', liab: 'gross', mult: { '00631L': 2, TQQQ: 3 } });
});

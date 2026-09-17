/* 期貨備份：# FUTURES 分段（交易含 rollId/cash）+ # SETTINGS 期貨設定列；帳戶依名稱重連。spec §7 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const S = App.Store, F = App.Futures, Csv = App.Csv;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');

test('期貨：交易（含 rollId/cash）與設定 匯出→匯入 全還原，帳戶依名稱重連', () => {
  S.setCashAccounts([{ id: 'old', name: '期貨保證金', currency: 'TWD', balance: 2000000 }]);
  S.setFutures({ accountId: 'old', margin: { TX: { init: 700000, maint: 540000 } }, marginDate: '2026/08/12', marginAuto: false, feePerLot: { TX: 55 }, alerts: { expiry: false, risk: true } });
  F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 2, price: 45900, fee: 110, time: T('2026-08-20') });
  F.rollover({ contract: 'TX', month: '202610', toMonth: '202611', lots: 2, closePrice: 46764, openPrice: 46690, time: T('2026-10-15') });
  const before = F.getState();
  const csv = Csv.exportCsv();
  resetStore();
  const res = Csv.importCsv(csv);
  assert.equal(res.ok, true);
  assert.equal(res.futCount, 3);
  const st = F.getState();
  assert.equal(st.trades.length, 3);
  const pick = t => [t.contract, t.month, t.side, t.lots, t.price, t.fee, t.tax, t.time, t.rollId || null, t.cash];
  assert.deepEqual(st.trades.map(pick), before.trades.map(pick));
  assert.equal(st.margin.TX.init, 700000); assert.equal(st.margin.TX.maint, 540000);
  assert.equal(st.margin.MTX.init, 175250); // 未改的合約保持預設
  assert.equal(st.marginDate, '2026/08/12'); assert.equal(st.marginAuto, false);
  assert.equal(st.feePerLot.TX, 55); assert.equal(st.alerts.expiry, false); assert.equal(st.alerts.risk, true);
  const acct = S.getCashAccounts().find(a => a.name === '期貨保證金');
  assert.equal(st.accountId, acct.id);
  assert.equal(acct.balance, before.trades.reduce((b, t) => b + t.cash, 2000000)); // 餘額從 ACCOUNTS 還原，不重套 cash
});

test('舊備份沒有 # FUTURES → 不動既有期貨資料', () => {
  S.setFutures({ trades: [{ id: 'x', contract: 'TX', month: '202610', side: 'BUY', lots: 1, price: 1, fee: 0, tax: 0, time: 1 }] });
  Csv.importCsv('# TRANSACTIONS\nSymbol,Market,Type,Shares,Price,Fee,Time\n2330,tse,BUY,1,500,0,1700000000000\n');
  assert.equal(F.getState().trades.length, 1);
});

/* 完整備份（v133）：CSV 分段新增 DIVIDENDS / RECURRING / META / SETTINGS，
 * 全量 roundtrip 還原；帳戶/負債以「名稱」重新連結（匯入後 id 會重生）。
 * 同時修現有 bug：STOCK_DIV(配股) 交易匯入時被丟棄。
 * 安全：不匯出 finnhub 金鑰與 App 鎖(dives_lock_*)。 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, Csv = App.Csv;

beforeEach(() => resetStore());

const DAY = 86400000;

test('STOCK_DIV 配股交易：匯出→匯入不遺失，且成本引擎視為零成本加股', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 100, price: 500, fee: 20, market: 'tse', name: '台積電', time: Date.now() - 9 * DAY });
  C.addStockDividend({ symbolInput: '2330', shares: 10, date: '2026-06-15' });
  const csv = Csv.exportCsv();
  resetStore();
  const res = Csv.importCsv(csv);
  assert.equal(res.ok, true);
  const txs = S.getTransactions();
  assert.equal(txs.filter(t => t.type === 'STOCK_DIV').length, 1);
  const pos = C.buildPositions().find(p => p.symbol === '2330');
  assert.equal(pos.shares, 110);
  assert.ok(Math.abs(pos.avgCost - (100 * 500 + 20) / 110) < 1e-6); // 配股攤低均價
});

test('股利記錄：金額/日期/除息日/市場 全還原（自動匯入去重依 symbol+exDate 不失效）', () => {
  C.addDividend({ symbolInput: '2330', amount: 3200, date: '2026-06-20', exDate: '2026-06-10', market: 'tse', name: '台積電' });
  C.addDividend({ symbolInput: 'AAPL', amount: 25.5, date: '2026-05-15', exDate: '2026-05-09', market: 'us', name: 'Apple' });
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const divs = S.getDividends();
  assert.equal(divs.length, 2);
  const tw = divs.find(d => d.symbol === '2330');
  assert.equal(tw.amount, 3200);
  assert.equal(tw.date, '2026-06-20');
  assert.equal(tw.exDate, '2026-06-10');
  const us = divs.find(d => d.symbol === 'AAPL');
  assert.equal(us.market, 'us');
  assert.equal(us.amount, 25.5);
});

test('定期定額計畫：入帳帳戶以名稱重新連結到匯入後的新 id', () => {
  S.setCashAccounts([{ id: 'old-acct-id', name: '台幣戶', currency: 'TWD', balance: 100000 }]);
  S.setRecurringPlans([{
    id: 'p1', kind: 'dca', symbol: '0050', market: 'tse', name: '元大台灣50',
    amount: 10000, freq: 'monthly', day: 6, startDate: '2026-01-01', endDate: null,
    enabled: true, accountId: 'old-acct-id', priceBasis: 'close', feeMode: 'rate', feeVal: 0.1425,
    lastRun: '2026-07-06', createdAt: Date.now(),
  }]);
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const plans = S.getRecurringPlans();
  assert.equal(plans.length, 1);
  const p = plans[0];
  assert.equal(p.kind, 'dca');
  assert.equal(p.symbol, '0050');
  assert.equal(p.amount, 10000);
  assert.equal(p.freq, 'monthly');
  assert.equal(p.day, 6);
  assert.equal(p.feeMode, 'rate');
  assert.ok(Math.abs(p.feeVal - 0.1425) < 1e-9);
  assert.equal(p.lastRun, '2026-07-06'); // 保留,避免還原後重複執行
  const acct = S.getCashAccounts().find(a => a.name === '台幣戶');
  assert.ok(acct, '現金帳戶已還原');
  assert.equal(p.accountId, acct.id, '計畫依名稱連回新帳戶 id');
});

test('負債定期繳款計畫：依負債名稱重新連結', () => {
  S.setLiabilities([{ id: 'old-liab', name: '信貸', currency: 'TWD', balance: 1900000 }]);
  S.setRecurringPlans([{
    id: 'p2', kind: 'liability', liabilityId: 'old-liab', amount: 25000,
    freq: 'monthly', day: 15, startDate: '2026-01-01', endDate: null, enabled: false,
    accountId: null, lastRun: null, createdAt: Date.now(),
  }]);
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const p = S.getRecurringPlans()[0];
  assert.equal(p.kind, 'liability');
  assert.equal(p.enabled, false); // 暫停狀態保留
  const liab = S.getLiabilities().find(l => l.name === '信貸');
  assert.equal(p.liabilityId, liab.id);
});

test('META：股票顯示名稱與市場別還原（匯入後名稱不再退化成代碼）', () => {
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 10, price: 500, fee: 0, market: 'tse', name: '台積電', time: Date.now() - DAY });
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const m = S.metaMap()['2330'];
  assert.equal(m.name, '台積電');
});

test('SETTINGS：dayMode/pctBasis/自動股利設定 還原;股利入帳帳戶依名稱連結', () => {
  S.setCashAccounts([{ id: 'a1', name: '股息戶', currency: 'TWD', balance: 0 }]);
  S.setDayMode('twday');
  S.setPctBasis('invest');
  S.setAutoDivImport(false);
  S.setAutoDivUsTax(15);
  S.setAutoDivAcct('a1');
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  assert.equal(S.getDayMode(), 'twday');
  assert.equal(S.getPctBasis(), 'invest');
  assert.equal(S.getAutoDivImport(), false);
  assert.equal(S.getAutoDivUsTax(), 15);
  const acct = S.getCashAccounts().find(a => a.name === '股息戶');
  assert.equal(S.getAutoDivAcct(), acct.id);
});

test('安全：備份不含 finnhub 金鑰與 App 鎖資料', () => {
  localStorage.setItem('dives_finnhub_key', 'SECRET-KEY-123');
  localStorage.setItem('dives_lock_pin', 'somehash');
  C.addTransaction({ symbolInput: '2330', type: 'BUY', shares: 1, price: 500, fee: 0, market: 'tse', time: Date.now() });
  const csv = Csv.exportCsv();
  assert.ok(!csv.includes('SECRET-KEY-123'));
  assert.ok(!csv.includes('somehash'));
  assert.ok(!csv.includes('finnhub'));
  localStorage.removeItem('dives_finnhub_key');
  localStorage.removeItem('dives_lock_pin');
});

test('向後相容：舊版備份檔(無新分段) → 匯入交易,既有股利/計畫不被清空', () => {
  C.addDividend({ symbolInput: '2330', amount: 1000, date: '2026-06-20', market: 'tse' });
  S.setRecurringPlans([{ id: 'p1', kind: 'dca', symbol: '0050', market: 'tse', name: 'x', amount: 1000, freq: 'monthly', day: 6, startDate: '2026-01-01', enabled: true, feeMode: 'none', feeVal: 0, lastRun: null, createdAt: 1 }]);
  const legacy = '# TRANSACTIONS\nSymbol,Market,Type,Shares,Price,Fee,Time\n2330,tse,BUY,10,500,0,' + (Date.now() - DAY);
  const res = Csv.importCsv(legacy);
  assert.equal(res.ok, true);
  assert.equal(S.getTransactions().length, 1);
  assert.equal(S.getDividends().length, 1, '股利不被舊檔匯入清掉');
  assert.equal(S.getRecurringPlans().length, 1, '計畫不被舊檔匯入清掉');
});

test('名稱含逗號：帳戶/計畫名稱全形替換後仍可正確還原連結', () => {
  S.setCashAccounts([{ id: 'a1', name: '美金,主要', currency: 'USD', balance: 500 }]);
  S.setRecurringPlans([{
    id: 'p1', kind: 'dca', symbol: 'VOO', market: 'us', name: 'Vanguard S&P 500',
    amount: 500, freq: 'weekly', day: 1, startDate: '2026-01-01', endDate: null,
    enabled: true, accountId: 'a1', priceBasis: 'open', feeMode: 'none', feeVal: 0, lastRun: null, createdAt: 1,
  }]);
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const acct = S.getCashAccounts()[0];
  const p = S.getRecurringPlans()[0];
  assert.equal(p.accountId, acct.id); // 名稱經全形逗號正規化後仍一致
  assert.equal(p.freq, 'weekly');
  assert.equal(p.priceBasis, 'open');
});

test('定期計畫：每兩週頻率 與 每週「星期日」(day=0) 匯出→匯入不失真', () => {
  S.setRecurringPlans([
    { id: 'a', kind: 'dca', symbol: '0050', market: 'tse', name: 'x', amount: 1000, freq: 'biweekly', day: 3, startDate: '2026-01-01', enabled: true, feeMode: 'none', feeVal: 0, lastRun: null, createdAt: 1 },
    { id: 'b', kind: 'dca', symbol: '0050', market: 'tse', name: 'x', amount: 1000, freq: 'weekly', day: 0, startDate: '2026-01-01', enabled: true, feeMode: 'none', feeVal: 0, lastRun: null, createdAt: 1 },
  ]);
  const csv = Csv.exportCsv();
  resetStore();
  Csv.importCsv(csv);
  const plans = S.getRecurringPlans();
  assert.equal(plans.length, 2);
  assert.equal(plans[0].freq, 'biweekly');
  assert.equal(plans[0].day, 3);
  assert.equal(plans[1].freq, 'weekly');
  assert.equal(plans[1].day, 0); // 星期日不可被 `|| 1` 變成星期一
});

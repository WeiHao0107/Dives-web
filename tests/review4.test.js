/* v176：歷史匯率、年化報酬含期貨、期貨入出金、待確認交易校正既有紀錄、加密歷史合併、本機快取 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, F = App.Futures, I = App.Inbox, U = App.Util, A = App.Api;
beforeEach(() => resetStore());
const T = (iso, hm) => Date.parse(iso + 'T' + (hm || '12:00') + ':00+08:00');
const day = n => U.isoDate(new Date(Date.now() - n * 86400000));
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-6), a + ' ≉ ' + b);

// ── 歷史匯率 ──
test('fxFn：數字 → 固定；序列 → 取該日或之前最近一筆，比最早還早用最早，沒資料用目前匯率', () => {
  S.setFxRate(32);
  assert.equal(C.fxFn(30)('2026-01-01'), 30);
  const f = C.fxFn([{ date: '2026-03-02', rate: 31 }, { date: '2026-03-04', rate: 33 }]);
  assert.deepEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-12-31'].map(f), [31, 31, 31, 33, 33]);
  assert.equal(C.fxFn([])('2026-03-01'), 32);
  assert.equal(C.fxFn(undefined)('2026-03-01'), 32);
});

test('個股走勢與群組走勢：美股市值與成本用「當天」匯率換算', () => {
  S.setFxRate(40);
  C.addTransaction({ symbolInput: 'AAPL', type: 'BUY', shares: 10, price: 100, fee: 0, market: 'us', time: T(day(2)) });
  const hist = { AAPL: [{ date: day(2), close: 100 }, { date: day(1), close: 110 }] };
  const fx = [{ date: day(2), rate: 30 }, { date: day(1), rate: 31 }, { date: day(0), rate: 32 }];
  assert.deepEqual(C.symbolSeries('AAPL', hist, fx).points.map(p => [p.mv, p.cost]), [[30000, 30000], [34100, 31000], [35200, 32000]]);
  assert.deepEqual(C.buildGroupSeries(['AAPL'], hist, fx).map(p => [p.mv, p.cost]), [[30000, 30000], [34100, 31000], [35200, 32000]]);
  assert.deepEqual(C.symbolSeries('AAPL', hist, 30).points.map(p => p.mv), [30000, 33000, 33000]);   // 給數字 → 全程同一個匯率
});

test('重建歷史：美股各日用當天匯率；期貨歷史餘額依入出金日期累計', () => {
  S.setFxRate(40);
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 0 }]);
  F.patchState({ accountId: 'm' });
  C.addTransaction({ symbolInput: 'AAPL', type: 'BUY', shares: 10, price: 100, fee: 0, market: 'us', time: T(day(3)) });
  F.addCashFlow({ amount: 100000, time: T(day(3)) });
  F.addTrade({ contract: 'TMF', month: '203012', side: 'BUY', lots: 1, price: 20000, fee: 0, tax: 0, time: T(day(3)) });
  F.addCashFlow({ amount: 50000, time: T(day(1)) });
  const fx = [{ date: day(3), rate: 30 }, { date: day(1), rate: 32 }];
  C.rebuildSnapshots({ AAPL: [{ date: day(3), close: 100 }] }, fx, {});
  const snaps = S.getSnapshots();
  assert.deepEqual(snaps.map(x => x.usMarketValueTwd), [30000, 30000, 32000, 32000]);
  assert.deepEqual(snaps.map(x => x.futEquityTwd), [100000, 100000, 150000, 150000]);
});

// ── 期貨入出金與年化報酬 ──
test('addCashFlow：入金加到保證金帳戶並留下日期；adjust=false 只記日期；沒連結帳戶 → 失敗', () => {
  assert.equal(F.addCashFlow({ amount: 1000 }).ok, false);
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 500 }]);
  F.patchState({ accountId: 'm' });
  assert.equal(F.addCashFlow({ amount: 1000, time: T('2026-11-06'), src: 'inbox:yuanta-fut' }).ok, true);
  assert.equal(S.getCashAccounts()[0].balance, 1500);
  assert.equal(F.addCashFlow({ amount: -200, time: T('2026-11-07'), adjust: false }).ok, true);
  assert.equal(S.getCashAccounts()[0].balance, 1500);
  assert.deepEqual(F.getState().flows.map(x => [x.amount, x.src || null]), [[1000, 'inbox:yuanta-fut'], [-200, null]]);
  assert.equal(F.addCashFlow({ amount: 0 }).ok, false);
});

test('年化報酬含期貨：資金流合計 = 期貨總損益；沒連結保證金帳戶 → 不計入', () => {
  const now = Date.now();
  F.addTrade({ contract: 'TMF', month: '203012', side: 'BUY', lots: 1, price: 20000, fee: 50, tax: 10, time: now - 100 * 86400000 });
  assert.deepEqual(F.xirrFlows({}, now), []);                           // 沒有帳戶 → 不知道本金
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 0 }]);
  F.patchState({ accountId: 'm' });
  S.adjustCashBalance('m', 100000);                                     // 手動入金（沒有紀錄）→ 視為第一筆交易那天投入
  F.addCashFlow({ amount: 50000, time: now - 40 * 86400000 });          // 有日期的入金
  F.addTrade({ contract: 'TMF', month: '203012', side: 'SELL', lots: 1, price: 21000, fee: 50, tax: 10, time: now - 10 * 86400000 });   // 已實現 +10,000
  const flows = F.xirrFlows({}, now);
  // 第一筆交易在連結帳戶前建立，手續費 60 沒有扣到帳戶 → 無紀錄入金 = 餘額 − 已實現淨額 − 有紀錄入金
  const bal = S.getCashAccounts()[0].balance, realizedNet = F.getState().trades.reduce((a, t) => a + (t.cash || 0), 0);
  assert.deepEqual(flows.map(x => Math.round(x.amount)), [-(bal - realizedNet - 50000), -50000, bal]);
  near(flows.reduce((a, x) => a + x.amount, 0), realizedNet);           // 淨流量 = 期貨總損益
  const all = C.buildXirrFlows(now);
  assert.equal(all.length, 3);                                          // 沒有股票 → 只有期貨的三筆
  assert.ok(C.portfolioXirr(now).rate > 0);
});

// ── 待確認交易：入出金、校正既有紀錄 ──
const feed = (items, balances) => I.setFromRemote({ app: 'dives-inbox', version: 1, updatedAt: 1, items, balances: balances || [] });
const stock = o => Object.assign({ id: 'c1', broker: 'cathay', kind: 'stock', date: '2026-11-11', symbol: 'VOO', market: 'us', side: 'BUY', shares: 2, price: 707.32, fee: 1.13 }, o);
const cash = o => Object.assign({ id: 'k1', broker: 'yuanta-fut', kind: 'fut-cash', date: '2026-11-06', type: 'DEPOSIT', amount: 50000 }, o);

test('入出金項目：格式檢查；確認後加減保證金帳戶並記錄日期', () => {
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 101215 }]);
  F.patchState({ accountId: 'm' });
  feed([cash(), cash({ id: 'k2', type: 'WITHDRAW', amount: 1215, date: '2026-11-07' }), cash({ id: 'bad', amount: 0 }), cash({ id: 'bad2', type: 'X' })],
    [{ broker: 'yuanta-fut', date: '2026-11-07', balance: 150000 }, { broker: 'x', date: 'bad', balance: 1 }]);
  assert.deepEqual(S.getInbox().items.map(x => x.id), ['k1', 'k2']);
  assert.deepEqual(S.getInbox().balances, [{ broker: 'yuanta-fut', date: '2026-11-07', balance: 150000 }]);
  assert.deepEqual(I.balanceCheck('yuanta-fut'), { date: '2026-11-07', statement: 150000, dives: 101215, diff: -48785 });
  const m = I.matchExisting(I.pending());
  assert.deepEqual(m, {});                                              // 餘額和對帳單不符 → 還沒入帳，當成新的
  const r = I.importMany(I.pending(), null, m);
  assert.deepEqual([r.ok, r.fixed, r.failed.length], [2, 0, 0]);
  assert.equal(S.getCashAccounts()[0].balance, 150000);
  assert.deepEqual(F.getState().flows.map(x => [x.amount, U.isoDate(new Date(x.time)), x.src]), [[50000, '2026-11-06', 'inbox:yuanta-fut'], [-1215, '2026-11-07', 'inbox:yuanta-fut']]);
  assert.equal(I.pendingCount(), 0);
});

test('入出金：餘額已和對帳單相符 → 視為已手動入帳，確認時只補記日期、不動餘額', () => {
  S.setCashAccounts([{ id: 'm', name: '保證金', currency: 'TWD', balance: 151215 }]);
  F.patchState({ accountId: 'm' });
  feed([cash()], [{ broker: 'yuanta-fut', date: '2026-11-06', balance: 151215 }]);
  const m = I.matchExisting(I.pending());
  assert.deepEqual(m, { k1: { kind: 'bal' } });
  const r = I.importMany(I.pending(), null, m);
  assert.deepEqual([r.ok, r.fixed], [0, 1]);
  assert.equal(S.getCashAccounts()[0].balance, 151215);
  assert.equal(F.getState().flows.length, 1);
});

test('和手動紀錄相同的交易：確認＝校正那筆的日期與手續費，不新增；一筆紀錄只配一個項目', () => {
  S.setFxRate(30);
  S.setCashAccounts([{ id: 'usd', name: '美金', currency: 'USD', balance: 5000 }]);
  // 手動輸入：記帳時間是成交隔天，手續費隨手填 2
  C.addTransaction({ symbolInput: 'VOO', type: 'BUY', shares: 2, price: 707.32, fee: 2, market: 'us', accountId: 'usd', time: T('2026-11-12', '09:30') });
  const manualId = S.getTransactions()[0].id;
  feed([stock(), stock({ id: 'c2' })]);                                  // 對帳單上有兩筆一樣的成交，手動只記了一筆
  const m = I.matchExisting(I.pending());
  assert.deepEqual(m, { c1: { kind: 'tx', id: manualId } });             // 只有先成交的那筆配到；另一筆是新的
  assert.equal(I.isDuplicate(S.getInbox().items[0]), true);
  const r = I.importMany(I.pending(), () => 'usd', m);
  assert.deepEqual([r.ok, r.fixed, r.failed.length], [1, 1, 0]);
  const txs = S.getTransactions();
  assert.equal(txs.length, 2);                                           // 1 筆校正 + 1 筆新增
  const fixed = txs.find(t => t.id === manualId);
  assert.deepEqual([U.isoDate(new Date(fixed.time)), fixed.fee, fixed.source], ['2026-11-11', 1.13, 'inbox:cathay']);
  // 現金帳戶：兩筆各扣 2×707.32 + 1.13（校正那筆的手續費差額也沖回）
  near(S.getCashAccounts()[0].balance, 5000 - 2 * (2 * 707.32 + 1.13), 0.011);
  // 校正過的紀錄帶有來源標記 → 之後不會再被別的項目配走
  feed([stock({ id: 'c3' })]);
  assert.deepEqual(I.matchExisting(I.pending()), {});
});

test('期貨交易的校正：改日期、手續費與稅，並標記來源', () => {
  F.addTrade({ contract: 'TX', month: '202611', side: 'BUY', lots: 1, price: 27650, fee: 40, time: T('2026-11-07') });
  const id = F.getState().trades[0].id;
  feed([{ id: 'f1', broker: 'yuanta-fut', kind: 'fut', date: '2026-11-06', time: '09:15', contract: 'TX', month: '202611', side: 'BUY', lots: 1, price: 27650, fee: 50, tax: 111 }]);
  const m = I.matchExisting(I.pending());
  assert.deepEqual(m, { f1: { kind: 'fut', id } });
  const r = I.importMany(I.pending(), null, m);
  assert.deepEqual([r.ok, r.fixed], [0, 1]);
  const t = F.getState().trades[0];
  assert.deepEqual([F.getState().trades.length, t.fee, t.tax, t.src, t.time], [1, 50, 111, 'inbox:yuanta-fut', T('2026-11-06', '09:15')]);
});

// ── 資料來源解析與快取 ──
test('歷史匯率解析：即期買賣取中間價，沒有即期用現金；依日期排序', () => {
  assert.deepEqual(A.parseFxHistory([
    { date: '2026-11-03', spot_buy: 32.72, spot_sell: 32.82, cash_buy: 32.37, cash_sell: 33.04 },
    { date: '2026-11-02', spot_buy: -1, spot_sell: -1, cash_buy: 32, cash_sell: 33 },
    { date: '2026-11-04', spot_buy: 0, spot_sell: 0, cash_buy: 0, cash_sell: 0 },
  ]).map(r => [r.date, +r.rate.toFixed(3)]), [['2026-11-02', 32.5], ['2026-11-03', 32.77]]);
});

test('加密歷史：Binance 日線解析；近期用主要來源、較早的日期用另一個來源補', () => {
  const k = A.parseBinanceKlines([[Date.parse('2025-01-01T00:00:00Z'), '1', '2', '0.5', '94000.5', '10'], [Date.parse('2025-01-02T00:00:00Z'), '1', '2', '0.5', '0', '10']]);
  assert.deepEqual(k, [{ date: '2025-01-01', close: 94000.5 }]);
  const cg = [{ date: '2026-01-02', close: 5 }, { date: '2026-01-03', close: 6 }];
  const bn = [{ date: '2025-12-31', close: 1 }, { date: '2026-01-01', close: 2 }, { date: '2026-01-02', close: 99 }];
  assert.deepEqual(A.mergeHistory(cg, bn).map(r => r.close), [1, 2, 5, 6]);
  assert.deepEqual(A.mergeHistory([], bn), bn);
});

test('個股歷史價快取：存取往返；超過 40 檔丟掉最久沒更新的', () => {
  S.setHistCache('AAPL', '2026-01-01', [{ date: '2026-01-02', close: 100 }], '2026-11-12');
  assert.deepEqual(S.getHistCache('AAPL'), { day: '2026-11-12', from: '2026-01-01', rows: [{ date: '2026-01-02', close: 100 }] });
  assert.equal(S.getHistCache('NOPE'), null);
  for (let i = 0; i < 41; i++) S.setHistCache('S' + i, '2026-01-01', [], '2026-11-' + String(13 + (i % 10)).padStart(2, '0'));
  assert.equal(S.getHistCache('AAPL'), null);                            // 最舊的（11-12）被丟掉
  assert.ok(S.getHistCache('S40'));
});

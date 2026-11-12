/* 2026-11 review：補登交易重算已實現、當日損益含今日賣出／平倉、期貨現金重算、報酬率分母、重建保留現金紀錄、ATH */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, F = App.Futures, U = App.Util;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');
const buy = (sym, shares, price, time, market) => C.addTransaction({ symbolInput: sym, type: 'BUY', shares, price, fee: 0, market: market || 'tse', time });
const sell = (sym, shares, price, time, market) => C.addTransaction({ symbolInput: sym, type: 'SELL', shares, price, fee: 0, market: market || 'tse', time });
const NOW = () => Date.now();

// ── 補登過去的買入／配股 → 之後的賣出已實現損益要重算 ──
test('補登較早的買入：已存在的賣出重算已實現', () => {
  buy('2330', 100, 500, T('2026-02-01')); sell('2330', 50, 600, T('2026-03-01'));
  buy('2330', 100, 300, T('2026-01-01'));                       // 均價變 400
  assert.deepEqual(S.getRealized().map(r => r.realizedPnl), [(600 - 400) * 50]);
});
test('補登較早的配股：已存在的賣出重算已實現', () => {
  buy('2330', 100, 500, T('2026-02-01')); sell('2330', 50, 600, T('2026-03-01'));
  C.addStockDividend({ symbolInput: '2330', shares: 100, date: '2026-02-15' });   // 均價變 250
  assert.deepEqual(S.getRealized().map(r => r.realizedPnl), [(600 - 250) * 50]);
});

// ── 股票當日損益：今日賣出的部分也要算（昨收 → 賣出價）──
const dayPnl = () => C.buildSummary(C.buildPositions()).dayPnl;
test('今日全部賣出：當日損益 =（賣價 − 昨收）× 股數', () => {
  buy('2330', 100, 500, T('2026-02-01')); sell('2330', 100, 620, NOW());
  S.setPrices({ '2330': { price: 630, dailyChange: 30, prevClose: 600 } });
  assert.equal(dayPnl(), 2000);
});
test('今日部分賣出：剩餘用現價、賣出用賣價', () => {
  buy('2330', 100, 500, T('2026-02-01')); sell('2330', 40, 620, NOW());
  S.setPrices({ '2330': { price: 630, dailyChange: 30, prevClose: 600 } });
  assert.equal(dayPnl(), 60 * 30 + 40 * 20);
  assert.equal(C.buildPositions()[0].dayPnl, 2600);
});
test('當沖（今日買、今日賣）：賣價 − 買價', () => {
  buy('2330', 10, 610, NOW()); sell('2330', 10, 625, NOW() + 1);
  S.setPrices({ '2330': { price: 630, dailyChange: 30, prevClose: 600 } });
  assert.equal(dayPnl(), 150);
});
test('今日買 50、賣 120（原有 100）：先賣昨日持股', () => {
  buy('2330', 100, 500, T('2026-02-01')); buy('2330', 50, 610, NOW()); sell('2330', 120, 620, NOW() + 1);
  S.setPrices({ '2330': { price: 630, dailyChange: 30, prevClose: 600 } });
  assert.equal(dayPnl(), 100 * 20 + 20 * 10 + 30 * 20);
});
test('今日沒有賣出：與原本相同（昨日持股用漲跌、今日買入用買價）', () => {
  buy('2330', 100, 500, T('2026-02-01')); buy('2330', 50, 610, NOW());
  S.setPrices({ '2330': { price: 630, dailyChange: 30, prevClose: 600 } });
  assert.equal(dayPnl(), 100 * 30 + 50 * 20);
});

// ── 期貨當日損益：今日平倉／轉倉也要算 ──
const futSeed = () => { S.setCashAccounts([{ id: 'm', name: 'm', currency: 'TWD', balance: 1000000 }]); S.setFutures({ accountId: 'm' }); };
const ft = (month, side, lots, price, time) => F.addTrade({ contract: 'TX', month, side, lots, price, fee: 0, tax: 0, time });
const futDay = () => F.summary(null, S.getPrices(), 0, 0).dayPnl;
test('期貨：昨日部位今日平倉 =（平倉價 − 昨結算）', () => {
  futSeed(); ft('202612', 'BUY', 1, 40000, T('2026-08-01')); ft('202612', 'SELL', 1, 41000, NOW());
  S.setPrices({ 'FUT:TX@202612': { price: 41100, dailyChange: 600, prevClose: 40500, date: U.isoDate() } });
  assert.equal(futDay(), 500 * 200);
});
test('期貨：今日轉倉 = 近月（平倉價 − 昨結算）＋ 遠月（現價 − 新倉價）', () => {
  futSeed(); ft('202612', 'BUY', 1, 40000, T('2026-08-01'));
  F.rollover({ contract: 'TX', month: '202612', toMonth: '202701', lots: 1, closePrice: 41000, openPrice: 41200, time: NOW() });
  S.setPrices({ 'FUT:TX@202612': { price: 41100, dailyChange: 600, prevClose: 40500, date: U.isoDate() }, 'FUT:TX@202701': { price: 41300, dailyChange: 650, prevClose: 40650, date: U.isoDate() } });
  assert.equal(futDay(), 500 * 200 + 100 * 200);
});
test('期貨：當沖 = 平倉價 − 開倉價；昨結算報價是舊的（date < 今天）→ 以該價為昨結算', () => {
  futSeed(); ft('202612', 'BUY', 1, 41000, NOW()); ft('202612', 'SELL', 1, 41100, NOW() + 1);
  S.setPrices({ 'FUT:TX@202612': { price: 41100, dailyChange: 600, prevClose: 40500, date: U.isoDate() } });
  assert.equal(futDay(), 100 * 200);
  resetStore(); futSeed(); ft('202612', 'BUY', 1, 40000, T('2026-08-01')); ft('202612', 'SELL', 1, 41000, NOW());
  S.setPrices({ 'FUT:TX@202612': { price: 40500, dailyChange: 100, prevClose: 40400, date: '2026-01-01' } });
  assert.equal(futDay(), 500 * 200);
});

// ── 期貨：改／刪較早的交易 → 之後平倉的現金效果要重算，餘額 = 入金 + 已實現淨額 ──
test('期貨：平倉後修改開倉價 → 保證金餘額跟著重算', () => {
  futSeed(); const o = ft('202612', 'BUY', 1, 40000, T('2026-08-01')); ft('202612', 'SELL', 1, 41000, T('2026-09-01'));
  assert.equal(S.getCashAccounts()[0].balance, 1200000);
  F.updateTrade(o.trade.id, { price: 40500, tax: 0 });
  assert.equal(S.getCashAccounts()[0].balance, 1000000 + F.summary(null, {}, 0, 0).realizedNet);
  assert.equal(S.getCashAccounts()[0].balance, 1100000);
});
test('期貨：刪掉開倉 → 原平倉變成新開倉，已入帳的損益沖回；補登較早的開倉 → 平倉損益入帳', () => {
  futSeed(); const o = ft('202612', 'BUY', 1, 40000, T('2026-08-01')); ft('202612', 'SELL', 1, 41000, T('2026-09-01'));
  F.deleteTrade(o.trade.id);
  assert.equal(S.getCashAccounts()[0].balance, 1000000);
  ft('202612', 'BUY', 1, 40800, T('2026-08-15'));
  assert.equal(S.getCashAccounts()[0].balance, 1000000 + 200 * 200);
});

// ── 報酬率分母：含期貨保證金本金（損益含期貨時，分母不能只有股票成本）──
test('capitalBase = 股票成本 + 期貨入金（餘額 − 已實現淨額）；沒連結帳戶 → 只有股票成本', () => {
  assert.equal(C.capitalBase({ totalCostBasisTwd: 1000, futEquityTwd: 700, futUnrealizedTwd: 100, futRealizedPnl: 200 }), 1000 + 400);
  assert.equal(C.capitalBase({ totalCostBasisTwd: 1000, futEquityTwd: 100, futUnrealizedTwd: 100, futRealizedPnl: -300 }), 1000);
  assert.equal(C.capitalBase({ totalCostBasisTwd: 1000 }), 1000);
});
test('scopedStats / 快照報酬率用 capitalBase', () => {
  S.setSnapshots([
    { date: '2026-09-30', totalPnl: 0, totalCostBasisTwd: 1000, futEquityTwd: 1000, futUnrealizedTwd: 0, futRealizedPnl: 0 },
    { date: '2026-10-31', totalPnl: 400, totalCostBasisTwd: 1000, futEquityTwd: 1300, futUnrealizedTwd: 300, futRealizedPnl: 0 },
  ]);
  assert.equal(C.scopedStats('2026-10-01', '2026-10-31', ['day']).periodReturnPct, 400 / 2000 * 100);
});

// ── 重建歷史：保留已記錄的現金／負債，不再全部用「目前值」抹平 ──
test('rebuildSnapshots：有紀錄的日子保留當天現金／負債；沒紀錄的往前沿用、標記 est', () => {
  S.setCashAccounts([{ id: 'c', name: '台幣', currency: 'TWD', balance: 900 }]);
  buy('2330', 1, 100, T('2026-10-01'));
  S.setSnapshots([
    { date: '2026-10-02', cashAccountsTwd: 500, liabilitiesTwd: 50, netWorth: 1 },
    { date: '2026-10-04', cashAccountsTwd: 700, liabilitiesTwd: 0, netWorth: 1 },
  ]);
  C.rebuildSnapshots({ '2330': [{ date: '2026-10-01', close: 100 }, { date: '2026-10-03', close: 120 }] }, 30, {});
  const by = {}; for (const s of S.getSnapshots()) by[s.date] = s;
  assert.deepEqual([by['2026-10-01'].cashAccountsTwd, by['2026-10-01'].est], [500, 1]);   // 最早紀錄之前 → 用最早那筆
  assert.deepEqual([by['2026-10-02'].cashAccountsTwd, by['2026-10-02'].liabilitiesTwd, by['2026-10-02'].est], [500, 50, undefined]);
  assert.deepEqual([by['2026-10-03'].cashAccountsTwd, by['2026-10-03'].liabilitiesTwd, by['2026-10-03'].est], [500, 50, 1]);
  assert.equal(by['2026-10-03'].netWorth, 120 + 500 - 50);
  assert.equal(by['2026-10-04'].netWorth, 120 + 700);
  // 再重建一次：est 的日子不會被當成「有紀錄」
  C.rebuildSnapshots({ '2330': [{ date: '2026-10-01', close: 100 }, { date: '2026-10-03', close: 120 }] }, 30, {});
  const again = S.getSnapshots().find(s => s.date === '2026-10-03');
  assert.deepEqual([again.cashAccountsTwd, again.est], [500, 1]);
});
test('rebuildSnapshots：完全沒有紀錄 → 仍用目前現金（與舊行為相同）', () => {
  S.setCashAccounts([{ id: 'c', name: '台幣', currency: 'TWD', balance: 900 }]);
  buy('2330', 1, 100, T('2026-10-01'));
  C.rebuildSnapshots({ '2330': [{ date: '2026-10-01', close: 100 }] }, 30, {});
  assert.equal(S.getSnapshots()[0].cashAccountsTwd, 900);
});
test('rebuildSnapshots：期貨權益數 = 入金 + 當時已實現 + 當時未平倉（不是用目前餘額）', () => {
  futSeed();
  ft('202612', 'BUY', 1, 40000, T('2026-08-01')); ft('202612', 'SELL', 1, 41000, T('2026-08-10'));   // 已實現 +200000 → 餘額 1,200,000
  C.rebuildSnapshots({}, 30, { 'TX@202612': [{ date: '2026-08-01', close: 40000 }, { date: '2026-08-05', close: 40300 }] });
  const by = {}; for (const s of S.getSnapshots()) by[s.date] = s;
  assert.equal(by['2026-08-05'].futEquityTwd, 1000000 + 300 * 200);
  assert.equal(by['2026-08-10'].futEquityTwd, 1200000);
});

// ── 區間獲利之最：含息（與報表的本期損益一致）──
test('tradingStats 區間之最含股息', () => {
  buy('2330', 100, 500, T('2026-01-05'));
  S.setSnapshots([
    { date: '2026-01-05', totalPnl: 0 }, { date: '2026-01-06', totalPnl: 100 }, { date: '2026-01-07', totalPnl: 150 }, { date: '2026-01-08', totalPnl: 180 },
  ]);
  C.addDividend({ symbolInput: '2330', market: 'tse', amount: 500, date: '2026-01-08' });
  assert.deepEqual(C.tradingStats().period.all.day.best, { date: '2026-01-08', amount: 530 });
});

// ── ATH ──
test('athInfo：歷史最高淨資產（含今天的即時值）、距離高點 %、是否今天創高', () => {
  S.setSnapshots([{ date: '2026-01-01', netWorth: 100 }, { date: '2026-02-01', netWorth: 300 }, { date: '2026-03-01', netWorth: 240 }]);
  const a = C.athInfo(240, '2026-03-01');
  assert.deepEqual([a.value, a.date, a.isToday], [300, '2026-02-01', false]);
  assert.ok(Math.abs(a.drawdownPct - (-20)) < 1e-9);
  const b = C.athInfo(350, '2026-03-02');
  assert.deepEqual([b.value, b.date, b.isToday, b.drawdownPct], [350, '2026-03-02', true, 0]);
  // 突破時帶出被突破的前高與超越幅度
  assert.deepEqual([b.prev.value, b.prev.date], [300, '2026-02-01']);
  assert.ok(Math.abs(b.prev.abovePct - 50 / 3) < 1e-9);
  assert.equal(C.athInfo(50, '2026-01-01', []).prev, null);   // 沒有任何歷史 → 沒有前高
  assert.equal(C.athInfo(0, '2026-03-02', []), null);
});

test('CSV：快照 est 標記進出備份', () => {
  S.setSnapshots([{ date: '2026-09-01', marketValue: 1, netWorth: 5, cashAccountsTwd: 1, est: 1 }, { date: '2026-09-02', marketValue: 1, netWorth: 6, cashAccountsTwd: 2 }]);
  const csv = App.Csv.exportCsv();
  resetStore();
  App.Csv.importCsv(csv);
  assert.deepEqual(S.getSnapshots().map(x => x.est), [1, undefined]);
});

// ── 歷史股價抓取失敗要能分辨（不可把「抓失敗」當成「沒有資料」拿成本去重建，會把損益歷史洗成 0）──
test('fetchTwHistory：請求失敗或 FinMind 回額度用盡 → 記在 _failed；真的沒資料不算失敗', async () => {
  const A = App.Api;
  const mk = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  global.fetch = async url => {
    if (url.includes('data_id=2330')) return mk({ status: 200, data: [{ date: '2026-10-01', close: 100 }] });
    if (url.includes('data_id=0050')) return mk({ status: 402, msg: 'Requests reach the upper limit' });
    if (url.includes('data_id=7866')) return mk({ status: 200, data: [] });
    throw new Error('network');
  };
  try {
    const out = await A.fetchTwHistory(['2330', '0050', '7866', '2881'], '2026-10-01');
    assert.deepEqual(Object.keys(out).sort(), ['0050', '2330', '2881', '7866']);
    assert.equal(out['2330'].length, 1);
    assert.deepEqual((out._failed || []).slice().sort(), ['0050', '2881']);
  } finally { delete global.fetch; }
});

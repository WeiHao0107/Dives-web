/* App.Futures — 台指期：重播、到期日、指標、交易與轉倉。spec: docs/superpowers/specs/2026-09-17-futures-design.md */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const F = App.Futures, S = App.Store;
beforeEach(() => resetStore());
const T = iso => Date.parse(iso + 'T12:00:00+08:00');
const tr = (o) => Object.assign({ id: Math.random().toString(36).slice(2), contract: 'TX', side: 'BUY', fee: 0, tax: 0 }, o);

test('expiryOf：第三個星期三', () => {
  assert.equal(F.expiryOf('202610'), '2026-10-21');
  assert.equal(F.expiryOf('202611'), '2026-11-18');
  assert.equal(F.expiryOf('202609'), '2026-09-16');
});

test('upcomingMonths：從指定日起未到期的 n 個月份', () => {
  assert.deepEqual(F.upcomingMonths('2026-09-17', 3), ['202610', '202611', '202612']); // 202609 已於 9/16 到期
  assert.deepEqual(F.upcomingMonths('2026-09-16', 2), ['202609', '202610']);          // 到期日當天仍列
});

test('taxOf：契約值 × 十萬分之二，存到小數 2 位', () => {
  assert.equal(F.taxOf('TX', 46764, 2), 374.11);   // 46764×200×2×0.00002 = 374.112
  assert.equal(F.taxOf('TX', 46764, 1), 187.06);
  assert.equal(F.taxOf('MTX', 45000, 1), 45);
});

test('replay：開倉加碼均價、部分平倉、反手、空單', () => {
  const t = [
    tr({ month: '202610', lots: 1, price: 45000, time: T('2026-08-01') }),
    tr({ month: '202610', lots: 1, price: 47000, time: T('2026-08-05') }),            // 均 46000
    tr({ month: '202610', side: 'SELL', lots: 1, price: 46500, time: T('2026-08-10') }), // 平 1 口 +500×200
    tr({ month: '202610', side: 'SELL', lots: 3, price: 46200, time: T('2026-08-12') }), // 平剩 1 口 +200×200，反手空 2 口 @46200
    tr({ month: '202610', lots: 1, price: 46000, time: T('2026-08-15') }),             // 空單回補 1 口：(46200−46000)×200 = +40000
  ];
  const { positions, events } = F.replay(t);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].netLots, -1);
  assert.equal(positions[0].avgEntry, 46200);
  assert.equal(positions[0].expiry, '2026-10-21');
  assert.deepEqual(events.map(e => [e.lots, e.realizedPnl]), [[1, 100000], [1, 40000], [1, 40000]]);
  assert.equal(events[0].avgEntry, 46000);
});

test('replay：不同月份 / 合約各自獨立', () => {
  const t = [
    tr({ month: '202610', lots: 2, price: 45000, time: T('2026-08-01') }),
    tr({ contract: 'MTX', month: '202610', lots: 1, price: 45000, time: T('2026-08-02') }),
    tr({ month: '202611', lots: 1, price: 45500, time: T('2026-08-03') }),
  ];
  const { positions } = F.replay(t);
  assert.deepEqual(positions.map(p => p.key), ['MTX@202610', 'TX@202610', 'TX@202611']);
});

test('getState：預設值合併、trades 預設空陣列', () => {
  const st = F.getState();
  assert.equal(st.margin.TX.init, 701000);
  assert.equal(st.feePerLot.MTX, 30);
  assert.deepEqual(st.trades, []);
  S.setFutures({ margin: { TX: { init: 1, maint: 1 } } });
  const st2 = F.getState();
  assert.equal(st2.margin.TX.init, 1);
  assert.equal(st2.margin.MTX.init, 175250); // 沒給的合約用預設
});

test('summary：權益數、風險指標、追繳／砍倉距離、槓桿、曝險、今日損益', () => {
  S.setCashAccounts([{ id: 'm1', name: '期貨保證金', currency: 'TWD', balance: 2150000 }]);
  S.setFutures({ accountId: 'm1', trades: [tr({ id: 'a', month: '202610', lots: 2, price: 45900, fee: 120, tax: 367.2, time: T('2026-08-20') })] });
  const prices = { 'FUT:TX@202610': { price: 46764, dailyChange: 305, prevClose: 46459 } };
  const s = F.summary(null, prices, 8457115);       // 淨資產（不含期貨未平倉）
  assert.equal(s.unrealized, (46764 - 45900) * 200 * 2);      // 345,600
  assert.equal(s.equity, 2150000 + 345600);
  assert.equal(s.initTotal, 1402000);
  assert.equal(s.maintTotal, 1076000);
  assert.ok(Math.abs(s.risk - 2495600 / 1402000) < 1e-9);
  assert.equal(s.riskLevel, 'safe');
  assert.equal(s.sens, 400);
  assert.ok(Math.abs(s.callPts - (2495600 - 1076000) / 400) < 1e-9);          // 3,549
  assert.ok(Math.abs(s.liqPts - (2495600 - 0.25 * 1402000) / 400) < 1e-9);    // 5,362.75
  assert.equal(s.notional, 46764 * 400);
  assert.ok(Math.abs(s.accLev - 46764 * 400 / 2495600) < 1e-9);
  assert.ok(Math.abs(s.exposure - 46764 * 400 / (8457115 + 345600)) < 1e-9);
  assert.equal(s.dayPnl, 305 * 400);
  assert.equal(s.fees, 487.2);
  assert.equal(s.realizedNet, -487.2);
  assert.equal(s.cumulative, 345600 - 487.2);
  assert.equal(s.lots, 2);
  assert.equal(s.positions[0].pts, 864);
});

test('summary：無報價以均價計（未平倉 0）；無部位 → risk/accLev null、riskLevel null', () => {
  S.setFutures({ trades: [tr({ month: '202610', lots: 1, price: 45000, time: T('2026-08-20') })] });
  const s = F.summary(null, {}, null);
  assert.equal(s.unrealized, 0);
  assert.equal(s.notional, 45000 * 200);
  assert.equal(s.exposure, null);
  const empty = F.summary({ trades: [], margin: F.DEFAULTS.margin }, {}, 100);
  assert.equal(empty.risk, null);
  assert.equal(empty.riskLevel, null);
  assert.equal(empty.accLev, null);
});

test('summary：淨空單 → callPts 為負（再漲才追繳）', () => {
  S.setCashAccounts([{ id: 'm1', name: 'x', currency: 'TWD', balance: 1000000 }]);
  S.setFutures({ accountId: 'm1', trades: [tr({ month: '202610', side: 'SELL', lots: 1, price: 46000, time: T('2026-08-20') })] });
  const s = F.summary(null, { 'FUT:TX@202610': { price: 46500, dailyChange: 100, prevClose: 46400 } }, null);
  assert.equal(s.unrealized, -100000);
  assert.equal(s.dayPnl, -20000);
  assert.ok(s.callPts < 0);
});

test('records：轉倉兩筆合併一列（價差、實現、費用）', () => {
  const rid = 'r1';
  const trades = [
    tr({ id: 'o', month: '202609', lots: 2, price: 45000, time: T('2026-08-01') }),
    tr({ id: 'c', month: '202609', side: 'SELL', lots: 2, price: 46300, fee: 120, tax: 370, time: T('2026-09-16'), rollId: rid }),
    tr({ id: 'n', month: '202610', lots: 2, price: 46215, fee: 120, tax: 370, time: T('2026-09-16') + 1, rollId: rid }),
  ];
  const rec = F.records(trades);
  assert.equal(rec.length, 2);
  assert.equal(rec[0].kind, 'roll');
  assert.equal(rec[0].from, '202609'); assert.equal(rec[0].to, '202610');
  assert.equal(rec[0].spread, -85);
  assert.equal(rec[0].realized, (46300 - 45000) * 200 * 2);
  assert.equal(rec[0].fees, 980);
  assert.equal(rec[0].lots, 2);
  assert.equal(rec[1].kind, 'trade'); assert.equal(rec[1].closing, false);
});

test('addTrade：自動期交稅、cash = 已實現−費用 套到保證金帳戶；deleteTrade 沖回', () => {
  S.setCashAccounts([{ id: 'm1', name: '期貨保證金', currency: 'TWD', balance: 1000000 }]);
  S.setFutures({ accountId: 'm1' });
  const a = F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 2, price: 45900, fee: 120, time: T('2026-08-20') });
  assert.equal(a.ok, true);
  assert.equal(a.trade.tax, 367.2);
  assert.equal(a.trade.cash, -487.2);
  assert.equal(S.getCashAccounts()[0].balance, 1000000 - 487.2);
  const c = F.addTrade({ contract: 'TX', month: '202610', side: 'SELL', lots: 1, price: 46900, fee: 60, time: T('2026-09-01') });
  assert.equal(c.realized, 200000);
  assert.equal(c.trade.cash, 200000 - 60 - 187.6);
  assert.ok(Math.abs(S.getCashAccounts()[0].balance - (1000000 - 487.2 + 200000 - 247.6)) < 1e-6);
  F.deleteTrade(c.trade.id);
  assert.ok(Math.abs(S.getCashAccounts()[0].balance - (1000000 - 487.2)) < 1e-6);
  assert.equal(F.getState().trades.length, 1);
});

test('addTrade：驗證（合約／月份／口數／價格）；未連結帳戶不動現金', () => {
  assert.equal(F.addTrade({ contract: 'XX', month: '202610', side: 'BUY', lots: 1, price: 1 }).ok, false);
  assert.equal(F.addTrade({ contract: 'TX', month: '2026-10', side: 'BUY', lots: 1, price: 1 }).ok, false);
  assert.equal(F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 0.5, price: 1 }).ok, false);
  assert.equal(F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 1, price: 0 }).ok, false);
  S.setCashAccounts([{ id: 'm1', name: 'x', currency: 'TWD', balance: 5 }]);
  assert.equal(F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 1, price: 45000, fee: 60 }).ok, true);
  assert.equal(S.getCashAccounts()[0].balance, 5); // 未連結
});

test('updateTrade：沖回舊 cash、套用新 cash；改價重算稅', () => {
  S.setCashAccounts([{ id: 'm1', name: 'x', currency: 'TWD', balance: 100000 }]);
  S.setFutures({ accountId: 'm1' });
  const a = F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 1, price: 45000, fee: 60, time: T('2026-08-20') });
  const bal1 = S.getCashAccounts()[0].balance;                         // 100000 − 60 − 180
  const u = F.updateTrade(a.trade.id, { price: 46000, fee: 100 });
  assert.equal(u.ok, true);
  assert.equal(u.trade.tax, 184);
  assert.ok(Math.abs(S.getCashAccounts()[0].balance - (100000 - 100 - 184)) < 1e-6);
  assert.notEqual(S.getCashAccounts()[0].balance, bal1);
});

test('rollover：兩筆同 rollId、已實現、價差、帳戶變動；口數超過持有 → 拒絕', () => {
  S.setCashAccounts([{ id: 'm1', name: 'x', currency: 'TWD', balance: 2150000 }]);
  S.setFutures({ accountId: 'm1', feePerLot: { TX: 60 } });
  F.addTrade({ contract: 'TX', month: '202610', side: 'BUY', lots: 2, price: 45900, fee: 0, tax: 0, time: T('2026-08-20') });
  const bad = F.rollover({ contract: 'TX', month: '202610', toMonth: '202611', lots: 3, closePrice: 46764, openPrice: 46690, time: T('2026-10-15') });
  assert.equal(bad.ok, false);
  const r = F.rollover({ contract: 'TX', month: '202610', toMonth: '202611', lots: 2, closePrice: 46764, openPrice: 46690, time: T('2026-10-15') });
  assert.equal(r.ok, true);
  assert.equal(r.realized, 345600);
  assert.equal(r.spread, -74);
  assert.equal(r.closeTrade.rollId, r.openTrade.rollId);
  assert.equal(r.closeTrade.side, 'SELL'); assert.equal(r.openTrade.side, 'BUY');
  assert.equal(r.closeTrade.fee, 120); assert.equal(r.openTrade.fee, 120);
  const { positions } = F.replay(F.getState().trades);
  assert.deepEqual(positions.map(p => [p.month, p.netLots, p.avgEntry]), [['202611', 2, 46690]]);
  const tax = F.taxOf('TX', 46764, 2) + F.taxOf('TX', 46690, 2);
  assert.ok(Math.abs(S.getCashAccounts()[0].balance - (2150000 + 345600 - 240 - tax)) < 1e-6);
  assert.equal(F.rollover({ contract: 'TX', month: '202611', toMonth: '202610', lots: 1, closePrice: 1, openPrice: 1 }).ok, false); // 月份須晚於
});

test('parseTaifexMargins：期交所保證金表 → 三合約（排除客製化）與更新日期', () => {
  const html = `<html><body><h3>股價指數類</h3><table><thead><tr><th>商品別</th><th>結算保證金</th><th>維持保證金</th><th>原始保證金</th></tr></thead>
    <tbody><tr><td>臺股期貨</td><td>519,000</td><td>538,000</td><td>701,000</td></tr>
    <tr><td>小型臺指</td><td>129,750</td><td>134,500</td><td>175,250</td></tr>
    <tr><td>客製化小型臺指期貨</td><td>129,750</td><td>134,500</td><td>175,250</td></tr>
    <tr><td>微型臺指期貨</td><td>25,950</td><td>26,900</td><td>35,050</td></tr>
    <tr><td>電子期貨</td><td>1</td><td>2</td><td>3</td></tr></tbody></table>
    <p>更新日期：2026/08/12</p></body></html>`;
  const r = F.parseTaifexMargins(html);
  assert.deepEqual(r.margin, { TX: { init: 701000, maint: 538000 }, MTX: { init: 175250, maint: 134500 }, TMF: { init: 35050, maint: 26900 } });
  assert.equal(r.date, '2026/08/12');
  assert.equal(F.parseTaifexMargins('<html>nothing</html>'), null);
});

test('parseFuturesDaily：只取指定月份日盤、結算價優先、升冪', () => {
  const rows = [
    { date: '2026-09-16', contract_date: '202610', trading_session: 'position', close: 46078, settlement_price: 46060 },
    { date: '2026-09-15', contract_date: '202610', trading_session: 'position', close: 45740, settlement_price: 45727 },
    { date: '2026-09-16', contract_date: '202610', trading_session: 'after_market', close: 46200, settlement_price: 0 },
    { date: '2026-09-16', contract_date: '202609/202610', trading_session: 'position', close: -85, settlement_price: 0 },
    { date: '2026-09-16', contract_date: '202611', trading_session: 'position', close: 46300, settlement_price: 46290 },
    { date: '2026-09-17', contract_date: '202610', trading_session: 'position', close: 46445, settlement_price: 0 },
  ];
  assert.deepEqual(F.parseFuturesDaily(rows, '202610'), [{ date: '2026-09-15', close: 45727 }, { date: '2026-09-16', close: 46060 }, { date: '2026-09-17', close: 46445 }]);
});

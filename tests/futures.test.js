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

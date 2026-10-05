/* 台股盤中即時（MIS）：價格挑選與 jina 包裝解析 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { App } = require('./harness');
const A = App.Api;

test('有成交價 z → 用 z，漲跌對昨收', () => {
  assert.deepEqual(A.misQuote({ z: '41.6600', y: '39.5800', b: '41.6500_41.64_', a: '41.6600_', o: '40.0000' }),
    { price: 41.66, dailyChange: 41.66 - 39.58, prevClose: 39.58 });
});

test('z 為 "-"（當下無成交）→ 用最佳買價，不退回開盤價', () => {
  const q = A.misQuote({ z: '-', pz: '-', y: '2500.0000', b: '2570.0000_2565.0000_', a: '2575.0000_2580.0000_', o: '2540.0000' });
  assert.equal(q.price, 2570);
  assert.equal(q.dailyChange, 70);
});

test('無買價 → 賣價 → 開盤 → 昨收', () => {
  assert.equal(A.misQuote({ z: '-', b: '-', a: '100.5000_', o: '99', y: '98' }).price, 100.5);
  assert.equal(A.misQuote({ z: '-', b: '-', a: '-', o: '99', y: '98' }).price, 99);
  assert.equal(A.misQuote({ z: '-', b: '-', a: '-', o: '-', y: '98' }).price, 98);
  assert.equal(A.misQuote({ z: '-', y: '-' }), null);
});

test('unwrapJina：從 r.jina.ai 回應取出原始 JSON', () => {
  const raw = 'Title: \n\nURL Source: https://x\n\nMarkdown Content:\n{"msgArray":[{"c":"2330"}]}';
  assert.deepEqual(JSON.parse(A.unwrapJina(raw)), { msgArray: [{ c: '2330' }] });
  assert.equal(A.unwrapJina('{"a":1}'), '{"a":1}');
});

test('keepNewer：今天的即時價不被前一日收盤覆蓋；同日或更新則覆蓋', () => {
  const today = { price: 2570, date: '2026-10-05' }, prev = { price: 2500, date: '2026-10-02' };
  assert.equal(A.keepNewer(today, prev), today);
  assert.equal(A.keepNewer(prev, today), today);
  assert.equal(A.keepNewer({ price: 1 }, prev), prev);   // 舊版沒有 date → 照舊覆蓋
  assert.equal(A.keepNewer(today, null), today);
});

/* 走勢圖動態 Y 軸：不強制從 0 起、刻度為好讀的整數倍，標籤不重複 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { App } = require('./harness');
const Ch = App.Charts;

test('窄幅波動（900萬~1000萬）→ 不從 0 起，刻度包住資料、步距好讀', () => {
  const t = Ch.niceRange(9.3e6, 9.9e6, 4);
  assert.ok(t[0] > 0 && t[0] <= 9.3e6);
  assert.ok(t[t.length - 1] >= 9.9e6);
  const step = t[1] - t[0];
  assert.ok([1, 2, 2.5, 5].some(m => Math.abs(step / Math.pow(10, Math.floor(Math.log10(step))) - m) < 1e-9), 'step ' + step);
  assert.ok(t.length >= 3 && t.length <= 7);
});

test('資料靠近 0（10萬~100萬）→ 從 0 起', () => {
  assert.equal(Ch.niceRange(1e5, 1e6, 4)[0], 0);
});

test('含負值 → 正常跨 0', () => {
  const t = Ch.niceRange(-3e5, 8e5, 4);
  assert.ok(t[0] <= -3e5 && t.includes(0));
});

test('單一值 / 全相同 → 仍有上下刻度', () => {
  const t = Ch.niceRange(5e6, 5e6, 4);
  assert.ok(t[0] < 5e6 && t[t.length - 1] > 5e6);
});

test('axisLabels：依步距決定小數位，不會出現重複標籤', () => {
  const t = Ch.niceRange(1.0e4, 1.6e4, 4);   // 步距 < 1萬 → 要有小數
  const ls = Ch.axisLabels(t);
  assert.equal(new Set(ls).size, ls.length, ls.join(' '));
  assert.deepEqual(Ch.axisLabels([9000000, 9500000, 10000000]), ['900萬', '950萬', '1000萬']);
  assert.deepEqual(Ch.axisLabels([100000000, 125000000, 150000000]), ['1億', '1.25億', '1.5億']);
  assert.deepEqual(Ch.axisLabels([0, 2500, 5000]), ['0', '2,500', '5,000']);
});

test('0 刻度顯示 "0" 而非 "0萬"', () => {
  assert.deepEqual(App.Charts.axisLabels([0, 2500000, 5000000]), ['0', '250萬', '500萬']);
});

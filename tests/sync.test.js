/* 雲端同步決策：以「上次同步的雲端版本」判斷，不靠裝置時鐘；兩邊都改 → 衝突（不覆蓋雲端） */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { App } = require('./harness');
const d = o => App.Sync.decide(Object.assign({ remoteTs: 100, last: 100, dirty: false, localTs: 0, hasLocal: true }, o));

test('雲端沒變、本機沒改 → none', () => assert.equal(d({}), 'none'));
test('雲端沒變、本機有改 → push', () => assert.equal(d({ dirty: true }), 'push'));
test('雲端有變、本機沒改 → apply', () => assert.equal(d({ remoteTs: 200 }), 'apply'));
test('雲端有變、本機也改 → conflict（舊分頁不可蓋掉別台的新資料）', () => assert.equal(d({ remoteTs: 200, dirty: true, localTs: 999 }), 'conflict'));
test('本機時鐘超前也不影響判斷', () => assert.equal(d({ remoteTs: 200, localTs: 9e12 }), 'apply'));
test('無雲端 → 有資料就 push', () => { assert.equal(d({ remoteTs: null }), 'push'); assert.equal(d({ remoteTs: null, hasLocal: false }), 'none'); });
test('舊版裝置（沒有 last）→ 沿用時間比較一次', () => {
  assert.equal(d({ last: null, remoteTs: 200, localTs: 100 }), 'apply');
  assert.equal(d({ last: null, remoteTs: 100, localTs: 200 }), 'push');
});

test('整合：雲端被別台更新後，本機舊資料的上傳不覆蓋雲端；本機版本另存、可改用', async () => {
  const S = App.Store, Sy = App.Sync;
  localStorage.clear();
  let gist = null; // { id, files: { name: { content } } }
  global.fetch = async (url, opts = {}) => {
    const m = opts.method || 'GET';
    const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (m === 'GET' && url.endsWith('/gists?per_page=100')) return ok(gist ? [gist] : []);
    if (m === 'GET' && url.includes('/gists/')) return ok(gist);
    if (m === 'POST') { gist = { id: 'g1', files: JSON.parse(opts.body).files }; return ok(gist); }
    if (m === 'PATCH') { gist.files = JSON.parse(opts.body).files; return ok(gist); }
    throw new Error('unexpected ' + m + ' ' + url);
  };
  const remoteTx = () => JSON.parse(JSON.parse(gist.files['dives-portfolio.json'].content).data.dives_transactions);
  try {
    // 本機啟用同步，初次上傳
    S.setTransactions([{ id: 'a', symbol: '2330' }]);
    await Sy.enable('tok');
    assert.deepEqual(remoteTx().map(t => t.id), ['a']);
    // 別台裝置上傳了新交易
    const c = JSON.parse(gist.files['dives-portfolio.json'].content);
    c.updatedAt += 1000; c.data.dives_transactions = JSON.stringify([{ id: 'a' }, { id: 'phone' }]);
    gist.files['dives-portfolio.json'].content = JSON.stringify(c);
    // 本機（沒先拉）改了資料 → 上傳
    S.setTransactions([{ id: 'a' }, { id: 'laptop' }]);
    Sy.markDirty();
    const r = await Sy.pushNow();
    assert.equal(r.conflict, true);
    assert.deepEqual(remoteTx().map(t => t.id), ['a', 'phone']);           // 雲端沒被蓋掉
    assert.deepEqual(S.getTransactions().map(t => t.id), ['a', 'phone']);  // 本機改採雲端
    assert.ok(Sy.conflictInfo());
    // 使用者選擇改用本機版本
    await Sy.useConflictLocal();
    assert.deepEqual(remoteTx().map(t => t.id), ['a', 'laptop']);
    assert.equal(Sy.conflictInfo(), null);
    // 之後正常：本機改 → 直接上傳
    S.setTransactions([{ id: 'a' }, { id: 'laptop' }, { id: 'n' }]); Sy.markDirty();
    assert.equal((await Sy.pushNow()).conflict, false);
    assert.deepEqual(remoteTx().map(t => t.id), ['a', 'laptop', 'n']);
  } finally { delete global.fetch; localStorage.clear(); }
});

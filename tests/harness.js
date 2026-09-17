/* =========================================================================
 * harness.js — 在 Node 載入瀏覽器端的運算模組以供 node:test 測試
 *
 * 原始碼是瀏覽器 <script>（掛在全域 window.App）。此處以 vm.runInThisContext
 * 在真實 global 上執行，並把 window 指向 global、補上最小的 localStorage，
 * 讓 util/store/calc/csv 這些「無 DOM 相依」的核心模組能在 Node 跑起來。
 * ======================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 讓 `window.App = window.App || {}` 與裸寫的 `App` 指向同一物件
global.window = global;

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => { m.clear(); },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
global.localStorage = makeLocalStorage();

const JS_DIR = path.join(__dirname, '..', 'js');
function load(file) {
  const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  vm.runInThisContext(code, { filename: file });
}

// 依相依順序載入（僅運算核心，不含 DOM 相依的 charts/ui/views/app）
['util.js', 'store.js', 'futures.js', 'calc.js', 'csv.js'].forEach(load);

function resetStore() { global.localStorage.clear(); }

module.exports = { App: global.App, resetStore };

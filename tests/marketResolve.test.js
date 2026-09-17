/* meta.market 缺漏/未知（舊備份匯出 unknown、iOS 匯出 normalizer 不認得的市場字串）時，
 * 讀取時依代碼格式補上；否則字母代碼的美股會被當台股：不換匯率、報價走台股來源、顯示名稱。 */
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { App, resetStore } = require('./harness');
const C = App.Calc, S = App.Store, U = App.Util, Csv = App.Csv;

beforeEach(() => resetStore());

test('metaMap：market 為 unknown / 空白 → 依代碼格式補上（字母=美股、數字=台股）', () => {
  S.setMeta([{ code: 'TSLA', name: 'Tesla', market: 'unknown' }, { code: '2330', name: '台積電', market: '' }, { code: 'BTC', name: 'Bitcoin', market: 'crypto' }]);
  const m = S.metaMap();
  assert.equal(m.TSLA.market, U.Market.us);
  assert.equal(m['2330'].market, U.Market.tse);
  assert.equal(m.BTC.market, U.Market.crypto); // 已知市場不動
});

test('舊備份匯入：Market=unknown 或不認得的字串 → 美股仍以匯率換算、持倉市場為 us', () => {
  S.setFxRate(30);
  const csv = ['# TRANSACTIONS', 'Symbol,Market,Type,Shares,Price,Fee,Time',
    'TSLA,unknown,BUY,10,100,0,1700000000000', 'NVDA,nasdaq,BUY,10,100,0,1700000000000'].join('\n');
  assert.equal(Csv.importCsv(csv).ok, true);
  S.setPrices({ TSLA: { price: 100, dailyChange: 0, prevClose: 100 }, NVDA: { price: 100, dailyChange: 0, prevClose: 100 } });
  const pos = C.buildPositions();
  assert.deepEqual(pos.map(p => p.market), [U.Market.us, U.Market.us]);
  const sum = C.buildSummary(pos);
  assert.equal(sum.twMarketValue, 0);
  assert.equal(sum.usMarketValueTwd, 2000 * 30);
});

test('upsertMeta 之後把補上的市場寫回（資料自我修復）', () => {
  S.setMeta([{ code: 'TSLA', name: 'Tesla', market: 'unknown' }]);
  S.upsertMeta([{ code: '0050', name: '元大台灣50', market: 'tse' }]);
  assert.equal(S.getMeta().find(m => m.code === 'TSLA').market, U.Market.us);
});

/* 期貨盤中報價：Yahoo 期貨總表（經 r.jina.ai 的 markdown）解析 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { App } = require('./harness');
const F = App.Futures;

const MD = `*   [](https://tw.stock.yahoo.com/future/WTXV6)
台指期2610

WTXV6 
50,057.00

50,062.00

50,056.00

1387.00

2.85%

56,660

48,671.00

50,097.00

48,671.00

358.36

48,669.00

106,691

10:33:57 
*   [](https://tw.stock.yahoo.com/future/WMTV6)
小型台指2610

WMTV6 
50,056.00

50,059.00

50,057.00

1388.00

2.85%

158,447

48,688.00

50,096.00

48,679.00

358.36

48,669.00

31,660

10:33:58 
*   [](https://tw.stock.yahoo.com/future/WTXZ6)
台指期2612

WTXZ6 
-

-

-

-

-

0

-

-

-

-

48,800.00

12

10:30:00 
*   [](https://tw.stock.yahoo.com/future/WTX%26)
台指期近一

WTX& 
50,057.00
`;

test('parseYahooFutures：各月份成交價＋參考價；"近一" 等連續合約略過', () => {
  const r = F.parseYahooFutures(MD);
  assert.deepEqual(r.TX['202610'], { price: 50057, prevClose: 48669 });
  assert.deepEqual(r.MTX['202610'], { price: 50056, prevClose: 48669 });
  assert.equal(r.TX['202612'], undefined); // 尚無成交 → 不給價
  assert.equal(Object.keys(r.TX).length, 1);
});

test('realtimeQuote：微台用同月份小台、再退大台；漲跌對參考價', () => {
  const r = F.parseYahooFutures(MD);
  assert.deepEqual(F.realtimeQuote(r, 'TMF', '202610'), { price: 50056, dailyChange: 50056 - 48669, prevClose: 48669 });
  assert.equal(F.realtimeQuote(r, 'TX', '202610').dailyChange, 1388);
  delete r.MTX['202610'];
  assert.equal(F.realtimeQuote(r, 'TMF', '202610').price, 50057);
  assert.equal(F.realtimeQuote(r, 'TX', '202611'), null);
});

test('realtimeQuote：大台缺資料 → 用小台；全無 → null', () => {
  const r = { TX: {}, MTX: { '202610': { price: 100, prevClose: 90 } } };
  assert.equal(F.realtimeQuote(r, 'TX', '202610').price, 100);
  assert.equal(F.realtimeQuote({ TX: {}, MTX: {} }, 'MTX', '202610'), null);
});

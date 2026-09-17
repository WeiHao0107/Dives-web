# 期貨（台指期）功能設計

日期：2026-09-17 ／ 目標版本：v137
狀態：使用者已核准（問答 + 畫面原型 v3）

## 1. 目標

使用者做多台指期、長期持有、每月轉倉。App 要能：

1. 記錄期貨部位（大台 TX／小台 MTX／微台 TMF，多空皆可）與轉倉。
2. 算出**風險指標**（權益數 ÷ 原始保證金）、追繳／砍倉還差幾點、**帳戶槓桿**（契約總值 ÷ 權益數）、**整體曝險**（契約總值 ÷ 淨資產）。
3. 保證金帳戶由 app 全程記帳（入出金 + 自動加減平倉損益與費用）。
4. 期貨損益併入淨資產、每日快照、報表與統計。

非目標（第二階段）：盤中報價、歷史頁併入期貨列、XIRR 含期貨。

## 2. 架構：獨立模組（方案 A）

| 檔案 | 責任 |
|------|------|
| `js/futures.js` → `App.Futures` | 純運算：部位重播、權益數、指標、轉倉、到期日、FinMind／期交所資料解析。無 DOM。 |
| `js/views-futures.js` → `App.ViewsFutures` | 資產頁期貨卡、期貨頁、走勢／漲幅／紀錄頁、交易／轉倉／設定表單。 |
| `store.js` | `dives_futures` 讀寫（含預設值合併）、`clearAll`。 |
| `calc.js` | `assetsSummary`／快照／重建歷史／統計／手續費 併入期貨。 |
| `api.js` | FinMind `TaiwanFuturesDaily` 報價與歷史、期交所保證金頁抓取。 |
| `csv.js` | `# FUTURES` 分段 + 設定列。 |
| `sync.js` | `dives_futures` 加入同步。 |
| `app.js` | 刷新報價時一併刷新期貨、每日保證金自動更新、到期／風險提醒、`seedDemo` 加期貨。 |

股票的均價／已實現引擎完全不動。

## 3. 資料模型

```js
dives_futures = {
  accountId: null,                   // 保證金帳戶＝某個台幣現金帳戶 id
  margin: { TX:{init:701000,maint:538000}, MTX:{init:175250,maint:134500}, TMF:{init:35050,maint:26900} },
  marginDate: '2026/08/12',          // 期交所「更新日期」或使用者手改日期
  marginAuto: true,                  // 每日自動抓期交所
  feePerLot: { TX:60, MTX:30, TMF:20 },
  alerts: { expiry: true, risk: true },
  trades: [{ id, contract:'TX'|'MTX'|'TMF', month:'YYYYMM', side:'BUY'|'SELL',
             lots, price, fee, tax, time, rollId?, cash, note? }],
}
```

- `cash`：這筆交易當時對保證金帳戶套用的變動（已實現 − 手續費 − 期交稅）；刪除時精確沖回。
- 乘數 `TX 200 / MTX 50 / TMF 10`；期交稅率 `0.00002`（契約值 × 口數）。
- 報價存在既有 prices cache，key `FUT:TX@202610` → `{price, dailyChange, prevClose, manual?}`。
- 到期日 = 該月第三個星期三。

## 4. 運算（`App.Futures`，純函式）

### 4.1 部位重播 `replay(trades)`
依 time（穩定）排序，以（contract, month）為單位：
- 同方向或空手 → 開倉：`avgEntry` 加權更新、`netLots += lots×dir`。
- 反方向 → 平倉 `closed = min(lots, |netLots|)`：`realized = (price − avgEntry) × mult × closed × posDir`；剩餘口數反手成新倉（均價＝此價）。
- 產出 `positions[]`（netLots ≠ 0：contract, month, netLots, avgEntry, expiry）與 `events[]`（每筆平倉：tradeId, contract, month, lots, price, avgEntry, realizedPnl, fee, tax, time, rollId）。

### 4.2 指標 `summary(state, prices, netWorthExFut)`
```
unrealized  = Σ (mark − avgEntry) × mult × netLots            （mark 無 → 以 avgEntry，即 0）
balance     = 保證金帳戶餘額（未連結 → 0）
equity      = balance + unrealized
initTotal   = Σ |netLots| × margin[c].init ；maintTotal 同理 .maint
risk        = initTotal > 0 ? equity / initTotal : null
sens        = Σ netLots × mult                                （NT$／點，帶正負）
callPts     = sens ? (equity − maintTotal) / sens : null       （多方：再跌幾點追繳；淨空方為負→再漲）
liqPts      = sens ? (equity − 0.25 × initTotal) / sens : null
notional    = Σ |netLots| × mult × mark
accLev      = equity > 0 ? notional / equity : null
exposure    = netWorth > 0 ? notional / netWorth : null        （netWorth 含期貨未平倉）
dayPnl      = Σ dailyChange × mult × netLots
realizedNet = Σ events.realizedPnl − Σ trades.(fee + tax)      （策略累計＝realizedNet + unrealized）
```

### 4.3 交易與現金
- `addTrade(t)`：驗證 lots>0、price>0、month 格式；`tax` 未給則自動算；push 後 replay 取此筆 realized → `cash = realized − fee − tax`，套用到帳戶（有連結才動）。
- `deleteTrade(id)`：帳戶沖回 `−cash`；轉倉配對的另一筆不自動刪（各自獨立）。
- `updateTrade(id, patch)`：沖回舊 cash → 改 → 重播算新 cash → 套用。
- `rollover({contract, month, toMonth, lots, closePrice, openPrice, time, feePerLot})`：同一 `rollId` 兩筆（先平近月、再開遠月），回傳 `{closeTrade, openTrade, realized, spread: openPrice − closePrice}`。
- 編輯早期交易會改變之後平倉的已實現，但已套用的現金不追溯（與股票相同）；使用者可直接改帳戶餘額校正。

### 4.4 淨資產與快照（`calc.js`）
- `assetsSummary()` 新增 `fut = summary(...)`；`netWorth = cashTwd + investTwd − liabTwd + fut.unrealized`（保證金餘額已在 cashTwd 內）。
- 資產頁顯示：流動資金 = cashTwd − 保證金餘額；期貨卡 = equity。
- 快照新增欄位：`futUnrealizedTwd, futRealizedPnl(累計 realizedNet), futNotionalTwd, futEquityTwd, futDayPnl`。
- **既有欄位改含期貨**：`unrealizedPnl += futUnrealized`、`realizedPnl += futRealizedPnl`、`totalPnl += 兩者`、`dayPnl += futDayPnl`、`netWorth += futUnrealized`。`totalReturnPct` 分母仍為股票投入本金（期貨無成本基礎，文件註明）。
- 舊快照無期貨欄位 → 視為 0。
- `rebuildSnapshots(hist, fx, futHist)`：`futHist['TX@202610'] = [{date, close}]` carry-forward；每日以交易重播算 unrealized／realizedNet，餘額用目前值。
- `nwOf` 不變（快照已含）。

### 4.5 統計（`calc.js`）
- `tradingStats` / `scopedStats`：`bestTrade/worstTrade` 加入期貨平倉事件（amount＝realizedPnl，market:'fut'，label 由 view 組：`大台 202609→202610 · 2 口 @ 46,300`）。
- `feesSummary` 新增 `fut`（手續費＋稅，計入 total、count）。
- `buildSummary` 新增 `futRealizedNet, futUnrealized`，`totalPnl` 等併入；`totalDividendTwd` 不變。
- 報表 `mkReport`：新增 `futPnl = Δ(futRealizedPnl + futUnrealizedTwd)`；列的副標在 ≠0 時顯示「期貨 ±x」；年報表 hero chips 拆「股票／期貨／股息」。
- 統計頁：「自投入本金以來」多「期貨損益」；手續費卡多「期貨手續費＋稅」。

## 5. 外部資料（`api.js`）

- `fetchFuturesDaily(contract, month, startDate)`：FinMind `dataset=TaiwanFuturesDaily&data_id=<contract>`；只取 `contract_date === month` 且 `trading_session === 'position'`；`price = settlement_price > 0 ? settlement_price : close`；升冪 `[{date, close}]`。
- `refreshFutures(positions)`：每個持有月份抓近 12 天 → `prices['FUT:c@m'] = {price, dailyChange: price − prev, prevClose: prev}`；手動價（`manual: true`）在下次自動刷新成功時被覆蓋。
- `fetchTaifexMargins()`：抓 `https://www.taifex.com.tw/cht/5/indexMarging`（直連失敗走 proxy），`parseTaifexMargins(html)` 解析 `<tr>` 中首欄為 `臺股期貨`／`小型臺指(期貨)`／`微型臺指(期貨)`（排除含「客製化」）的列：欄序 結算／維持／原始；同時抓「更新日期：YYYY/MM/DD」。回 `{margin, date}` 或 null。
- `app.js`：每日一次（`dives_fut_margin_date`）在 `marginAuto` 時更新；失敗保留原值。

## 6. 畫面（`App.ViewsFutures`，依原型 v3）

- **資產頁**：投資與負債之間多「期貨」卡（金 `#E5A322`）：環圈＝equity 佔（流動＋投資＋期貨）比、名稱、摘要「大台 2 口 · 202610」、右側 equity + 今日 dayPnl。保證金帳戶不再列在流動資金內（總額也扣掉）。點卡 → 期貨頁。無任何期貨交易且未連結帳戶時不顯示此卡。
- **期貨頁**：`gd-head`（‹ 期貨 ［走勢］⋯ ＋）；hero 權益數 + 今日 + chips（餘額／未平倉／累計）；KPI 卡（風險指標／帳戶槓桿／整體曝險 三欄 + 色條〔砍倉 25%、追繳 maint/init〕+ 追繳／砍倉距離兩格 + 「原始 x · 維持 y」）；部位卡（口數、合約、月份、均價、到期、未平倉、現價）；按鈕列 轉倉／平倉／入出金。無部位時顯示空狀態。
  - 風險指標色：≥100% 綠 `#34C759`、50–100% 黃 `#F59E0B`、<50% 紅 `#E53935`；無部位 `--`。
- **走勢頁**（走勢 icon）：seg 走勢／漲幅／紀錄。走勢＝快照 `futEquityTwd`（實線）與 `futEquityTwd − futUnrealizedTwd`（餘額，虛線），區間控制共用 `chartRange`；漲幅＝權益數月變化長條（年份 chips）；紀錄＝三格總計（已實現／費用／轉倉次數）+ 列表（轉倉合併成一列顯示價差；買入／賣出單列；點列可編輯／刪除）。
- **表單**：
  - 新增交易：買進／賣出、合約（大台／小台／微台）、月份（未到期的 6 個）、日期、口數、成交價、手續費／口（預設）、期交稅（自動、可改）；預覽：保證金、風險指標 前→後、帳戶槓桿 前→後。
  - 轉倉：部位（鎖定）、平倉價、口數、轉到月份、新倉價、日期、手續費／口；預覽：實現損益、價差、費用、帳戶變動。
  - 平倉：交易表單預帶反方向與口數。
  - 入出金：開該現金帳戶既有表單。
  - 設定（⋯）：保證金帳戶（台幣帳戶選單）、三合約 原始／維持（可改）+ 公告日期 + 每日自動更新開關、手續費／口、現價來源（自動／手動輸入現價）、提醒開關。
- **通知**：到期前 7 天（key `fut-exp:c@m`）、風險指標 < 100%（每日一次）。

## 7. 備份、同步、版本

- CSV：`# FUTURES`：`Contract,Month,Side,Lots,Price,Fee,Tax,Time,RollId,Cash`；`# SETTINGS` 新增 `futAccountName`、`futMargin_TX=init/maint`（三合約）、`futMarginDate`、`futMarginAuto`、`futFee_TX`…、`futAlertExpiry`、`futAlertRisk`。缺分段不動既有資料。
- 同步：`dives_futures` 加入 `DATA_KEYS`。
- `index.html` 與 `sw.js` SHELL 加入兩個新檔；`App.VERSION` → v137，快取名 `dives-v137`。
- `seedDemo`：加一個保證金帳戶與 2 口大台 202610（含一次轉倉）。

## 8. 測試（node:test，`tests/futures*.test.js`）

1. 重播：開倉／加碼均價、部分平倉、反手、空單損益、多月份獨立。
2. 指標：equity、risk、callPts／liqPts（多／空）、notional、accLev、exposure、dayPnl；無部位 → null。
3. 交易：addTrade 自動稅、cash 套用；deleteTrade 沖回；updateTrade 反向沖銷；rollover 兩筆同 rollId、realized、spread、帳戶變動。
4. 到期日：202610 → 2026-10-21；202611 → 2026-11-18。
5. 解析：`parseTaifexMargins` 對真實頁面片段（含客製化列）→ 三合約與日期；`parseFuturesDaily` 過濾價差／夜盤、取結算價。
6. 快照：`saveTodaySnapshot` 含期貨欄位，`netWorth = cash + invest − liab + futUnrealized`，`totalPnl` 含期貨；舊快照 nwOf 不變。
7. 重建歷史：期貨 carry-forward 與交易日期。
8. 統計：bestTrade 取到期貨事件；feesSummary.fut。
9. CSV 全量 round-trip（含設定與帳戶名重連）。
10. 資產摘要：流動資金扣除保證金帳戶、期貨卡＝equity。

## 9. 已知取捨

- 轉倉當天兩個月份同時在手會短暫高估保證金總額（不做跨月價差減收）。
- 期交所頁面改版時 parser 失效 → 保留舊值並顯示公告日期，使用者可手改。
- 保證金帳戶餘額歷史無從得知 → 重建歷史時用目前餘額（同現金帳戶做法）。

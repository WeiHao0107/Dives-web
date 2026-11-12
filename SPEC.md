# Dives 技術規格（SPEC）

> 本文件描述 Dives PWA 的**資料模型、模組職責與關鍵行為/不變式**，供開發與測試對照。
> 使用者操作手冊見 [README.md](README.md)。對應的自動化測試見 [`tests/`](tests/)。

版本對照：`App.VERSION`（見 `js/app.js`）、Service Worker 快取名 `dives-vNN`（見 `sw.js`）。

---

## 1. 總覽

- 純前端、零後端的單頁 PWA。原生 `<script>` 依序載入，共用全域命名空間 `window.App`。
- 資料存於 `localStorage`（前綴 `dives_`）。可選以 GitHub Gist 跨裝置同步。
- 五個分頁：**資產 / 投資 / 歷史 / 報表 / 設定**；預設進入「資產」。
- 顏色慣例（台股）：**漲＝紅、跌＝綠**（`App.UI.pnlColor`：`v >= 0 → #E53935`，否則 `#43A047`）。

模組（`js/`）：

| 檔案 | 命名空間 | 職責 |
|------|----------|------|
| `util.js` | `App.Util` | 純工具：市場判斷、數字/日期格式化、字串清理（**無副作用、無 I/O**） |
| `store.js` | `App.Store` | localStorage 讀寫、`uuid`、`clearAll` |
| `calc.js` | `App.Calc` | 持倉/彙總/損益/快照/現金沖銷/淨資產分桶（**運算核心**） |
| `csv.js` | `App.Csv` | CSV 匯出/匯入（與 iOS App 相容） |
| `api.js` | `App.Api` | 報價/歷史/匯率/搜尋（外部資料源） |
| `charts.js` | `App.Charts` | 手繪 SVG 圖：`trend` / `lineChart` / `reportColumn` / `barChart` |
| `ui.js` | `App.UI` | toast、彈窗、顏色常數 |
| `sync.js` | `App.Sync` | Gist 同步 |
| `auth.js` | `App.Auth` | App 鎖定（PIN / WebAuthn） |
| `views.js` | `App.Views` | 各分頁渲染 + 表單 |
| `app.js` | `App`（主控） | 分頁路由、報價刷新、初始化、`seedDemo` |

---

## 2. 市場類型（`App.Util.Market`）

```
Market = { tse, otc, rotc, us, crypto, unknown }
```

### 2.1 `normalizeMarketKey(market)`
將多種別名正規化為 `Market` 值（大小寫、中英、iOS 別名）：
- `tse|twse|上市|listed → tse`
- `otc|tpex|上櫃|otc_market → otc`
- `rotc|emerging|興櫃 → rotc`
- `us|usa|美股 → us`
- `crypto|coin|加密|虛擬貨幣 → crypto`
- 其他 → `unknown`

### 2.2 `guessMarketBySymbol(symbol)`（僅憑代碼格式）
- 含英文字母：
  - 「4+ 位數字且**恰 1 個字母**」→ `tse`（台股 ETF/債，如 `00679B`）
  - 其他含字母 → `us`
- 純數字且長度 4–6 → `tse`
- 其餘 → `unknown`

### 2.3 幣別換算原則
美股與加密的市值/成本以 **USD 計**，顯示為 TWD 時一律 `× 匯率`（`App.Store.getFxRate()`，預設 31.5）。台股本身即 TWD。

---

## 3. 資料模型（localStorage，前綴 `dives_`）

| 概念 | 形狀（重點欄位） |
|------|------------------|
| 交易 `transactions` | `{ id, symbol, type: 'BUY'|'SELL', shares, price, fee, time, market, name }` |
| 標的中繼 `meta` | `{ code, name, market }` |
| 報價 `prices` | `{ [symbol]: { price, dailyChange, prevClose } }` |
| 匯率 `fxRate` | `number`（USD→TWD） |
| 現金帳戶 `cashAccounts` | `{ id, name, currency: 'TWD'|'USD', balance, updatedAt? }` |
| 負債 `liabilities` | `{ id, name, currency, balance, updatedAt? }` |
| 群組 `groups` | `{ id, name }`（單層） |
| 群組對應 `groupMap` | `{ [symbol]: groupId }` |
| 佔比基準 `pctBasis` | `'group' | 'invest' | 'net'` |
| 每日快照 `snapshots` | 見 §5 |
| 期貨 `futures` | `{ accountId, margin:{TX,MTX,TMF:{init,maint}}, marginDate, marginAuto, feePerLot, alerts, trades:[{ id, contract, month, side, lots, price, fee, tax, time, rollId?, cash }] }`（`App.Futures`，見 §10） |

`App.Store.clearAll()` 會清空以上全部。

### 待確認交易（`App.Inbox`，`js/inbox.js`）

排程腳本把券商對帳單整理成交易，寫進**同步 Gist 的另一個檔 `dives-inbox.json`**；App 每次同步時讀進來（只讀不寫），使用者審核後才入帳。

```jsonc
{ "app": "dives-inbox", "version": 1, "updatedAt": 1794470000000, "items": [
  // 股票
  { "id": "cathay:2026-11-11:VOO:BUY:2:707.32:1", "broker": "cathay", "kind": "stock", "date": "2026-11-11", "time": "22:31:05",
    "symbol": "VOO", "name": "Vanguard S&P 500 ETF", "market": "us", "side": "BUY", "shares": 2, "price": 707.32, "fee": 1.13, "tax": 0,
    "source": "國泰買賣報告書 2026/11/11" },
  // 期貨
  { "id": "yuanta-fut:2026-11-06:TX:202611:BUY:1:27650:1", "broker": "yuanta-fut", "kind": "fut", "date": "2026-11-06",
    "contract": "TX", "month": "202611", "side": "BUY", "lots": 1, "price": 27650, "fee": 50, "tax": 111, "source": "元大期貨買賣報告書 2026/11/06" }
] }
```

- `id`：腳本產生，同一筆成交每次執行都必須相同（App 靠它記住已匯入／已略過）；同價同量的多筆成交要用序號區分。
- `date`／`time`（選填，`HH:MM[:SS]`）為台灣時間；沒有 `time` → 當天中午，同日依檔案順序。
- `broker`：`cathay`｜`yuanta-fut`｜`yuanta`｜`firstrade`（其他字串照樣顯示）。`fee` 為整筆合計；期貨 `tax` 省略則依合約自動算；股票的 `tax` 併入手續費。
- 格式不對的項目整筆丟掉（不猜）；腳本應保留近 60 天的項目，舊的可移除。
- 本機狀態：`dives_inbox`（收件匣快取，不同步）、`dives_inbox_done`（`{ id: [ 'i'已匯入 | 's'已略過, 時間 ] }`，同步）、`dives_inbox_cfg`（`{ acct: { 券商: 現金帳戶 id } }`，同步）。

`meta.market` 缺漏或 `unknown`（舊備份、iOS 匯出不認得的市場字串）時，`metaMap()` **讀取時**依代碼格式補上（`guessMarketBySymbol`），`upsertMeta` 寫回即修復；否則字母代碼的美股會被當台股（不換匯率、報價走台股來源）。

---

## 4. 損益與彙總（`App.Calc`）

### 4.1 持倉 `buildPositions()`
以移動加權平均成本累計各 symbol：BUY 加股數與成本、SELL 減股數（成本按均價扣抵）。輸出每檔 `{ symbol, name, market, shares, avgCost, lastPrice, marketValue, ... }`。

賣出以「賣出當時」的持股驗證（可回填日期），見 I10。

### 4.2 現金沖銷 `txCashDelta(tx)`（**不變式**）
交易對所選現金帳戶餘額的影響：
```
BUY  → -(shares*price + fee)
SELL → +(shares*price - fee)
```
新增/更新/刪除交易時，若指定 `accountId` 則據此增減帳戶餘額；更新與刪除會**反向沖銷**先前效果。

### 4.3 資產彙總 `assetsSummary()`
```
cashTwd  = Σ 現金帳戶（USD × 匯率；含期貨保證金帳戶）
liabTwd  = Σ 負債（USD × 匯率）
investTwd = 投資總市值（買方持倉，美股/加密 × 匯率）
netWorth = cashTwd + investTwd − liabTwd + 期貨未平倉損益
```
另回傳 `invSummary`（含 `dayPnl` 等）與 `fut`（`App.Futures.summary`）。`cashLiabTwd()` 只回傳 `{ cashTwd, liabTwd }`。資產頁顯示時，保證金帳戶從「流動資金」搬到「期貨」卡（權益數＝餘額＋未平倉），總和不變。

### 4.4 槓桿倍率 `leverageSummary()`
設定 `Store.getLeverage()` = `{ show:false, futures:'notional'|'none', liab:'net'|'gross', mult:{SYMBOL:倍數} }`（`dives_leverage`，會同步、CSV `lev*` 列備份）。
```
stockMv    = Σ 持股市值（TWD）
multExtra  = Σ 市值 × (mult[symbol] − 1)      // 未列出 = 1
futNotional= futures==='none' ? 0 : fut.notional
exposure   = stockMv + multExtra + futNotional
denom      = liab==='gross' ? netWorth + liabTwd : netWorth
ratio      = denom > 0 ? exposure / denom : null
```
只在 `show` 時由資產頁 Hero 顯示；倉位頁另有「期貨」卡（契約總值、各部位、風險指標），Hero 總倉位／今日漲跌仍只算股票。

---

## 5. 每日快照（`saveTodaySnapshot` / `makeSnapshot`）

每日一筆（同日覆蓋），`date` 為台北時區 `YYYY-MM-DD`。關鍵欄位：
- 市值：`twMarketValue`, `usMarketValueTwd`, `cryptoMarketValueTwd`, `totalMarketValueTwd`
- 現金/負債/淨資產：`cashAccountsTwd`, `liabilitiesTwd`, **`netWorth = totalMarketValueTwd + cashAccountsTwd − liabilitiesTwd`**
- 損益：`dayPnl`, `unrealizedPnl`, `realizedPnl`, `totalPnl` …（**皆含期貨**：未平倉 + 已實現淨費用）
- 期貨：`futUnrealizedTwd`, `futRealizedPnl`（累計已實現 − 費用）, `futNotionalTwd`, `futEquityTwd`, `futDayPnl`（舊快照無此欄 → 0）

### 5.1 淨資產回填 `nwOf(s, cl)`（**相容不變式**）
舊快照可能無 `netWorth` 欄位，讀取時回填以避免走勢斷崖：
```
nwOf(s, cl) =
  s.netWorth               若存在
  否則 (s.totalMarketValueTwd ?? s.netAsset ?? 0) + cl.cashTwd − cl.liabTwd
```

---

## 6. 淨資產長條圖分桶（`App.Calc.netWorthBuckets`）

**純函式**（無 Store/DOM 依賴），供「資產 → 點淨資產 → 長條圖頁」使用。

```
netWorthBuckets(snapshots, gran, cashLiab) -> Bucket[]
  gran ∈ { 'day', 'week', 'month', 'year' }
  cashLiab = { cashTwd, liabTwd }
  Bucket = { label, full, nw, change }
```

規則（**測試對象**）：

1. 先以 `nwOf`（§5.1）把每筆快照換算成淨資產 `nw`，並依 `date` 升冪排序。
2. 分桶：
   - `day`：每筆快照即一桶。
   - `week`：以該週**週一**（台北時區）為鍵，同桶取**最後一筆**（週末值）。
   - `month`：以 `YYYY-MM` 為鍵，同桶取最後一筆。
   - `year`：以 `YYYY` 為鍵，同桶取最後一筆。
3. **漲幅 `change`**：
   - 有前一桶 → `本桶.nw − 前一桶.nw`（跨期比較）。
   - **無前一桶（最早/唯一桶）→ 該桶期間內漲幅 `期末 − 期初`**（避免顯示 0）。
4. 視窗（取最後 N 桶）：`day → 7`、`week → 5`、`month → 12`、`year → 10`。
5. 空快照 → 回傳 `[]`。

> `js/views.js` 的 `nwBuckets(gran)` 為薄包裝：`C.netWorthBuckets(S.getSnapshots(), gran, C.cashLiabTwd())`。

---

## 7. 圖表配色（`App.Charts`）

- 淨資產（線/長條）：藍 `#2F80ED`。
- 倉位走勢（`trend`）：台股橙 `#E8823C`、美股藍 `#4A82C8`、加密紫 `#9B59D0` 堆疊。
- 漲幅長條：依值上色 `pnlColor`（正紅負綠）。
- Tooltip 靠右邊界時以量測寬度 `tip.offsetWidth` 夾住，避免跑版。

---

## 8. 關鍵不變式（測試須守住）

- **I1**：`netWorth = cashTwd + investTwd − liabTwd`（§4.3）。
- **I2**：`txCashDelta` 買負賣正、含手續費方向正確（§4.2）。
- **I3**：`netWorthBuckets` 對單一年份資料**不得回傳 change=0**，而是期間內漲幅（§6.3）。
- **I4**：`nwOf` 對無 `netWorth` 的舊快照正確回填（§5.1）。
- **I5**：`guessMarketBySymbol('00679B')=tse`、`guessMarketBySymbol('AAPL')=us`、`guessMarketBySymbol('2330')=tse`（§2.2）。
- **I6**：CSV 匯出→匯入為 round-trip：交易筆數與關鍵欄位一致（§9）。
- **I7**：手續費防呆 —— `findAbsurdFees(txs)` 找出 `fee > 成交金額×25%` 的交易（fee 計入成本，誤填天文數字會毒掉報表與重建歷史）；`importCsv` 回傳 `feeWarnSymbols`，匯入與重建歷史時以 toast 警告。
- **I8**：群組走勢 —— `buildGroupSeries(symbols, hist, fxRate)` 依交易 + 成員歷史收盤（carry-forward）回推群組每日 `{mv, cost}`（美股/加密 ×匯率；賣光歸零；無歷史價以成本估）。資產→群組詳情→走勢 icon：折線（市值實線+成本虛線）/ 長條（投入、持倉盈虧兩圖）× 天/週/月/年。
- **I9**：統計（歷史→統計 tab）—— `tradingStats()` 回傳：`period.{day,week,month,year}.{best,worst}`（以 totalPnl 期間變化，全歷史取極值）、`bestTrade/worstTrade`（realizedPnl 極值；**美股/加密先 ×匯率換成 TWD 再比較**，`amount` 為 TWD、`shares/price` 保留原幣別）、`topGain/topLoss/topPct`（現有持倉未實現 TWD/報酬率極值）。`scopedStats()` 同。
- **I11**：期貨重播 —— `App.Futures.replay(trades)` 以（合約, 月份）為單位：同方向開倉加權均價、反方向平倉 `realized = (price − avgEntry) × 乘數 × 口數 × 方向`、超過口數反手；`summary()`：`equity = 帳戶餘額 + Σ未平倉`、`risk = equity ÷ Σ|口數|×原始`、`callPts = (equity − 維持總額) ÷ Σ(口數×乘數)`、`liqPts` 同式門檻 25% 原始、`accLev = 契約總值 ÷ equity`、`exposure = (股票市值 + 契約總值) ÷ 淨資產`。交易的 `cash`（已實現 − 手續費 − 稅）在新增時套用到保證金帳戶、刪除沖回。
- **I12**：快照 `totalPnl/unrealizedPnl/realizedPnl/dayPnl/netWorth` 皆含期貨；`rebuildSnapshots(hist, fx, futHist)` 以各月份結算價 carry-forward；`tradingStats/scopedStats` 的單筆之最含期貨平倉事件（`market:'fut'`）、`feesSummary.fut` 含手續費＋稅。
- **I13**：已實現重算 —— 任何會改變均價的異動（買入、配股，含補登較早日期）都要 `recomputeRealized(symbol)`；期貨同理：新增／修改／刪除一律 `resyncCash` 整批重播，保證金帳戶餘額恆等於「入金 + 已實現淨額」。
- **I14**：當日損益含今日了結的部分 —— 股票 `symbolDayPnl`：昨日持股用昨收、今日買入用買價；今日賣出先賣昨日持股（賣價 − 昨收），再賣今日買入（賣價 − 買價）；今日賣光的標的列在 `buildPositions().closedToday` 由 `buildSummary` 計入。期貨 `Futures.dayPnlOf` 同規則（平倉價 − 昨結算；報價日期早於今天時該價即昨結算）。
- **I15**：報酬率分母 `capitalBase(snap) = 股票成本 + 期貨入金`（期貨入金 = 權益數 − 未平倉 − 已實現淨額；沒連結保證金帳戶不計）。凡損益含期貨的報酬率（報表、`scopedStats`、快照 `totalReturnPct`）都用它。
- **I16**：重建歷史不抹掉紀錄 —— `rebuildSnapshots` 保留「當天實際記錄」的現金／負債／期貨餘額（快照非 `est` 且有 `netWorth`）；沒紀錄的日子沿用最近一筆並標 `est:1`（CSV `Est` 欄）；完全沒有紀錄才用目前值。任何一檔歷史價抓取失敗（`hist._failed`）→ `rebuildHistory` 不重建。
- **I17**：`athInfo(currentNw)` = 歷史最高淨資產（各日快照 `netWorth` 與今天即時值取大），回傳日期、是否今天創高、目前距高點 %。走勢折線以每日資料畫（≤ 800 天），並標出第一條線的最高／最低點（`Charts.extremes`）；報表迷你走勢不標。
- **I21**：`symbolSeries(symbol, hist)` 回傳個股每日走勢：`cost` 是當時持股的成本（賣出後減少）、沒有持股的日子 `avgCost = null`、`mv = cost = 0`；沒有歷史價時以均價估。歷史價抓失敗 → 個股頁顯示載入失敗，不以成本估算畫走勢。
- **I19**：待確認交易不會自動入帳 —— 只有使用者按匯入才呼叫 `addTransaction`／`Futures.addTrade`（帶 `source: 'inbox:券商'`、成交日期）；匯入成功才記為已處理，失敗的留在清單。批次匯入依成交時間舊→新。App 不寫 `dives-inbox.json`。
- **I20**：新增交易表單所選的日期會寫入（今天 → 當下時間；其他日期 → 當天中午）。
- **I18**：月曆當日比例 = 當日損益 ÷ 前一筆快照的部位（台股／美股／加密＝該市場市值、期貨＝權益數、總損益＝股票市值＋期貨權益數、群組＝前一日群組市值）；前一筆沒有部位 → 用「當日部位 − 當日損益」；仍無部位 → 不顯示。股息不算比例。
- **I10**：賣出一致性 —— 賣出（新增或編輯）以**時間序重播**驗證：加入後任一時點的賣出股數不得超過當時持股（`firstOversell`），否則拒絕；已實現損益一律由 `recomputeRealized` 重播產生，新增當下與事後編輯結果相同。同檔同一時間多筆賣出對應各自的已實現紀錄（`realizedByTxId`，依建立順序配對）。

---

## 10. 期貨（`App.Futures` / `App.ViewsFutures`）

設計文件：`docs/superpowers/specs/2026-09-17-futures-design.md`。乘數 `TX 200 / MTX 50 / TMF 10`，期交稅 `契約值 × 0.00002`，到期日＝該月第三個星期三。報價 cache key `FUT:<contract>@<YYYYMM>`（FinMind `TaiwanFuturesDaily` 日盤結算價）。保證金金額預設為期交所 2026/08/12 公告，`marginAuto` 時每日抓期交所頁面（經 r.jina.ai，parser 同時支援 HTML 與 markdown 表格）。CSV 分段 `# FUTURES` 與 `# SETTINGS` 的 `fut*` 列；同步 key `dives_futures`。

## 9. CSV（`App.Csv`）

- `exportCsv()`：輸出交易紀錄 + 每日快照，格式與 iOS App 相容，供下載 `portfolio_backup_YYYY-MM-DD.csv`。
- `importCsv(content)`：解析回 `{ ok, txCount, snapCount, msg? }`。**分段存在才覆蓋**：有交易分段才換交易／已實現，有快照分段才換快照（只含設定等分段的檔案不清資料）。UI 匯入前先確認。無快照時由呼叫端觸發「重建歷史走勢」。
- 交易第 8 欄 `Account`＝連結現金帳戶名稱（匯入依名稱重連，不重套現金）；快照第 31–35 欄為期貨分項（`Fut*`）。舊版／iOS 檔案缺欄位 → 視為空 / 0。

# Dives PWA — 網頁版投資追蹤

與 iOS 原生 app 功能一致的 **Progressive Web App**（純前端，零後端）。
可「加入主畫面」變成像 App 一樣的圖示，**不需要 Apple Developer Program、不會 7 天過期**。

## 特色

- 台股 / 美股投資組合追蹤，資料 **完全存於裝置本機**（localStorage）
- 持倉、歷史走勢圖、年度／月度報表、交易紀錄
- 報價來源皆原生支援瀏覽器（CORS），無需自架後端：
  - **台股**：[FinMind](https://finmindtrade.com/)（收盤價、漲跌、代碼名稱）
  - **美股**：[Finnhub](https://finnhub.io/)（即時報價、代碼搜尋）
  - **匯率**：open.er-api.com（USD/TWD）
- CSV 備份格式與 iOS app **完全相容**，可雙向搬移資料
- 可離線開啟（Service Worker 快取）

## 線上使用 / 安裝到手機

1. 用 **iPhone Safari** 開啟部署網址（見下方「部署」）
2. 點底部「分享」按鈕 → **加入主畫面**
3. 主畫面會出現 Dives 圖示，點開即為全螢幕 App，**永久有效**

> 資料存在該瀏覽器，請定期用「設定 → 匯出備份」保存 CSV。

## 部署（GitHub Pages，免費）

此資料夾 `docs/` 已可直接部署：

1. 將整個專案 push 到 GitHub
2. Repo → **Settings → Pages**
3. Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 **`/docs`**，Save
4. 約 1 分鐘後網址為：`https://<你的帳號>.github.io/<repo>/`
   - 例如：`https://weihao0107.github.io/Dives/`

## 本機測試

```bash
cd docs
python3 -m http.server 8765
# 瀏覽器開 http://localhost:8765
```

## 從 iOS app 搬移資料

1. iOS app → 設定 → 匯出備份 → 取得 `portfolio_backup_YYYY-MM-DD.csv`
2. PWA → 設定 → 匯入備份 → 選該 CSV
3. 交易紀錄與每日快照都會還原

## 進階設定（設定頁底部）

| 項目 | 說明 |
|------|------|
| Finnhub API 金鑰 | 美股報價，預設使用內建金鑰，可換成自己的 |
| FinMind Token | 台股報價，免金鑰即可用；持倉多或更新頻繁時，[免費註冊](https://finmindtrade.com/) 取得 token 填入可提高速率上限 |
| CORS 代理 | 報價直連失敗時的後備（一般不需要，因資料源皆支援 CORS）|

## 注意事項

- 報價為 **日收盤** 資料：台股盤中顯示前一交易日收盤，收盤後（約 14:30 後）更新為當日
- 台股顏色慣例：**漲紅跌綠**（與美股相反）
- 資料僅存本機瀏覽器，清除瀏覽器資料或更換裝置前請先匯出備份

## 檔案結構

```
docs/
├── index.html              # App 殼層 + 分頁
├── manifest.webmanifest    # PWA 設定（可安裝）
├── sw.js                   # Service Worker（離線快取）
├── css/style.css           # 暖色中性主題
├── icons/                  # App 圖示（192/512/maskable/180）
└── js/
    ├── util.js             # 格式化 / 市場判斷 / 日期
    ├── store.js            # localStorage 資料層
    ├── calc.js             # 持倉 / 彙總 / 已實現損益 / 快照
    ├── csv.js              # 匯入匯出（相容 iOS）
    ├── api.js              # 報價 / 匯率 / 搜尋（FinMind + Finnhub）
    ├── charts.js           # SVG 走勢圖 / 長條圖
    ├── ui.js               # toast / 彈窗 / 顏色
    ├── views.js            # 四分頁 + 交易表單
    └── app.js              # 主控制器 / 路由 / 刷新
```

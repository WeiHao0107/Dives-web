# 元大 SPARK API 庫存查詢測試

用元大證券官方 SPARK API 查 **台股庫存** 與 **國外股票（複委託）庫存**，印成表格並存成 JSON。
只呼叫 `Open` / `Login` / `GetStoreSummary` / `LogOut`，**不下單**。

## 事前準備（要自己向元大辦）

1. 簽署「API 服務申請書」與「交易風險預告書」，執行元大的測試軟體 `setup.exe`（只能在 Windows 跑）並上傳結果，再請營業員開通證券帳號（S 帳號）的 API。流程見 [元大 API 專區](https://www.yuanta.com.tw/file-repository/content/API/page/index.html)。
2. 到元大網站申請電子憑證，匯出成 `.pfx` 檔，記下憑證密碼。
3. 問營業員：**API 查得到複委託庫存嗎？要另外開通嗎？**

## 安裝（這台 Mac 已經裝好）

```bash
cd tools/yuanta
# Intel Mac 用 osx-x64，Apple Silicon 用 osx-arm64
curl -LO https://ys.yuanta.com.tw/quartet/api/YuantaSparkAPI_osx-x64_Python.zip
# zip 內兩份說明 PDF 是 Big5 檔名，unzip 會卡住，先跳過（說明可到元大網站看）
unzip -q YuantaSparkAPI_osx-x64_Python.zip -x '*.pdf' && mv YuantaSparkAPI_osx-x64_Python sdk
python3.12 -m venv .venv
.venv/bin/pip install pythonnet
```

不用另裝 .NET 8：元大的元件自帶 .NET 8 runtime，腳本會直接用 `sdk/` 裡的。

## 執行

```bash
cd tools/yuanta
.venv/bin/python inventory.py --account S分公司4碼帳號7碼 --pfx /絕對路徑/你的憑證.pfx
```

接著會要你輸入電子交易密碼和憑證密碼，兩者都不會存檔。要做自動化時，可以改用環境變數 `YUANTA_ACCOUNT`、`YUANTA_PFX`、`YUANTA_PASSWORD`、`YUANTA_PFX_PASSWORD`。

查到的結果：

- 終端機會印出台股和複委託兩張表。
- `out/inventory-日期-時間.json` 會存一份；每一筆都附 `raw` 欄位，裡面是元大回傳的全部欄位。

## 注意

- **登入失敗不要連續重試。** 元大規定失敗後至少隔 4 秒才能再登入，而且一小時內被暫停 10 次就會停用 API。腳本失敗就直接結束，不會自動重試。
- **複委託庫存沒有市價、市值和損益**（元大回傳的 `MarketPrice` 固定是 0），只有股數、均價、成本和匯率。市價要由 Dives 自己抓。
- **複委託那張表如果是空的**，但你確定有持股，就是 API 還沒開通複委託查詢，請問營業員。
- 元大元件每次啟動都會在 `~/Log/` 寫一份啟動 Log。加上 `--log` 會記得更詳細，可能包含帳號資訊，除錯完請刪掉。
- `sdk/`、`out/`、`*.pfx` 已列在 `.gitignore`，不會進 git。這個 repo 是公開的，請不要把憑證放進 repo 資料夾以外又會同步出去的地方。
- `--uat` 會連元大的測試環境。要先請營業員申請固定 IP 白名單，並另外下載測試憑證 `B110000005_TWCA.zip`，所以一般用不到。

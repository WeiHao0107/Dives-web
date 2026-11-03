#!/usr/bin/env python3
"""元大 SPARK API 庫存查詢測試：登入 → 股票庫存綜合總表（台股＋國外股票）→ 登出。

只呼叫 Open / Login / GetStoreSummary / LogOut，不下單。
密碼不寫進任何檔案：預設在終端機互動輸入，或由環境變數帶入。

用法：
    python inventory.py --account S12345678901 --pfx /絕對路徑/憑證.pfx
    python inventory.py --uat      # 元大測試環境（需先申請固定 IP 白名單）

文件：https://www.yuanta.com.tw/file-repository/content/sparkapi_docs/
"""
import argparse
import getpass
import json
import os
import re
import sys
import threading
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent.resolve()

# 元大文件公開的測試環境帳號（UAT 專用）
UAT_ACCOUNT = 'S98875005091'
UAT_PASSWORD = '1234'
UAT_PFX_PASSWORD = 'yuanta'

LOGIN_OK = ('0001', '00001')
TRADE_KIND = {0: '現股', 3: '融資', 4: '融券', 6: '借券'}


def load_sdk(sdk_dir):
    """載入 YuantaSparkAPI.dll，回傳 YuantaOneAPI 模組。

    元大的 Python 元件是 self-contained 發行，資料夾內自帶 .NET 8 runtime（libhostfxr、libcoreclr），
    所以用 entry_dll 模式直接啟動它，不必另裝 .NET 8。
    """
    if not (Path(sdk_dir) / 'YuantaSparkAPI.dll').exists():
        sys.exit(f'在 {sdk_dir} 找不到 YuantaSparkAPI.dll。請把元大 Python 元件 zip 解壓到這個資料夾，或用 --sdk 指定。')

    from pythonnet import load
    load('coreclr', entry_dll=str(Path(sdk_dir) / 'YuantaSparkAPI.dll'), dotnet_root=str(sdk_dir))
    import clr
    sys.path.append(str(sdk_dir))
    clr.AddReference('YuantaSparkAPI')
    import YuantaOneAPI
    return YuantaOneAPI


def to_py(value):
    """把 .NET 值轉成可寫進 JSON 的 Python 值（pythonnet 已自動轉數字與字串，列舉等其餘轉字串）。"""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def dump(obj):
    """用反射列出 .NET 物件的所有公開欄位，元大改欄位時也不會漏。"""
    return {f.Name: to_py(f.GetValue(obj)) for f in obj.GetType().GetFields()}


def text(value):
    return '' if value is None else str(value).strip()


def mask(account):
    return account[:5] + '****' + account[-3:] if len(account) > 8 else '****'


class SparkClient:
    """把 OnResponse 的非同步回呼包成「呼叫 → 等結果」。"""

    def __init__(self, api_module, log):
        self.api = api_module.YuantaSparkAPITrader()
        self.api.SetLogType(api_module.enumLogType.COMMON if log else api_module.enumLogType.NONE)
        self.api.OnResponse += api_module.OnResponseEventHandler(self._on_response)
        self._results = {}
        self._events = {}
        self._lock = threading.Lock()
        self.trade_connected = threading.Event()

    def _event(self, key):
        with self._lock:
            return self._events.setdefault(key, threading.Event())

    def _on_response(self, intMark, dwIndex, strIndex, objHandle, objValue):
        try:
            if intMark == 0:  # 系統訊息（連線狀態等）
                message = str(objValue)
                print(f'  [系統] {message}')
                if '交易主機' in message and 'Is Connected' in message:
                    self.trade_connected.set()
                return
            if intMark == 1:  # 查詢回應
                self._results[strIndex] = objValue
                self._event(strIndex).set()
        except Exception as error:  # 回呼裡的例外不會傳回主執行緒，先印出來
            print(f'  [回應處理錯誤] {error}')

    def call(self, name, invoke, timeout=20):
        event = self._event(name)
        event.clear()
        if not invoke():
            raise RuntimeError(f'{name} 呼叫失敗（元件回傳 False）')
        if not event.wait(timeout):
            raise TimeoutError(f'{name} 在 {timeout} 秒內沒有回應')
        return self._results.pop(name)


def parse_summary(result):
    tw, foreign = [], []
    for s in result.StkStoreList:
        raw = dump(s)
        tw.append({
            'code': text(s.StkCode),
            'name': text(s.StkName),
            'market': text(s.MarketName) or str(s.MarketNo),
            'tradeKind': TRADE_KIND.get(int(s.TradeKind), str(s.TradeKind)),
            'qty': int(s.StockQty),
            'avgPrice': float(s.Price),
            'cost': float(s.Cost),
            'marketValue': float(s.MarketAmt),
            'unrealizedPnl': float(s.ReturnAmt),
            'currency': text(s.CurrencyType),
            'raw': raw,
        })
    for s in result.OVStkStoreList:
        raw = dump(s)
        foreign.append({
            'code': text(s.StkCode),
            'name': text(s.StkName),
            'fullName': text(s.StkFullName),
            'market': text(s.MarketName),
            'currency': text(s.CurrencyType),
            'qty': int(s.StockQty),
            'avgPrice': float(s.Price),
            'cost': float(s.Cost),
            'fxRate': float(s.CloseRate),
            'raw': raw,
        })
    return tw, foreign


def print_tables(tw, foreign):
    print(f'\n台股庫存：{len(tw)} 筆')
    if tw:
        print(f"  {'代號':<8}{'名稱':<10}{'類別':<6}{'股數':>10}{'均價':>12}{'成本':>14}{'市值':>14}{'未實現損益':>14}")
        for r in tw:
            print(f"  {r['code']:<8}{r['name'][:8]:<10}{r['tradeKind']:<6}{r['qty']:>10,}"
                  f"{r['avgPrice']:>12,.2f}{r['cost']:>14,.0f}{r['marketValue']:>14,.0f}{r['unrealizedPnl']:>14,.0f}")
    print(f'\n國外股票（複委託）庫存：{len(foreign)} 筆')
    if foreign:
        print(f"  {'代號':<10}{'名稱':<14}{'市場':<8}{'幣別':<6}{'股數':>10}{'均價':>12}{'成本':>14}{'匯率':>10}")
        for r in foreign:
            print(f"  {r['code']:<10}{r['name'][:12]:<14}{r['market'][:6]:<8}{r['currency']:<6}{r['qty']:>10,}"
                  f"{r['avgPrice']:>12,.4f}{r['cost']:>14,.2f}{r['fxRate']:>10,.4f}")
    else:
        print('  （沒有資料。若你確定有複委託持股，請向營業員確認 API 是否已開通複委託查詢。）')


def main():
    ap = argparse.ArgumentParser(description='元大 SPARK API 庫存查詢測試（唯讀，不下單）')
    ap.add_argument('--account', default=os.environ.get('YUANTA_ACCOUNT'),
                    help='證券帳號：S + 分公司4碼 + 帳號7碼（或設 YUANTA_ACCOUNT）')
    ap.add_argument('--pfx', default=os.environ.get('YUANTA_PFX'),
                    help='憑證 .pfx 的絕對路徑（或設 YUANTA_PFX）')
    ap.add_argument('--sdk', default=os.environ.get('YUANTA_SDK', str(HERE / 'sdk')),
                    help='元大 Python 元件解壓後、含 YuantaSparkAPI.dll 的資料夾（預設 ./sdk）')
    ap.add_argument('--uat', action='store_true', help='連元大測試環境，使用文件公開的測試帳號')
    ap.add_argument('--out', default=str(HERE / 'out'), help='JSON 輸出資料夾（預設 ./out）')
    ap.add_argument('--log', action='store_true',
                    help='開啟元大元件的 Log（除錯用；Log 可能含敏感資訊，用完請刪）')
    args = ap.parse_args()

    if args.uat:
        account, password, pfx_password = UAT_ACCOUNT, UAT_PASSWORD, UAT_PFX_PASSWORD
        if not args.pfx:
            args.pfx = str(Path(args.sdk) / 'B110000005_TWCA.pfx')
    else:
        account = (args.account or input('證券帳號（S+分公司4碼+帳號7碼）：')).strip().upper()
        if not re.fullmatch(r'S\d{11}', account):
            sys.exit(f'帳號格式不對：{account}。應為 S + 11 碼數字，例如 S98875005091。')
        if not args.pfx:
            sys.exit('請用 --pfx 或 YUANTA_PFX 指定憑證 .pfx 的絕對路徑。')
        password = os.environ.get('YUANTA_PASSWORD') or getpass.getpass('電子交易密碼：')
        pfx_password = os.environ.get('YUANTA_PFX_PASSWORD') or getpass.getpass('憑證密碼：')

    pfx = Path(args.pfx).expanduser().resolve()
    if not pfx.exists():
        sys.exit(f'找不到憑證：{pfx}')

    yuanta = load_sdk(Path(args.sdk).expanduser().resolve())
    client = SparkClient(yuanta, args.log)
    env = yuanta.enumEnvironmentMode.UAT if args.uat else yuanta.enumEnvironmentMode.PROD
    print(f"連線到元大{'測試' if args.uat else '正式'}環境…")
    client.api.Open(env)

    try:
        # 官方範例固定等 2 秒，實測有時要 6 秒以上，改成等交易主機回報已連線
        if not client.trade_connected.wait(20):
            sys.exit('20 秒內沒連上元大交易主機，請檢查網路，或稍後再試。')
        print(f'登入 {mask(account)} …')
        login = client.call('Login', lambda: client.api.Login(str(pfx), pfx_password, account, password))
        status = login.LoginStatus
        if status.MsgCode not in LOGIN_OK:
            # 不自動重試：元大限制登入失敗至少間隔 4 秒，一小時內被暫停 10 次會停用 API
            sys.exit(f'登入失敗：{status.MsgCode} {status.MsgContent}')
        print(f'  登入成功（{status.MsgContent}），帳號數 {status.Count}')

        print('查詢股票庫存綜合總表…')
        summary = client.call('GetStoreSummary', lambda: client.api.GetStoreSummary(account))
        tw, foreign = parse_summary(summary)
        print_tables(tw, foreign)

        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"inventory-{datetime.now():%Y%m%d-%H%M%S}.json"
        out_file.write_text(json.dumps({
            'broker': 'yuanta',
            'environment': 'UAT' if args.uat else 'PROD',
            'account': mask(account),
            'fetchedAt': datetime.now().astimezone().isoformat(timespec='seconds'),
            'tw': tw,
            'foreign': foreign,
        }, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\n已寫入 {out_file}')
    finally:
        client.api.LogOut()
        client.api.Close()
        client.api.Dispose()


if __name__ == '__main__':
    main()

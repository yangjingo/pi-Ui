"""verify/run_4 — cwd 可配置的 Core 往返：设到临时目录 → health 反映 → 非法路径报错 → 恢复原 cwd → 清理。
restore 放 finally 保证总恢复；会重置 in-memory session。"""
import sys, urllib.request, urllib.error, json, shutil, os
sys.stdout.reconfigure(encoding="utf-8")
_O = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _O.open(f"http://localhost:{port}/", timeout=3) as r:
            if r.status == 200: BASE = f"http://localhost:{port}/"; break
    except Exception: continue
print("using", BASE)

def get(p):
    return json.loads(_O.open(BASE + 'api/' + p, timeout=8).read().decode())
def post(p, body):
    req = urllib.request.Request(BASE + 'api/' + p, data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json'}, method='POST')
    try:
        resp = _O.open(req, timeout=20)
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())   # 4xx still carries the JSON body

orig = get('health')['cwd']
TEMP = './workspace_cwd_verify'
print("orig cwd:", orig)
set_ok = err_ok = restored = None
try:
    r1 = post('cwd', {'path': TEMP})
    h1 = get('health')
    set_ok = r1.get('ok') is True and r1.get('cwd') == TEMP and h1['cwd'] == TEMP
    r3 = post('cwd', {'path': './bad<>name'})          # invalid path -> error, cwd unchanged
    err_ok = r3.get('ok') is False
    print(f"  set r1={r1} err r3={r3}")
finally:
    r2 = post('cwd', {'path': orig})                    # always restore
    h2 = get('health')
    restored = r2.get('ok') is True and h2['cwd'] == orig
    if os.path.isdir(TEMP): shutil.rmtree(TEMP, ignore_errors=True)
    print(f"  restore r2.ok={r2.get('ok')} health.cwd={h2.get('cwd')}")

print(f"set={set_ok} err={err_ok} restored={restored}")
print("ALL PASS" if (set_ok and err_ok and restored) else "SOME FAILED")

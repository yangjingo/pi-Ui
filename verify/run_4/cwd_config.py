"""verify/run_4 — 工作目录可配置：模型页有 cwd 输入框（预填当前值）+ 保存按钮，
未改动时禁用、改动后启用。（不实际调用 setCwd，以免重置用户正在用的 session。）"""
import sys, pathlib, urllib.request, json
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright
SHOTS = pathlib.Path(__file__).resolve().parent / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _OPENER.open(f"http://localhost:{port}/", timeout=3) as r:
            if r.status == 200: BASE = f"http://localhost:{port}/"; break
    except Exception: continue
print("using", BASE)
health = json.loads(_OPENER.open(BASE + 'api/health', timeout=4).read().decode())
orig_cwd = health.get('cwd', '')
print("health cwd:", orig_cwd)

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(400)

    page.locator('[data-testid="model-center"]').click()
    inp = page.locator('[data-testid="cwd-input"]')
    save = page.locator('[data-testid="cwd-save"]')
    inp.wait_for(timeout=8000)
    page.wait_for_timeout(300)

    prefilled = inp.input_value() == orig_cwd
    disabled_initial = save.is_disabled()
    page.screenshot(path=str(SHOTS / "cwd_config.png"))
    print(f"CP1 input prefilled={prefilled} value={inp.input_value()!r} save-disabled-initial={disabled_initial}")

    # change -> enabled; revert -> disabled
    inp.fill(orig_cwd + '_x')
    page.wait_for_timeout(150)
    enabled_after_change = not save.is_disabled()
    inp.fill(orig_cwd)
    page.wait_for_timeout(150)
    disabled_after_revert = save.is_disabled()
    print(f"CP2 enabled-after-change={enabled_after_change} disabled-after-revert={disabled_after_revert} console-errors={errs[:3]}")

    ok = prefilled and disabled_initial and enabled_after_change and disabled_after_revert and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

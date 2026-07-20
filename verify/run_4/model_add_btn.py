"""verify/run_4 — 模型页「添加自定义」按钮在页面底部居中、全宽（和 Skill 页一致），点击切换表单。"""
import sys, pathlib, urllib.request
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

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    page.locator('[data-testid="model-center"]').click()       # model page (full-page view)
    page.wait_for_selector('[data-testid="add-custom-model"]', timeout=8000)
    btn = page.locator('[data-testid="add-custom-model"]')
    btn.scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    bb = btn.bounding_box()
    pb = page.locator('.page-body').first.bounding_box()
    full_width = bb["width"] >= pb["width"] * 0.7              # full-width primary button
    centered = abs((bb["x"] + bb["width"] / 2) - (pb["x"] + pb["width"] / 2)) < 16
    page.screenshot(path=str(SHOTS / "model_page.png"))
    print(f"CP1 btn width={bb['width']:.0f} page-body={pb['width']:.0f} full-width={full_width} centered={centered}")

    # click -> form appears above the button; label becomes 取消
    btn.click()
    page.wait_for_selector('[data-testid="custom-model-form"]', timeout=5000)
    page.wait_for_timeout(200)
    form_open = page.locator('[data-testid="custom-model-form"]').count() == 1
    page.screenshot(path=str(SHOTS / "model_add_form.png"))
    print(f"CP2 form-opens={form_open} console-errors={errs[:3]}")

    ok = full_width and centered and form_open and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

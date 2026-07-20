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
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(400)
    page.locator('[data-testid="ws-tab"][data-tab="files"]').click()
    page.wait_for_timeout(150)
    page.locator('[data-testid="file-item"]').filter(has_text="budget").first.click()
    page.wait_for_selector('[data-testid="renderer-sheet"]', timeout=10000)
    page.wait_for_timeout(300)
    sheet = page.locator('.r-sheet').first.bounding_box()
    bar = page.locator('.canvas-bar').first.bounding_box()
    page.screenshot(path=str(SHOTS / "sheet_width.png"))
    dl = round(abs(sheet["x"] - bar["x"]), 1)
    dw = round(abs(sheet["width"] - bar["width"]), 1)
    print(f"bar:    x={round(bar['x'])} w={round(bar['width'])}")
    print(f"sheet:  x={round(sheet['x'])} w={round(sheet['width'])}")
    print(f"Δleft={dl}  Δwidth={dw}  ALIGNED={dl <= 1 and dw <= 1}")
    b.close()

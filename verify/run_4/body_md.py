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
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(500)
    md = page.locator('[data-testid="agent-message"] .md-body').count()
    strong = page.locator('[data-testid="agent-message"] .md-body strong').count()
    li = page.locator('[data-testid="agent-message"] .md-body li').count()
    page.screenshot(path=str(SHOTS / "body_md.png"))
    print(f"md-body={md}  strong={strong}  li={li}  RENDERED={md>=1 and strong>0 and li>=3}")
    b.close()

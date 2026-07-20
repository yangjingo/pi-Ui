import sys, pathlib, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RUN = pathlib.Path(__file__).resolve().parent
SHOTS = RUN / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _OPENER.open(f"http://localhost:{port}/", timeout=3) as r:
            if r.status == 200: BASE = f"http://localhost:{port}/"; break
    except Exception: continue
if not BASE: print("No dev server"); sys.exit(2)
print("using", BASE)

def W(sel):
    el = page.locator(sel).first
    return round(el.bounding_box()["width"], 1) if el.count() else None

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(400)

    # CP1 — welcome cards widened (suggest no longer capped at 440)
    sug_w = W('.suggest')
    page.screenshot(path=str(SHOTS / "welcome.png"))
    print(f"CP1 suggest-width={sug_w}  widened={sug_w is not None and sug_w > 700}")

    # CP2 — load demo, open README.md in canvas
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(500)
    page.locator('[data-testid="ws-tab"][data-tab="files"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-testid="file-item"]').filter(has_text="README").first.click()
    md_ok = page.locator('[data-testid="renderer-md"]').count()
    h1_ok = page.locator('.r-doc h1').count()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "md_before_mermaid.png"))
    print(f"CP2 md-rendered={md_ok==1} h1={h1_ok}")

    # CP3 — mermaid renders to SVG (lazy load, give it time)
    try:
        page.wait_for_selector('.mermaid svg', timeout=20000)
        mer_ok = True
    except Exception:
        mer_ok = False
    mer_svg = page.locator('.mermaid svg').count()
    codeblock = page.locator('.r-doc pre.code-block').count()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "md_mermaid.png"))
    print(f"CP3 mermaid-svg={mer_svg}  rendered={mer_ok}  code-blocks={codeblock}")
    print(f"console-errors={errs[:4]}")
    b.close()

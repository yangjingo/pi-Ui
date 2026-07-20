import sys, pathlib, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RUN = pathlib.Path(__file__).resolve().parent
SHOTS = RUN / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _OPENER.open(f"http://localhost:{port}/", timeout=2) as r:
            if r.status == 200: BASE = f"http://localhost:{port}/"; break
    except Exception: continue
if not BASE: print("No dev server on 5173/5174/5175"); sys.exit(2)
print("using", BASE)

def L(sel):
    el = page.locator(sel).first
    return round(el.bounding_box()["x"], 1) if el.count() else None

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    empty_wrap = L('.empty')
    comp_wrap  = L('.composer-wrap')
    page.screenshot(path=str(SHOTS / "1_empty.png"))
    print(f"[empty 1600] .empty.left={empty_wrap}  .composer-wrap.left={comp_wrap}  match={empty_wrap==comp_wrap}")

    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(500)
    msg_box = page.locator('[data-testid="agent-message"]').first.bounding_box()
    msg_content_left = round(msg_box["x"] + 40, 1)
    comp_left2 = L('.composer')
    page.screenshot(path=str(SHOTS / "2_loaded.png"))
    print(f"[loaded 1600] msg_content_left={msg_content_left}  composer.left={comp_left2}  match={msg_content_left==comp_left2}")

    page.set_viewport_size({"width": 1200, "height": 900})
    page.wait_for_timeout(200)
    msg_box2 = page.locator('[data-testid="agent-message"]').first.bounding_box()
    comp_left3 = L('.composer')
    print(f"[1200px] msg_content_left={round(msg_box2['x']+40,1)}  composer.left={comp_left3}  match={round(msg_box2['x']+40,1)==comp_left3}")
    page.screenshot(path=str(SHOTS / "3_narrow.png"))

    b.close()

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
def menu_texts(page):
    return [el.inner_text() for el in page.locator('[data-testid="slash-item"]').all()]
with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="load-demo"]').click()      # workspace now has README/budget/report
    page.wait_for_timeout(400)
    ci = page.locator('[data-testid="composer-input"]')

    # @ -> files
    ci.click(); ci.fill(''); page.keyboard.type('@')
    page.wait_for_selector('[data-testid="slash-menu"]', timeout=5000)
    at_items = menu_texts(page)
    page.screenshot(path=str(SHOTS / "mention_file.png"))
    file_hits = [t for t in at_items if '@README' in t or '@budget' in t or '@report' in t]
    print(f"CP1 @ menu file items={len(file_hits)} texts={file_hits}")

    # / -> skills
    ci.fill(''); page.keyboard.type('/')
    page.wait_for_selector('[data-testid="slash-menu"]', timeout=5000)
    sl_items = menu_texts(page)
    page.screenshot(path=str(SHOTS / "mention_skill.png"))
    skill_hits = [t for t in sl_items if '/周报' in t or '/翻译' in t or '/代码审查' in t]
    print(f"CP2 / menu skill items={len(skill_hits)} texts={skill_hits}")

    # pick @README.md -> tag injected
    ci.fill(''); page.keyboard.type('@')
    page.wait_for_selector('[data-testid="slash-item"]')
    page.locator('[data-testid="slash-item"]').filter(has_text='README').click()
    page.wait_for_timeout(200)
    val = ci.input_value()
    print(f"CP3 @README injected={ '@README.md' in val } value={val!r}")

    print("ALL PASS" if (len(file_hits)>=3 and len(skill_hits)>=3 and '@README.md' in val) else "SOME FAILED")
    b.close()

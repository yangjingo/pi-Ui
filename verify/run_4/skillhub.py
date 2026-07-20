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
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    # open SkillHub (now a full-page view), expect 3 preset skills
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_selector('[data-testid="skill-list"]')
    n0 = page.locator('[data-testid="skill-item"]').count()
    page.screenshot(path=str(SHOTS / "skill_hub_open.png"))
    print(f"CP1 skill-hub opens, preset skills={n0}")

    # add a custom skill
    page.locator('.sa-input').nth(0).fill('问候')
    page.locator('[data-testid="skill-body"]').fill('请用热情的语气向我问好。')
    page.locator('[data-testid="skill-save"]').click()
    page.wait_for_timeout(200)
    n1 = page.locator('[data-testid="skill-item"]').count()
    print(f"CP2 add skill, count {n0}->{n1} added={n1==n0+1}")

    # return to chat, type / in composer -> slash menu
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-testid="composer-input"]').click()
    page.wait_for_timeout(150)
    page.keyboard.type('/')
    page.wait_for_selector('[data-testid="slash-menu"]', timeout=5000)
    slash_n = page.locator('[data-testid="slash-item"]').count()
    page.screenshot(path=str(SHOTS / "slash_menu.png"))
    print(f"CP3 slash-menu appears, items={slash_n}")

    # pick the 翻译 skill -> body injected into composer
    page.locator('[data-testid="slash-item"]').filter(has_text='翻译').click()
    page.wait_for_timeout(200)
    val = page.locator('[data-testid="composer-input"]').input_value()
    page.screenshot(path=str(SHOTS / "slash_injected.png"))
    injected = '请将以下内容' in val
    print(f"CP4 inject skill body, injected={injected} value={val[:40]!r}")
    print("ALL PASS" if (n0==3 and n1==4 and slash_n>=3 and injected) else "SOME FAILED")
    b.close()

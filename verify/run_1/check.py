"""verify/run_1 — icon topbar + model-from-config + MD fills width."""
import sys, pathlib
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RUN = pathlib.Path(__file__).resolve().parent
SHOTS = RUN / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)
BASE = "http://localhost:5173/"

results = {}
def record(cp, ok, note=""): results[cp] = (ok, note); print(f"{cp}: {'PASS' if ok else 'FAIL'} {note}")

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = browser.new_page(viewport={"width": 1440, "height": 1800})
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / "1_loaded.png"))

    # CP1 — no "Kimi" anywhere in the rendered text
    body_text = page.locator("body").inner_text()
    record("CP1 no-kimi", "kimi" not in body_text.lower(), f"kimi_in_text={'kimi' in body_text.lower()}")

    # CP2 — session + model triggers are small icon buttons (no text labels)
    sess = page.locator('[data-testid="session-switcher"]')
    mdl = page.locator('[data-testid="model-center"]')
    sess_is_icon = sess.get_attribute("class") == "icon-btn" or "icon-btn" in (sess.get_attribute("class") or "")
    mdl_is_icon = "icon-btn" in (mdl.get_attribute("class") or "")
    record("CP2 icon-triggers", sess_is_icon and mdl_is_icon, f"session={sess.get_attribute('class')} model={mdl.get_attribute('class')}")
    page.screenshot(path=str(SHOTS / "2_topbar.png"))

    # CP3 — model drawer shows the real configured model (deepseek)
    mdl.click(); page.wait_for_timeout(300)
    drawer_text = page.locator('[data-testid="model-drawer"]').inner_text()
    record("CP3 model-from-config", "deepseek" in drawer_text.lower(), f"drawer_has_deepseek={'deepseek' in drawer_text.lower()}")
    page.screenshot(path=str(SHOTS / "3_model_drawer.png"))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # CP4 — MD preview fills the canvas width (live: write an md file, open it)
    page.locator('[data-testid="composer-input"]').fill(
        "在 workspace 下创建 guide.md，用三行短句介绍这个工作区。只写文件。")
    page.locator('[data-testid="composer-send"]').click()
    # open the workspace once, then poll the file tree
    page.locator('[data-testid="ws-toggle"]').click()
    page.wait_for_timeout(400)
    file_ok = False
    for _ in range(30):
        page.locator('[data-testid="ws-tab"]').first.click()
        page.wait_for_timeout(250)
        if page.locator('[data-testid="file-item"]', has_text="guide.md").count() > 0:
            file_ok = True; break
        page.wait_for_timeout(500)
    md_fills = False
    if file_ok:
        page.locator('[data-testid="file-item"]', has_text="guide.md").first.click()
        try:
            page.locator('[data-testid="renderer-md"]').wait_for(state="visible", timeout=8000)
            vp = page.locator('[data-testid="canvas-viewport"]').bounding_box()
            doc = page.locator('[data-testid="renderer-md"]').bounding_box()
            # r-doc should span most of the viewport width (not a narrow 420px column)
            md_fills = doc["width"] > (vp["width"] - 24) * 0.9
            record("CP4 md-fills-width", md_fills, f"doc_w={doc['width']:.0f} vp_w={vp['width']:.0f}")
        except Exception as e:
            record("CP4 md-fills-width", False, f"err={e}")
    else:
        record("CP4 md-fills-width", False, "guide.md never appeared")
    page.screenshot(path=str(SHOTS / "4_md_fill.png"))

    page.screenshot(path=str(SHOTS / "final.png"))
    browser.close()

benign = [e for e in errors if "favicon" not in e.lower()]
ok = all(v[0] for v in results.values()) and len(benign) == 0
print(f"\nconsole errors: {len(errors)} (non-benign {len(benign)})")
for e in errors: print("  ERR:", e)
print("OVERALL:", "PASS" if ok else "FAIL")

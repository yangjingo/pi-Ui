"""verify/run_2 — unified icon sizes + canvas fills height / footer flush at bottom."""
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

    # CP1 — open the session drawer (reveals the rename/delete action icons) and verify
    # every UI svg carries the .i baseline (no unsized class="" exceptions) and is small
    page.locator('[data-testid="session-switcher"]').click(); page.wait_for_timeout(300)
    info = page.evaluate("""()=>{
      const svgs = Array.from(document.querySelectorAll('svg'));
      const acts = Array.from(document.querySelectorAll('.s-acts svg'));
      const noI = svgs.filter(s => !/\\bi\\b/.test(s.getAttribute('class')||'')).length;
      const emptyClass = svgs.filter(s => !s.getAttribute('class') || s.getAttribute('class').trim()==='').length;
      const actSizes = acts.map(s => parseFloat(getComputedStyle(s).width));
      return {total: svgs.length, missingI: noI, emptyClass,
              actCount: acts.length, actMax: actSizes.length ? Math.max(...actSizes) : -1};
    }""")
    page.screenshot(path=str(SHOTS / "0_drawer_icons.png"))
    record("CP1 unified-icons",
           info["missingI"] == 0 and info["emptyClass"] == 0 and info["actCount"] >= 2 and info["actMax"] <= 16,
           f"svgs={info['total']} missingI={info['missingI']} emptyClass={info['emptyClass']} s-acts={info['actCount']} actMax={info['actMax']}px")
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # open workspace + Canvas tab; canvas-shell should fill body height, footer flush at bottom
    page.locator('[data-testid="ws-toggle"]').click(); page.wait_for_timeout(300)
    page.locator('[data-testid="ws-tab"]').nth(1).click(); page.wait_for_timeout(300)  # Canvas tab
    page.screenshot(path=str(SHOTS / "1_canvas.png"))
    geom = page.evaluate("""()=>{
      const shell = document.querySelector('.canvas-shell').getBoundingClientRect();
      const footer = document.querySelector('.canvas-footer').getBoundingClientRect();
      const body = document.querySelector('.ws-body').getBoundingClientRect();
      const ws = document.querySelector('.workspace').getBoundingClientRect();
      return {shell_h: shell.height, body_h: body.height, ws_h: ws.height,
              footer_bottom: footer.bottom, ws_bottom: ws.bottom,
              gap: ws.bottom - footer.bottom};
    }""")
    record("CP2 canvas-fills", geom["shell_h"] > geom["body_h"] * 0.9, f"shell_h={geom['shell_h']:.0f} body_h={geom['body_h']:.0f}")
    record("CP3 footer-flush", geom["gap"] <= 8, f"gap_below_footer={geom['gap']:.0f}px")

    page.screenshot(path=str(SHOTS / "final.png"))
    browser.close()

benign = [e for e in errors if "favicon" not in e.lower()]
ok = all(v[0] for v in results.values()) and len(benign) == 0
print(f"console errors: {len(errors)} (non-benign {len(benign)})")
for e in errors: print("  ERR:", e)
print("OVERALL:", "PASS" if ok else "FAIL")

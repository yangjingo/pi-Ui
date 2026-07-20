"""verify/run_4 — canvas 预览区布局：所有内容（html 预览 / turn-report / step-result）
填满 canvas 内容区宽度、彼此对齐；html 预览无边框。充分利用布局、留可读边距。"""
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

def box(page, sel):
    el = page.locator(sel).first
    return el.bounding_box() if el.count() else None

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(600)

    cv = box(page, '[data-testid="canvas-viewport"]')
    content_w = cv["width"]  # canvas-viewport width; content fills its padded box
    print(f"canvas-viewport width={content_w:.0f}")

    # CP1 — html preview: borderless + fills width
    page.locator('.out-card').filter(has_text="report.html").locator('[data-testid="open-canvas"]').click()
    page.wait_for_selector('[data-testid="renderer-html"]', timeout=8000)
    page.wait_for_timeout(400)
    ifr = box(page, '[data-testid="renderer-html"] .r-html')
    # computed border on the iframe inside canvas should be 0
    border = page.eval_on_selector('.canvas-viewport .r-html',
        "el => getComputedStyle(el).borderTopWidth")
    html_fills = ifr and ifr["width"] >= content_w * 0.9
    borderless = border == "0px"
    page.screenshot(path=str(SHOTS / "cv_html.png"))
    print(f"CP1 html iframe width={ifr['width']:.0f} border={border} fills={html_fills} borderless={borderless}")

    # CP2 — turn-report fills width
    page.locator('[data-testid="open-turn"]').first.click()
    page.wait_for_selector('[data-testid="turn-report"]', timeout=8000)
    page.wait_for_timeout(300)
    tr = box(page, '[data-testid="turn-report"]')
    tr_fills = tr and tr["width"] >= content_w * 0.9
    page.screenshot(path=str(SHOTS / "cv_turn.png"))
    print(f"CP2 turn-report width={tr['width']:.0f} fills={tr_fills}")

    # CP3 — step-result (traj input/output) fills width
    page.locator('[data-testid="turn-step"]').first.click()
    page.wait_for_selector('[data-testid="renderer-step"]', timeout=8000)
    page.wait_for_timeout(300)
    sr = box(page, '[data-testid="renderer-step"]')
    sr_fills = sr and sr["width"] >= content_w * 0.9
    page.screenshot(path=str(SHOTS / "cv_step.png"))
    print(f"CP3 step-result width={sr['width']:.0f} fills={sr_fills} console-errors={errs[:3]}")

    ok = html_fills and borderless and tr_fills and sr_fills and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

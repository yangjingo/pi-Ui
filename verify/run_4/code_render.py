"""verify/run_4 — canvas 渲染源码文件（.py 等）为代码块，而非被当 markdown。

回归：report.html 仍以 iframe 实时渲染。
"""
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
print("using", BASE)

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

    # CP1 — open run_pipeline.py from its artifact card (.out-meta) -> renders as CODE
    page.locator('.out-card').filter(has_text="run_pipeline").locator('[data-testid="open-canvas"]').click()
    page.wait_for_selector('[data-testid="renderer-code"]', timeout=8000)
    code = page.locator('[data-testid="renderer-code"]')
    pre_text = code.locator('pre').inner_text()
    is_code = code.count() == 1
    not_md = page.locator('[data-testid="renderer-md"]').count() == 0
    has_def = 'def parse_report' in pre_text
    has_shebang = '#!/usr/bin/env python3' in pre_text      # the '#' must stay literal, not become <h1>
    no_h1 = page.locator('.canvas-viewport h1').count() == 0
    page.screenshot(path=str(SHOTS / "code_render.png"))
    print(f"CP1 renderer-code={is_code} not-md={not_md} has-def={has_def} has-shebang={has_shebang} no-h1={no_h1}")

    # CP2 — report.html: default PREVIEW (iframe); toggle to source shows code; toggle back
    page.locator('.out-card').filter(has_text="report.html").locator('[data-testid="open-canvas"]').click()
    page.wait_for_timeout(500)
    rh = page.locator('[data-testid="renderer-html"]')
    preview_default = rh.locator('iframe').count() == 1
    page.locator('[data-testid="html-source"]').click()
    page.wait_for_timeout(300)
    src_text = rh.locator('pre').inner_text().lower()
    source_shows = '<!doctype' in src_text or '检测报告' in src_text.lower()
    page.locator('[data-testid="html-preview"]').click()
    page.wait_for_timeout(300)
    back_to_preview = rh.locator('iframe').count() == 1
    page.screenshot(path=str(SHOTS / "html_preview.png"))
    print(f"CP2 preview-default={preview_default} source-shows-code={source_shows} back-to-preview={back_to_preview} console-errors={errs[:3]}")
    html_ok = preview_default and source_shows and back_to_preview

    ok = is_code and not_md and has_def and has_shebang and no_h1 and html_ok and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

"""verify/run_4 — SkillHub 两栏：左列表选中 → 右侧复用 canvas 渲染预览（MdText）/ 改写保存 / 删除。"""
import sys, pathlib, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright
RUN = pathlib.Path(__file__).resolve().parent
SHOTS = RUN / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)
_OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _OP.open(f"http://localhost:{port}/", timeout=3) as r:
            if r.status == 200: BASE = f"http://localhost:{port}/"; break
    except Exception: continue
print("using", BASE)

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_selector('[data-testid="skill-list"]', timeout=5000)
    page.wait_for_timeout(200)

    # CP1 — two-pane layout (left list + right detail)
    two_pane = page.locator('.skill-pane-left').count() == 1 and page.locator('.skill-pane-right').count() == 1
    empty_initial = page.locator('[data-testid="skill-detail"]').count() == 0
    print(f"CP1 two-pane={two_pane} no-detail-until-select={empty_initial}")

    # CP2 — select first skill -> detail shows; preview renders its body (Canvas MdText)
    page.locator('[data-testid="skill-item"]').nth(0).click()
    page.wait_for_selector('[data-testid="skill-detail"]', timeout=5000)
    page.wait_for_timeout(300)
    active = page.locator('[data-testid="skill-item"].active').count() == 1
    preview_text = page.locator('[data-testid="skill-detail"] .r-doc').inner_text()
    preview_ok = ('周报' in preview_text) or ('工作' in preview_text)
    page.screenshot(path=str(SHOTS / "skillhub_preview.png"))
    print(f"CP2 selected-active={active} preview-renders-body={preview_ok} (len={len(preview_text)})")

    # CP3 — switch to 改写 -> textarea seeded with current body; rewrite + save -> preview updates
    page.locator('[data-testid="skill-edit"]').click()
    page.wait_for_selector('[data-testid="skill-edit-body"]', timeout=5000)
    page.wait_for_timeout(150)
    seeded = '周报' in page.locator('[data-testid="skill-edit-body"]').input_value()
    page.locator('[data-testid="skill-edit-body"]').fill('改写后的独特标记 XYZ123')
    page.wait_for_timeout(150)
    body_before = page.locator('[data-testid="skill-edit-body"]').input_value()
    page.locator('[data-testid="skill-edit-save"]').click()
    page.wait_for_timeout(400)
    mode_preview = page.locator('[data-testid="skill-preview"].on').count() == 1
    after = page.locator('[data-testid="skill-detail"] .r-doc').inner_text()
    saved = 'XYZ123' in after
    page.screenshot(path=str(SHOTS / "skillhub_saved.png"))
    print(f"CP3 edit-seeded={seeded} body_before={body_before!r} mode-preview={mode_preview} after={after[:80]!r} saved={saved}")

    # CP4 — delete the selected skill -> list shrinks, detail clears
    page.locator('[data-testid="skill-edit"]').click()
    page.wait_for_timeout(150)
    n0 = page.locator('[data-testid="skill-item"]').count()
    page.locator('[data-testid="skill-del"]').click()
    page.wait_for_timeout(250)
    n1 = page.locator('[data-testid="skill-item"]').count()
    detail_cleared = page.locator('[data-testid="skill-detail"]').count() == 0
    print(f"CP4 delete count {n0}->{n1} detail-cleared={detail_cleared} console-errors={errs[:3]}")

    ok = two_pane and empty_initial and active and preview_ok and seeded and saved and (n1 == n0 - 1) and detail_cleared and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

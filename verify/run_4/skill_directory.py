"""verify/run_4 — skill = 文件目录：旧 {body} 迁移成 SKILL.md；zip 全文件保留并预览；
按文件改写；新增文件；/ 注入用 SKILL.md 正文。"""
import sys, pathlib, urllib.request, zipfile, json, os, shutil
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright
RUN = pathlib.Path(__file__).resolve().parent
SHOTS = RUN / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)
_O = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _O.open(f"http://localhost:{port}/", timeout=3) as r:
            if r.status == 200: BASE = f"http://localhost:{port}/"; break
    except Exception: continue
print("using", BASE)

# a multi-file skill zip: SKILL.md + a nested md + an html
multi_zip = str(RUN / "skill_multi.zip")
with zipfile.ZipFile(multi_zip, "w") as z:
    z.writestr("SKILL.md", "---\nname: 多文件\ndescription: 目录结构 skill\n---\n这是主入口正文。")
    z.writestr("references/notes.md", "# 参考\n一些参考笔记 UNIQUE_MD_MARKER。")
    z.writestr("assets/tpl.html", "<!doctype html><html><body><h1>UNIQUE_HTML_MARKER</h1></body></html>")

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})

    # CP1 — migration: seed legacy {body} skills, load, each becomes a single SKILL.md
    ctx = b.new_context()
    ctx.add_init_script("localStorage.setItem('chatbotui.skills', %s)" % json.dumps(json.dumps([
        {"id": "old1", "name": "旧技能", "desc": "迁移测试", "body": "旧正文 LEGACY_BODY_MARKER"},
    ])))
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_selector('[data-testid="skill-item"]', timeout=5000)
    page.locator('[data-testid="skill-item"]').first.click()
    page.wait_for_selector('[data-testid="skill-detail"]', timeout=5000)
    page.wait_for_timeout(300)
    tree_files = [el.inner_text() for el in page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').all()]
    has_skill_md = any('SKILL.md' in t for t in tree_files)
    preview = page.locator('[data-testid="skill-detail"] .r-doc').inner_text()
    migrated = has_skill_md and 'LEGACY_BODY_MARKER' in preview
    page.screenshot(path=str(SHOTS / "skill_migration.png"))
    print(f"CP1 migration: tree={tree_files} has-SKILL.md={has_skill_md} body-migrated={'LEGACY_BODY_MARKER' in preview}")
    ctx.close()

    # CP2-5 on a fresh context (presets)
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_selector('[data-testid="skill-upload"]', timeout=5000)

    # CP2 — upload multi-file zip → skill keeps all 3 files; preview md + html
    page.locator('[data-testid="skill-upload"] input[type=file], input[type=file]').first.set_input_files(multi_zip)
    page.wait_for_timeout(400)
    page.locator('[data-testid="skill-save"]').click()
    page.wait_for_timeout(300)
    # the new skill is now first in the list
    page.locator('[data-testid="skill-item"]').first.click()
    page.wait_for_selector('[data-testid="skill-detail"]', timeout=5000)
    page.wait_for_timeout(300)
    files = [el.inner_text() for el in page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').all()]
    page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').filter(has_text="notes.md").first.click()
    page.wait_for_timeout(300)
    md_preview = page.locator('[data-testid="skill-detail"] .r-doc').inner_text()
    md_ok = 'UNIQUE_MD_MARKER' in md_preview
    # html file (nested under assets/)
    page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').filter(has_text="tpl.html").first.click()
    page.wait_for_timeout(400)
    html_ok = page.locator('[data-testid="skill-detail"] [data-testid="skill-file-html"] iframe').count() == 1
    page.screenshot(path=str(SHOTS / "skill_multifile.png"))
    print(f"CP2 multi-file: files={files} md-preview={md_ok} html-preview={html_ok}")

    # CP3 — per-file edit: select notes.md → 改写 → save → persists
    page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').filter(has_text="notes.md").first.click()
    page.locator('[data-testid="skill-edit"]').click()
    page.wait_for_selector('[data-testid="skill-edit-body"]', timeout=5000)
    page.locator('[data-testid="skill-edit-body"]').fill("改写后的笔记 REWRITTEN_MARKER")
    page.locator('[data-testid="skill-edit-save"]').click()
    page.wait_for_timeout(300)
    rewritten = 'REWRITTEN_MARKER' in page.locator('[data-testid="skill-detail"] .r-doc').inner_text()
    print(f"CP3 per-file rewrite: {rewritten}")

    # CP4 — add a file (attach the dialog handler BEFORE the click — Playwright
    # auto-dismisses a prompt that fires before any handler is attached)
    n0 = len(page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').all())
    page.once("dialog", lambda d: d.accept("new.md"))  # prompt → new.md
    page.locator('[data-testid="skill-add-file"]').click()
    page.wait_for_timeout(300)
    n1 = len(page.locator('[data-testid="skill-detail"] [data-testid="file-item"]').all())
    print(f"CP4 add-file: {n0}->{n1} added={n1 == n0 + 1}")

    # CP5 — / injection inlines the SKILL.md body (preset 周报)
    page.locator('[data-testid="skill-hub"]').click()  # back to chat
    page.wait_for_timeout(200)
    ci = page.locator('[data-testid="composer-input"]')
    ci.click(); ci.fill(''); page.keyboard.type('/周报')
    page.wait_for_timeout(200)
    page.locator('[data-testid="slash-item"]').filter(has_text="周报").click()
    page.wait_for_timeout(200)
    val = ci.input_value()
    inject_ok = '周报' in val and '本周' in val
    print(f"CP5 /-injection: injected={inject_ok} value={val[:50]!r} console-errors={errs[:3]}")

    ok = migrated and (len(files) >= 3) and md_ok and html_ok and rewritten and (n1 == n0 + 1) and inject_ok and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

"""verify/run_4 — 三按钮【整页视图】（非 modal）+ SkillHub zip(SKILL.md) 导入。

点击左上三按钮不再弹 modal，而是把主区域整页切到对应配置视图（.app.page-view，
无 .modal-backdrop/.modal-card 浮层）；再点同一按钮回到对话。
"""
import sys, pathlib, urllib.request, zipfile, os
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

good_zip = str(RUN / "skill_good.zip")
with zipfile.ZipFile(good_zip, "w") as z:
    z.writestr("SKILL.md", "---\nname: 测试\ndescription: zip 导入的 skill\n---\n这是正文内容")
bad_zip = str(RUN / "skill_bad.zip")
with zipfile.ZipFile(bad_zip, "w") as z:
    z.writestr("readme.md", "no SKILL.md here")
big_zip = str(RUN / "skill_big.zip")
with zipfile.ZipFile(big_zip, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("SKILL.md", os.urandom(5_000_000).hex())
empty_zip = str(RUN / "skill_empty.zip")
with zipfile.ZipFile(empty_zip, "w") as z:
    z.writestr("SKILL.md", "---\nname: 空\ndescription: 没有正文\n---\n")

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    # CP1 session-switcher -> full-page view (NOT a modal): page-view class, no overlay, chat hidden
    page.locator('[data-testid="session-switcher"]').click()
    page.wait_for_timeout(250)
    page_view = page.locator('.app.page-view').count() == 1
    no_overlay = page.locator('.modal-backdrop').count() == 0 and page.locator('.modal-card').count() == 0
    session_list = page.locator('[data-testid="session-list"]').count() == 1
    chat_hidden = page.locator('[data-testid="composer-input"]').count() == 0
    page.screenshot(path=str(SHOTS / "page_sessions.png"))
    print(f"CP1 page-view={page_view} no-overlay={no_overlay} session-list={session_list} chat-hidden={chat_hidden}")
    page.locator('[data-testid="session-switcher"]').click()
    page.wait_for_timeout(250)
    back_to_chat = page.locator('.app.page-view').count() == 0 and page.locator('[data-testid="composer-input"]').count() == 1
    print(f"CP1b toggle-back-to-chat={back_to_chat}")

    # CP2 model -> page; skill -> single active view (mutual exclusion)
    page.locator('[data-testid="model-center"]').click()
    page.wait_for_timeout(300)
    model_open = page.locator('[data-testid="add-custom-model"]').count() == 1
    skill_absent = page.locator('[data-testid="skill-list"]').count() == 0
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_timeout(300)
    skill_open = page.locator('[data-testid="skill-list"]').count() == 1
    model_absent = page.locator('[data-testid="add-custom-model"]').count() == 0
    page.screenshot(path=str(SHOTS / "page_skill.png"))
    mutual = model_open and skill_absent and skill_open and model_absent
    print(f"CP2 model-page={model_open} skill-absent-then={skill_absent} skill-page={skill_open} model-absent-after={model_absent}")

    # CP3 good zip -> whole-package pending (name prefilled, "zip 已解析" notice, body empty)
    #                  -> not added yet -> commit -> imported as a directory
    n0 = page.locator('[data-testid="skill-item"]').count()
    page.locator('input[type=file]').set_input_files(good_zip)
    page.wait_for_timeout(400)
    name_val = page.locator('input[placeholder="名称（如：周报）"]').input_value()
    body_val = page.locator('[data-testid="skill-body"]').input_value()
    notice = page.locator('text=zip 已解析').count() == 1   # pendingFiles whole-package notice
    prefill_ok = '测试' in name_val and notice and body_val == ''   # body taken over by pendingFiles
    not_added_yet = page.locator('[data-testid="skill-item"]').count() == n0
    page.locator('[data-testid="skill-save"]').click()
    page.wait_for_timeout(250)
    n1 = page.locator('[data-testid="skill-item"]').count()
    texts = [el.inner_text() for el in page.locator('[data-testid="skill-item"]').all()]
    imported = any('测试' in t for t in texts)
    print(f"CP3 zip-package name-prefilled={'测试' in name_val} notice={notice} body-empty={body_val == ''} not-added-yet={not_added_yet} count {n0}->{n1} imported={imported}")

    # CP4 no SKILL.md -> err, count unchanged
    page.locator('input[type=file]').set_input_files(bad_zip)
    page.wait_for_timeout(300)
    err_visible = page.locator('[data-testid="skill-import-err"]').count()
    n2 = page.locator('[data-testid="skill-item"]').count()
    print(f"CP4 no-SKILL.md err={err_visible} count unchanged={n2 == n1}")

    # CP6 too-big -> rejected
    page.locator('input[type=file]').set_input_files(big_zip)
    page.wait_for_timeout(500)
    err_text = page.locator('[data-testid="skill-import-err"]').inner_text()
    n3 = page.locator('[data-testid="skill-item"]').count()
    too_big = '过大' in err_text and n3 == n2
    print(f"CP6 too-big err='{err_text}' rejected={too_big}")

    # CP7 empty-body -> rejected
    page.locator('input[type=file]').set_input_files(empty_zip)
    page.wait_for_timeout(300)
    err_text2 = page.locator('[data-testid="skill-import-err"]').inner_text()
    n4 = page.locator('[data-testid="skill-item"]').count()
    empty_body = '正文' in err_text2 and n4 == n3
    print(f"CP7 empty-body err='{err_text2}' rejected={empty_body}")

    # CP5 click skill-hub again -> back to chat
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_timeout(250)
    returned = page.locator('.app.page-view').count() == 0 and page.locator('[data-testid="composer-input"]').count() == 1
    print(f"CP5 toggle-back-to-chat={returned} console-errors={errs[:3]}")

    ok = (page_view and no_overlay and session_list and chat_hidden and back_to_chat and mutual
          and prefill_ok and not_added_yet and imported and err_visible and n2 == n1
          and too_big and empty_body and returned and not errs)
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

"""verify/run_4 — 工作目录通过文件夹选择弹窗选取（类似上传 zip）：模型页有「选择工作目录」
按钮 + 隐藏 webkitdirectory input；选目录后把顶层文件夹名预填到 cwd 输入框（不保存，避免重置 session）。"""
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

# a folder to "pick" — webkitdirectory input will see pickedfolder/seed.txt
pick_root = RUN / "_picktest"
pick_dir = pick_root / "pickedfolder"
pick_dir.mkdir(parents=True, exist_ok=True)
(pick_dir / "seed.txt").write_text("hi", encoding="utf-8")

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    page.locator('[data-testid="model-center"]').click()
    cwd_input = page.locator('[data-testid="cwd-input"]')
    cwd_input.wait_for(timeout=8000)
    page.wait_for_timeout(200)
    orig = cwd_input.input_value()

    pick_btn = page.locator('[data-testid="cwd-pick"]')
    pick_exists = '选择工作目录' in pick_btn.inner_text()
    wd = page.locator('input[webkitdirectory]')
    has_wd = wd.count() == 1
    page.screenshot(path=str(SHOTS / "cwd_pick.png"))
    print(f"CP1 pick-button={pick_exists} webkitdirectory-input={has_wd} orig={orig!r}")

    # simulate choosing the folder -> onPickDir prefills cwd input
    try:
        wd.set_input_files(str(pick_dir))
    except Exception as e:
        wd.set_input_files(str(pick_dir / "seed.txt"))
    page.wait_for_timeout(250)
    new_val = cwd_input.input_value()
    prefilled = bool(new_val) and new_val != orig
    print(f"CP2 after-pick cwd-input={new_val!r} prefilled={prefilled} console-errors={errs[:3]}")

    # cleanup the temp pick dir
    import shutil
    shutil.rmtree(pick_root, ignore_errors=True)

    ok = pick_exists and has_wd and prefilled and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

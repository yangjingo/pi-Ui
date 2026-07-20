"""verify/run_4 Part B — session 数据中心拖拽上传。

拖一个文本文件到 [files-panel] → 走 saveFile 写入工作目录，文件出现在树里；
拖一个二进制（含 NUL 字节的 PNG）→ 跳过并提示。

（Playwright 没有原生 HTML5 拖拽文件的 API，这里在页面内合成一个带 File 的
DataTransfer，再 dispatch 一个真实 DragEvent('drop')，让 React 的 onDrop 处理。）
"""
import sys, pathlib, base64, urllib.request
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

MD_NAME = "dragged_notes.md"
MD_TEXT = "# 拖进来的笔记\nDRAG_UPLOAD_TEXT_MARKER 正文内容。"
MD_B64 = base64.b64encode(MD_TEXT.encode("utf-8")).decode("ascii")

# 1x1 PNG — 真实图片字节，含 NUL，应被 onFileDrop 判为二进制跳过
PNG_NAME = "tiny_pic.png"
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

DROP_JS = """
([selector, filename, mime, b64]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const file = new File([bytes], filename, { type: mime });
  const dt = new DataTransfer();
  dt.items.add(file);
  const el = document.querySelector(selector);
  if (!el) return "no-target";
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop",     { bubbles: true, dataTransfer: dt }));
  return "ok";
}
"""


def tree_text(page):
    el = page.query_selector('[data-testid="file-tree"]')
    return el.inner_text() if el else ""


with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(400)

    # 载入 demo session（带工作区），workspace aside 才可见
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(500)

    # 打开「数据中心」面板
    page.locator('[data-testid="ws-tab"][data-tab="files"]').click()
    page.wait_for_timeout(200)

    # CP1 — 拖一个文本文件 → 出现在工作区文件树里
    res = page.evaluate(DROP_JS, ['[data-testid="files-panel"]', MD_NAME, "text/markdown", MD_B64])
    # 等 saveFile（POST /api/file）往返 + Core 的 'file' 事件刷树
    md_in_tree = False
    for _ in range(30):
        if MD_NAME in tree_text(page):
            md_in_tree = True; break
        page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "drag_text.png"))
    print(f"CP1 text-drop: dispatch={res} in-tree={md_in_tree}")

    # CP2 — 拖一个二进制图片 → 不进树，出现跳过提示
    before = tree_text(page)
    res2 = page.evaluate(DROP_JS, ['[data-testid="files-panel"]', PNG_NAME, "image/png", PNG_B64])
    page.wait_for_timeout(400)
    after = tree_text(page)
    png_in_tree = PNG_NAME in after
    skip_msg = page.locator('[data-testid="drop-msg"]').count() >= 1 and "跳过" in (page.locator('[data-testid="drop-msg"]').inner_text() or "")
    page.screenshot(path=str(SHOTS / "drag_binary.png"))
    print(f"CP2 binary-drop: dispatch={res2} in-tree={png_in_tree} skip-msg={skip_msg}")

    ok = (res == "ok") and md_in_tree and (res2 == "ok") and (not png_in_tree) and skip_msg and not errs
    print("ALL PASS" if ok else "SOME FAILED", "(errors:", errs[:3], ")" if errs else ")")
    b.close()

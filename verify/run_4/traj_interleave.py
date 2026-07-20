"""verify/run_4 — traj 里 tool 与 thinking 交错展示（参考 docs/gk-ui 的 text⇄tool⇄text flow）。

- 不再有单独的「思考过程」块；thinking 作为 'think' traj 行，按发生顺序与 tool 行交错。
- 点 think 行 → 右侧显示 reasoning（step-think）；点 tool 行 → 显示输入/输出（step-io）。
- turn-report：工具调用数排除 think；时间线含交错的 think 行。
"""
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
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(600)

    # CP1 — no standalone '思考过程' block anymore
    no_think_block = page.locator('[data-testid="think"]').count() == 0
    print(f"CP1 no-standalone-think-block={no_think_block}")

    # CP2 — conversation traj rows interleave think + tool (in DOM order)
    rows = page.locator('[data-testid="traj-row"]')
    n = rows.count()
    kinds = [rows.nth(i).get_attribute("data-kind") for i in range(n)]
    think_idx = [i for i, k in enumerate(kinds) if k == 'think']
    tool_idx = [i for i, k in enumerate(kinds) if k != 'think']
    first_is_think = kinds[0] == 'think' if kinds else False
    interleaved = any(i > 0 for i in think_idx)   # a think row that is NOT the first → interleaved
    print(f"CP2 rows={n} kinds={kinds} think_idx={think_idx} first-think={first_is_think} interleaved={interleaved}")

    # CP3 — turn-report: 工具调用 excludes think; timeline has the interleaved think rows
    page.locator('[data-testid="open-turn"]').first.click()
    page.wait_for_selector('[data-testid="turn-report"]', timeout=8000)
    page.wait_for_timeout(300)
    tool_kpi = page.locator('[data-testid="turn-kpis"] .tr-kpi').first.locator('b').inner_text()
    tl_rows = page.locator('[data-testid="turn-step"]')
    tl_n = tl_rows.count()
    tl_kinds = ['think' if '思考' in tl_rows.nth(i).inner_text() else 'tool' for i in range(tl_n)]
    tl_interleaved = any(tl_kinds[i] == 'think' for i in range(1, tl_n))
    print(f"CP3 tool-kpi={tool_kpi} timeline-rows={tl_n} timeline-kinds={tl_kinds} interleaved={tl_interleaved}")
    kpi_ok = tool_kpi == '6' and tl_n == 8 and tl_interleaved

    # CP4 — click a think step -> reasoning (step-think); click a tool step -> 输入/输出 (step-io)
    page.locator('[data-testid="turn-step"]').nth(0).click()   # first = think (planning)
    page.wait_for_selector('[data-testid="renderer-step"]', timeout=8000)
    page.wait_for_timeout(200)
    think_view = page.locator('[data-testid="step-think"]').count() == 1
    no_io_for_think = page.locator('.step-io').count() == 0
    page.screenshot(path=str(SHOTS / "traj_think_step.png"))
    # canvas now shows StepResult; reopen the turn-report timeline to click a tool step
    tool_step_i = next((i for i, k in enumerate(tl_kinds) if k == 'tool'), None)
    page.locator('[data-testid="open-turn"]').first.click()
    page.wait_for_selector('[data-testid="turn-step"]', timeout=8000)
    page.locator('[data-testid="turn-step"]').nth(tool_step_i).click()
    page.wait_for_selector('[data-testid="renderer-step"]', timeout=8000)
    page.wait_for_timeout(300)
    tool_view = page.locator('.step-io').count() >= 1
    page.screenshot(path=str(SHOTS / "traj_tool_step.png"))
    print(f"CP4 think->reasoning={think_view} no-io-for-think={no_io_for_think} tool->io={tool_view}")

    ok = (no_think_block and len(think_idx) >= 2 and len(tool_idx) >= 5 and first_is_think
          and interleaved and kpi_ok and think_view and no_io_for_think and tool_view and not errs)
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

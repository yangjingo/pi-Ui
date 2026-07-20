"""verify/run_3 — left↔right data-center linkage + data-overview Report (mocked e2e).

Covers: load demo data → Report tab KPIs/tables → row jumps into Canvas
(step detail / file / turn report) → prev/next nav. Mock data is deterministic.
"""
import sys, pathlib, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RUN = pathlib.Path(__file__).resolve().parent
SHOTS = RUN / "screenshots"; SHOTS.mkdir(parents=True, exist_ok=True)

_NO_PROXY = urllib.request.ProxyHandler({})
_OPENER = urllib.request.build_opener(_NO_PROXY)

# Pick whichever dev port is up (5173 is the default; 5174 if 5173 was occupied).
BASE = None
for port in (5173, 5174, 5175):
    try:
        with _OPENER.open(f"http://localhost:{port}/", timeout=2) as r:
            if r.status == 200:
                BASE = f"http://localhost:{port}/"; break
    except Exception:
        continue
if not BASE:
    print("No dev server found on 5173/5174/5175"); sys.exit(2)
print(f"using {BASE}")
results = {}


def record(cp, ok, note=""):
    results[cp] = (ok, note)
    print(f"{cp}: {'PASS' if ok else 'FAIL'} {note}")


with sync_playwright() as p:
    browser = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = browser.new_page(viewport={"width": 1440, "height": 1800})
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(400)

    # CP1 — load demo data; agent message appears + workspace auto-opens the turn report
    page.locator('[data-testid="load-demo"]').click()
    page.wait_for_timeout(500)
    n_agent = page.locator('[data-testid="agent-message"]').count()
    turn_visible = page.locator('[data-testid="turn-report"]').count()
    page.screenshot(path=str(SHOTS / "1_load_demo.png"))
    record("CP1 load-demo+auto-open",
           n_agent == 1 and turn_visible == 1,
           f"agent={n_agent} turn-report={turn_visible}")

    # CP2 — Report tab overview: KPI cards carry the seeded counts (1 turn / 6 tools / 3 files)
    page.locator('[data-testid="ws-tab"][data-tab="report"]').click()
    page.wait_for_timeout(300)
    page.locator('[data-testid="report-nav"][data-sec="overview"]').click()
    page.wait_for_timeout(200)
    kpis = page.locator('[data-testid="report-kpi"] b').all_text_contents()
    page.screenshot(path=str(SHOTS / "2_report_overview.png"))
    vals = [k.strip() for k in kpis]
    record("CP2 report-overview-kpis",
           "1" in vals and "6" in vals and "3" in vals,
           f"kpi-values={vals}")

    # CP3 — 工具调用 table has 6 rows; clicking the first opens the step detail in Canvas
    page.locator('[data-testid="report-nav"][data-sec="tools"]').click()
    page.wait_for_timeout(200)
    n_tools = page.locator('[data-testid="report-tool-row"]').count()
    page.locator('[data-testid="report-tool-row"]').first.click()
    page.wait_for_timeout(350)
    step_visible = page.locator('[data-testid="renderer-step"]').count()
    page.screenshot(path=str(SHOTS / "3_tool_step.png"))
    record("CP3 tools-table+step-jump",
           n_tools == 6 and step_visible == 1,
           f"tool-rows={n_tools} renderer-step={step_visible}")

    # CP4 — 数据产物 table has 3 rows; clicking opens the file in Canvas
    page.locator('[data-testid="ws-tab"][data-tab="report"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-testid="report-nav"][data-sec="files"]').click()
    page.wait_for_timeout(200)
    n_files = page.locator('[data-testid="report-file-row"]').count()
    page.locator('[data-testid="report-file-row"]').first.click()
    page.wait_for_timeout(400)
    rendered = page.locator('[data-testid="canvas-viewport"] [data-testid^="renderer-"]').count()
    page.screenshot(path=str(SHOTS / "4_file_open.png"))
    record("CP4 files-table+file-jump",
           n_files == 3 and rendered >= 1,
           f"file-rows={n_files} rendered={rendered}")

    # CP5 — 对话轮次 table has 1 row; clicking opens the TurnReport; a timeline step
    # opens step detail and the ← → nav advances it
    page.locator('[data-testid="ws-tab"][data-tab="report"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-testid="report-nav"][data-sec="turns"]').click()
    page.wait_for_timeout(200)
    n_turns = page.locator('[data-testid="report-turn-row"]').count()
    page.locator('[data-testid="report-turn-row"]').first.click()
    page.wait_for_timeout(350)
    turn2 = page.locator('[data-testid="turn-report"]').count()
    page.locator('[data-testid="turn-step"]').first.click()
    page.wait_for_timeout(300)
    nav_present = page.locator('[data-testid="canvas-nav"]').count()
    path_before = page.locator('[data-testid="canvas-path"]').inner_text()
    page.locator('[data-testid="canvas-next"]').click()
    page.wait_for_timeout(250)
    path_after = page.locator('[data-testid="canvas-path"]').inner_text()
    page.locator('[data-testid="canvas-prev"]').click()
    page.wait_for_timeout(250)
    page.screenshot(path=str(SHOTS / "5_turn_nav.png"))
    record("CP5 turns-table+turn-report+nav",
           n_turns == 1 and turn2 == 1 and nav_present == 1 and path_before != path_after,
           f"turn-rows={n_turns} turn-report={turn2} nav={nav_present} path-changed={path_before != path_after}")

    # CP6 — agent-head click opens the turn report (left→right linkage entry point)
    page.locator('[data-testid="ws-tab"][data-tab="files"]').click()
    page.wait_for_timeout(150)
    page.locator('[data-testid="open-turn"]').first.click()
    page.wait_for_timeout(300)
    head_opens_turn = page.locator('[data-testid="turn-report"]').count()
    page.screenshot(path=str(SHOTS / "6_head_open_turn.png"))
    record("CP6 agent-head→turn-report", head_opens_turn == 1, f"turn-report={head_opens_turn}")

    # CP7 — zero console errors across the whole flow
    page.screenshot(path=str(SHOTS / "7_final.png"))
    record("CP7 no-console-errors", len(errors) == 0, f"errors={errors[:3]}")

    browser.close()

print("\n=== SUMMARY ===")
for cp, (ok, note) in results.items():
    print(f"  {'✓' if ok else '✗'} {cp} — {note}")
print("ALL PASS" if all(ok for ok, _ in results.values()) else "SOME FAILED")
sys.exit(0 if all(ok for ok, _ in results.values()) else 1)

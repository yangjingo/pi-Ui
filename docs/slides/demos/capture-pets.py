"""Capture the slide-local AIDA proof set with the deployed whale companion."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from playwright.sync_api import APIRequestContext, Page, sync_playwright


PET_ID = "healing-whale-hit"
PET_NAME = "鲸得起打"
DEMO_SESSION_ID = "aida-slides-public-demo"
PRIVATE_MARKERS = ("yangjing", "杨靖", "QZH", "NV for")


def rpc(request: APIRequestContext, base_url: str, method: str, payload: dict[str, object]) -> dict[str, object]:
    """Call one DSH unary RPC and return its validated business value."""
    rpc_id = str(uuid4())
    response = request.post(
        f"{base_url}/api/{method}",
        data={"type": "client-request", "rpcId": rpc_id, "method": method, "payload": payload},
    )
    assert response.ok, f"{method} transport failed: {response.status}"
    envelope = response.json()
    assert envelope.get("rpcId") == rpc_id, f"{method} returned a mismatched rpcId"
    result = envelope.get("result", {})
    assert result.get("ok") is True, f"{method} failed: {result.get('error')}"
    value = result.get("value")
    assert isinstance(value, dict), f"{method} returned an invalid value"
    return value


def wait_for_whale(page: Page) -> None:
    page.wait_for_function(
        """petId => [...document.querySelectorAll('*')].some(element =>
          getComputedStyle(element).backgroundImage.includes(`/pet/${petId}/spritesheet.webp`))""",
        arg=PET_ID,
        timeout=30_000,
    )
    page.evaluate(
        """petId => {
          const sprite = [...document.querySelectorAll('*')].find(element =>
            getComputedStyle(element).backgroundImage.includes(`/pet/${petId}/spritesheet.webp`));
          sprite.dataset.aidaDemoWhale = '';
        }""",
        PET_ID,
    )


def capture(page: Page, output_dir: Path, name: str) -> None:
    visible_text = page.locator("body").inner_text()
    leaked = [marker for marker in PRIVATE_MARKERS if marker.casefold() in visible_text.casefold()]
    assert not leaked, f"refusing to capture private markers: {leaked}"
    page.screenshot(path=str(output_dir / name), full_page=False)


def open_sanitized_canvas(page: Page) -> None:
    """Expose the real Canvas track for the API-created blank demo Session."""
    page.evaluate(
        """() => {
          const panel = document.querySelector('[data-testid="aida-canvas-panel"]');
          if (!(panel instanceof HTMLElement)) throw new Error('AIDA Canvas panel is missing');
          let frame = panel.parentElement;
          while (frame !== null && frame.style.gridTemplateColumns === '') frame = frame.parentElement;
          if (!(frame instanceof HTMLElement)) throw new Error('DSH frame is missing');
          frame.removeAttribute('data-details-collapsed');
          frame.dataset.aidaCanvasBalanced = 'true';
          frame.style.setProperty('--aida-canvas-cols', '280px 640px 640px');
        }"""
    )
    page.wait_for_function(
        """() => document.querySelector('[data-testid="aida-canvas-panel"]')
          ?.getBoundingClientRect().width >= 600""",
        timeout=10_000,
    )


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3080")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent)
    parser.add_argument("--workspace", type=Path, default=Path(__file__).parent / "aida-demo")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    workspace = args.workspace.resolve()
    assert (workspace / "README.md").is_file(), f"sanitized demo workspace is missing: {workspace}"

    bypass = [part for part in os.environ.get("NO_PROXY", "").split(",") if part]
    for host in ("127.0.0.1", "localhost"):
        if host not in bypass:
            bypass.append(host)
    os.environ["NO_PROXY"] = os.environ["no_proxy"] = ",".join(bypass)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1560, "height": 900})
        page = context.new_page()
        browser_errors: list[str] = []
        page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))

        selected = context.request.post(f"{args.base_url}/api/pet/set-pet", data={"petId": PET_ID})
        assert selected.ok, f"failed to select {PET_ID}: {selected.status}"
        configured = context.request.post(
            f"{args.base_url}/api/pet/set-config",
            data={"visible": True, "size": 146, "right": 28, "bottom": 36},
        )
        assert configured.ok, f"failed to configure {PET_ID}: {configured.status}"

        workspace_value = rpc(context.request, args.base_url, "workspace.create", {"path": str(workspace)})
        workspace_view = workspace_value["workspace"]
        assert isinstance(workspace_view, dict)
        workspace_id = workspace_view["workspaceId"]
        session_ids = workspace_view.get("sessionIds", [])
        if DEMO_SESSION_ID not in session_ids:
            rpc(context.request, args.base_url, "session.create", {
                "workspaceId": workspace_id,
                "sessionId": DEMO_SESSION_ID,
            })

        page.goto(args.base_url, wait_until="domcontentloaded", timeout=30_000)
        try:
            page.wait_for_load_state("networkidle", timeout=5_000)
        except Exception:
            pass
        page.get_by_text("AIDA", exact=True).first.wait_for(state="visible", timeout=30_000)
        wait_for_whale(page)
        sprite = page.locator("[data-aida-demo-whale]")

        new_session = page.locator('[role="treeitem"][aria-selected]').filter(has_text="新会话")
        if new_session.count():
            new_session.first.click()
        page.mouse.move(780, 24)
        capture(page, args.output_dir, "aida-pets-brand-surface.png")

        sprite.hover()
        page.get_by_text(PET_NAME, exact=True).last.wait_for(state="visible", timeout=5_000)
        capture(page, args.output_dir, "aida-pets-whale.png")

        page.mouse.move(780, 24)
        page.locator('[role="treeitem"][aria-selected]').filter(has_text="新会话").first.click()
        open_sanitized_canvas(page)
        page.get_by_role("tab", name="文件").first.evaluate("element => element.click()")
        page.get_by_test_id("aida-canvas-files").wait_for(state="visible", timeout=10_000)
        capture(page, args.output_dir, "aida-pets-overview.png")

        page.get_by_text("README.md", exact=True).first.evaluate("element => element.click()")
        page.get_by_test_id("aida-canvas-markdown").wait_for(state="visible", timeout=10_000)
        capture(page, args.output_dir, "aida-pets-canvas.png")

        page.get_by_role("tab", name="轨迹", exact=True).evaluate("element => element.click()")
        page.get_by_test_id("aida-canvas-trajectory").wait_for(state="visible", timeout=10_000)
        capture(page, args.output_dir, "aida-pets-trajectory.png")

        assert not browser_errors, f"browser errors: {browser_errors}"
        print(json.dumps({
            "petId": PET_ID,
            "screenshots": sorted(path.name for path in args.output_dir.glob("aida-pets-*.png")),
            "browserErrors": browser_errors,
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()

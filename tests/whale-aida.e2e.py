"""Verify the single AIDA whale pack through the deployed DSH Pet runtime."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


PET_ID = "healing-whale-hit"
PET_NAME = "鲸得起打"
EXCLUDED_SOURCE_PETS = {"niuma-refined", "burger-king-refined", "flamingo-refined"}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3080")
    parser.add_argument("--screenshot", type=Path, required=True)
    args = parser.parse_args()
    args.screenshot.parent.mkdir(parents=True, exist_ok=True)
    bypass = [part for part in os.environ.get("NO_PROXY", "").split(",") if part]
    for host in ("127.0.0.1", "localhost"):
        if host not in bypass:
            bypass.append(host)
    os.environ["NO_PROXY"] = os.environ["no_proxy"] = ",".join(bypass)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        console_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: console_errors.append(str(error)))

        registry_response = context.request.get(f"{args.base_url}/api/pet/pets")
        assert registry_response.ok, f"pet registry failed: {registry_response.status}"
        registry = {entry["id"]: entry for entry in registry_response.json()}
        assert PET_ID in registry, f"registry is missing {PET_ID}"
        assert registry[PET_ID]["displayName"] == PET_NAME
        assert registry[PET_ID]["renderer"] == "sprite2d"
        assert EXCLUDED_SOURCE_PETS.isdisjoint(registry), (
            f"unexpected source pets are installed: {sorted(EXCLUDED_SOURCE_PETS.intersection(registry))}"
        )

        selected = context.request.post(f"{args.base_url}/api/pet/set-pet", data={"petId": PET_ID})
        assert selected.ok, f"failed to select {PET_ID}: {selected.status}"
        configured = context.request.post(
            f"{args.base_url}/api/pet/set-config",
            data={"visible": True, "size": 160, "right": 24, "bottom": 120},
        )
        assert configured.ok, f"failed to configure {PET_ID}: {configured.status}"

        page.goto(args.base_url, wait_until="domcontentloaded", timeout=30_000)
        try:
            page.wait_for_load_state("networkidle", timeout=5_000)
        except Exception:
            pass  # DSH keeps runtime requests open; product-specific waits below are authoritative.
        page.get_by_text("AIDA", exact=True).first.wait_for(state="visible", timeout=30_000)
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
              sprite.dataset.aidaWhaleE2e = '';
            }""",
            PET_ID,
        )
        sprite = page.locator("[data-aida-whale-e2e]")
        box = sprite.bounding_box()
        assert box is not None and box["width"] > 0 and box["height"] > 0

        positions: list[str] = []
        for _ in range(6):
            positions.append(sprite.evaluate("element => getComputedStyle(element).backgroundPosition"))
            page.wait_for_timeout(500)
        assert len(set(positions)) > 1, f"whale animation did not advance: {positions}"

        sprite.hover()
        page.get_by_text(PET_NAME, exact=True).last.wait_for(state="visible", timeout=5_000)
        page.screenshot(path=str(args.screenshot), full_page=False)
        sprite.click()
        state_response = context.request.get(f"{args.base_url}/api/pet/state")
        assert state_response.ok, f"pet state failed: {state_response.status}"
        state = state_response.json()
        assert state["pet"]["id"] == PET_ID
        assert state["display"]["visible"] is True
        assert not console_errors, f"browser errors: {console_errors}"

        print(json.dumps({
            "aidaVisible": True,
            "petId": PET_ID,
            "petName": PET_NAME,
            "atlasUrl": registry[PET_ID]["atlasUrl"],
            "animationPositions": positions,
            "interactionPassed": True,
            "excludedSourcePetsAbsent": True,
            "consoleErrors": console_errors,
            "screenshot": str(args.screenshot.resolve()),
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()

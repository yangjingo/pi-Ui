"""verify/run_4 — 添加模型/添加Skill 配色一致；SkillHub 显式 zip 上传按钮；模型页 settings.json 上传解析。"""
import sys, pathlib, urllib.request, json, tempfile, os
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

# a settings.json to feed the model form
settings = {"label": "测试模型", "format": "anthropic", "baseUrl": "https://api.example.com",
            "apiKey": "sk-test-123", "modelId": "claude-test"}
json_file = str(RUN / "model_settings.json")
with open(json_file, "w", encoding="utf-8") as f:
    json.dump(settings, f, ensure_ascii=False)

with sync_playwright() as p:
    b = p.firefox.launch(headless=True, firefox_user_prefs={"network.proxy.type": 0})
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}:{m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror:{e}"))
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(300)

    # CP1 — SkillHub has a visible 上传 zip button; fill the form so 添加 Skill is ENABLED (stone)
    page.locator('[data-testid="skill-hub"]').click()
    page.wait_for_selector('[data-testid="skill-upload"]', timeout=5000)
    su = page.locator('[data-testid="skill-upload"]')
    skill_upload = 'zip' in su.inner_text()
    page.locator('[data-testid="skill-body"]').fill('提示词正文')
    page.locator('input.sa-input').nth(0).fill('测试')
    page.wait_for_timeout(150)
    sa_disabled = page.locator('.sa-save').is_disabled()
    sa_bg = page.eval_on_selector('.sa-save', "el => getComputedStyle(el).backgroundColor")
    sa_h = page.locator('.sa-save').bounding_box()['height']
    page.screenshot(path=str(SHOTS / "skill_upload.png"))
    print(f"CP1 skill-upload={skill_upload} sa-save.enabled={not sa_disabled} bg={sa_bg} h={sa_h:.0f}")

    # CP2 — model page: 添加自定义 button + 上传 settings.json button; same color as sa-save
    page.locator('[data-testid="model-center"]').click()
    page.wait_for_selector('[data-testid="add-custom-model"]', timeout=5000)
    page.locator('[data-testid="add-custom-model"]').click()
    page.wait_for_selector('[data-testid="cm-upload"]', timeout=5000)
    page.wait_for_timeout(250)   # let the form's open animation settle before sampling color
    cu = page.locator('[data-testid="cm-upload"]')
    model_upload = 'settings.json' in cu.inner_text()
    mp_bg = page.eval_on_selector('.model-add-primary', "el => getComputedStyle(el).backgroundColor")
    mp_h = page.locator('.model-add-primary').bounding_box()['height']
    # both buttons declare background:var(--stone); compare with ≤1/channel tolerance to absorb
    # Firefox color quantization on the resolved value
    def rgb(t):
        import re
        m = re.match(r'rgba?\((\d+),\s*(\d+),\s*(\d+)', t)
        return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
    same_color = all(abs(a - b) <= 1 for a, b in zip(rgb(sa_bg), rgb(mp_bg)))
    page.screenshot(path=str(SHOTS / "model_upload.png"))
    print(f"CP2 model-upload={model_upload} model-add.bg={mp_bg} h={mp_h:.0f} same-color-as-skill={same_color}")

    # CP3 — upload settings.json -> form filled (review before save)
    page.locator('[data-testid="custom-model-form"] input[type=file]').set_input_files(json_file)
    page.wait_for_timeout(300)
    label = page.locator('[data-testid="cm-label"]').input_value()
    baseurl = page.locator('[data-testid="cm-baseurl"]').input_value()
    apikey = page.locator('[data-testid="cm-apikey"]').input_value()
    modelid = page.locator('[data-testid="cm-modelid"]').input_value()
    filled = label == '测试模型' and baseurl == 'https://api.example.com' and apikey == 'sk-test-123' and modelid == 'claude-test'
    anthropic_on = page.locator('[data-testid="fmt-anthropic"].on').count() == 1
    print(f"CP3 filled={filled} anthropic-on={anthropic_on} (label={label!r} modelId={modelid!r}) console-errors={errs[:3]}")

    ok = skill_upload and model_upload and same_color and filled and anthropic_on and not errs
    print("ALL PASS" if ok else "SOME FAILED")
    b.close()

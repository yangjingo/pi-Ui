import { expect, test } from '@playwright/test';
import type { AgentEventPayload } from '../../src/core/agent/protocol';
import { collectPageErrors, demoSnapshot, emitAgentEvent, installMockAgent } from '../fixtures/agent';

async function openArtifact(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('flow-step').filter({ hasText: name }).last().click();
}

async function clipboardText(page: import('@playwright/test').Page) {
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
}

const presentationSource = `<!doctype html>
<html>
  <head><title>Canvas presentation fixture</title></head>
  <body>
    <div class="reveal"><div class="slides">
      <section class="present"><div class="pretext-stage"><div class="pretext-bg"><span>One background</span></div></div>Slide one</section>
      <section><div class="pretext-stage"><div class="pretext-bg"><span>Two background</span></div></div>Slide two</section>
      <section><div class="pretext-stage"><div class="pretext-bg"><span>Three background</span></div></div>Slide three</section>
    </div></div>
    <script>
      const slides = Array.from(document.querySelectorAll('.slides > section'));
      const listeners = {};
      let index = 0;
      const emit = type => (listeners[type] || []).forEach(callback => callback());
      const render = () => {
        slides.forEach((slide, slideIndex) => slide.classList.toggle('present', slideIndex === index));
        emit('slidechanged');
      };
      window.Reveal = {
        getIndices: () => ({ h: index, v: 0 }),
        getSlidePastCount: () => index,
        getTotalSlides: () => slides.length,
        on: (type, callback) => { (listeners[type] ||= []).push(callback); },
        next: () => { index = Math.min(slides.length - 1, index + 1); render(); },
        prev: () => { index = Math.max(0, index - 1); render(); },
      };
      let frames = 0;
      const animate = () => { window.__piPreviewFrames = ++frames; requestAnimationFrame(animate); };
      requestAnimationFrame(animate);
      setTimeout(() => { render(); emit('ready'); }, 20);
    </script>
  </body>
</html>`;

test('renders code, HTML, Markdown/Mermaid and sheets in Canvas', async ({ page, context }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('agent-message')).toBeVisible();
  await expect(page.locator('.out-card')).toHaveCount(0);
  await expect(page.getByTestId('artifact-manifest')).toHaveCount(0);
  await expect(page.getByTestId('flow-step').filter({ hasText: 'report.html' }).last()).toHaveAttribute('data-kind', 'write');
  await expect(page.locator('[data-testid="flow-step-shell"][data-artifact-path="run_pipeline.py"]')).toContainText('run_pipeline.py');

  await openArtifact(page, 'run_pipeline.py');
  const code = page.getByTestId('renderer-code');
  await expect(code).toContainText('#!/usr/bin/env python3');
  await expect(code).toContainText('def parse_report');
  await expect(page.locator('.canvas-viewport h1')).toHaveCount(0);
  await expect(page.getByTestId('cv-locate')).toHaveCount(0);
  await expect(page.getByTestId('cv-copy')).toHaveAttribute('title', '复制预览文本');
  await expect(page.getByTestId('cv-copy')).toHaveText('复制');
  await page.getByTestId('cv-copy').click();
  await expect.poll(() => clipboardText(page)).toContain('def parse_report');

  await openArtifact(page, 'report.html');
  const html = page.getByTestId('renderer-html');
  await expect(html.locator('iframe')).toBeVisible();
  await page.getByTestId('html-source').click();
  await expect(page.getByTestId('html-source-body')).toHaveValue(/<!doctype html>/i);
  await page.getByTestId('html-preview').click();
  await expect(html.locator('iframe')).toBeVisible();
  await page.getByTestId('cv-copy').click();
  await expect.poll(() => clipboardText(page)).toContain('检测报告数据看板');
  expect(await clipboardText(page)).not.toContain('<h2>');

  await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();
  await page.getByTestId('file-item').filter({ hasText: 'README.md' }).click();
  await expect(page.getByTestId('md-canvas-editor')).toBeVisible();
  await expect(page.locator('.r-doc h1')).toContainText('PDF 检测报告分析');
  await expect(page.locator('.mermaid svg')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('cv-copy').click();
  await expect.poll(() => clipboardText(page)).toContain('PDF 检测报告分析');
  expect(await clipboardText(page)).not.toContain('# PDF 检测报告分析');

  await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();
  await page.getByTestId('file-item').filter({ hasText: 'budget.csv' }).click();
  const sheet = page.getByTestId('renderer-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('tbody tr')).toHaveCount(5);
  await expect(sheet.locator('tbody tr').last()).toHaveClass(/total/);
  await expect(page.getByTestId('cv-copy')).toHaveAttribute('title', '复制预览文本');
  await page.getByTestId('cv-copy').click();
  await expect(page.getByTestId('cv-copy')).toHaveText('已复制');
  await expect.poll(() => clipboardText(page)).toBe([
    '项目\t预算(元)\t实际(元)\t差额(元)',
    '检测费用\t12000\t11800\t-200',
    '人工\t8000\t8400\t+400',
    '设备折旧\t5000\t5000\t0',
    '材料\t3000\t3200\t+200',
    '合计\t28000\t28400\t+400',
  ].join('\n'));
  expect(errors).toEqual([]);
});

test('edits code directly and saves it with Ctrl+S', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  await page.route('**/api/file', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"ok":true}',
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('agent-message')).toBeVisible();
  await openArtifact(page, 'run_pipeline.py');

  const editor = page.getByTestId('code-source-body');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(/def parse_report/);
  await expect(page.locator('#canvas-document-panel > .r-code > pre')).toHaveCount(0);
  const panel = page.locator('#canvas-document-panel');
  await expect(panel).toHaveCSS('border-top-style', 'solid');
  await expect(panel).toHaveCSS('border-top-color', 'rgb(231, 229, 224)');
  await expect(panel).toHaveCSS('outline-style', 'none');
  const panelBox = await panel.boundingBox();
  const codeBox = await page.getByTestId('renderer-code').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(codeBox).not.toBeNull();
  expect(Math.abs(codeBox!.width - (panelBox!.width - 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(codeBox!.height - (panelBox!.height - 2))).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('renderer-code')).toHaveCSS('border-top-width', '0px');

  const nextContent = '#!/usr/bin/env python3\n\ndef parse_report(path):\n    return {"edited": path}\n';
  await editor.fill(nextContent);
  await expect(page.getByTestId('cv-save')).toBeVisible();
  await expect(page.locator('.canvas-footer')).toHaveCount(0);
  await expect(page.locator('.canvas-bar .edit-status')).toBeVisible();
  await expect(page.locator('.edit-status')).toContainText('未保存');

  const saveRequestPromise = page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/file',
  );
  await editor.press('Control+s');
  const saveRequest = await saveRequestPromise;

  expect(saveRequest.postDataJSON()).toEqual({
    sessionId: 'demo',
    path: 'run_pipeline.py',
    content: nextContent,
  });
  await expect(page.getByTestId('cv-save')).toBeHidden();
  await expect(editor).toHaveValue(nextContent);
});

test('navigates embedded HTML presentations without iframe focus and caps preview animation work', async ({ page }) => {
  const slidePath = 'presentation-fixture.html';
  const snapshot = {
    ...demoSnapshot,
    files: [...demoSnapshot.files, {
      file: { name: slidePath, path: slidePath, type: 'html' as const, size: '2 KB' },
      content: presentationSource,
    }],
  };
  await installMockAgent(page, { snapshot });
  const errors = collectPageErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const filesTab = page.locator('[data-testid="ws-tab"][data-tab="files"]');
  if (!await filesTab.isVisible()) await page.getByTestId('ws-toggle').click();
  await filesTab.click();
  await page.getByTestId('file-item').filter({ hasText: slidePath }).click();

  const controls = page.getByTestId('html-slide-controls');
  await expect(controls).toBeVisible();
  await expect(page.getByTestId('html-slide-status')).toHaveText('1 / 3');
  const frameBody = page.getByTestId('renderer-html').locator('iframe').contentFrame().locator('body');
  await expect.poll(() => frameBody.evaluate(() =>
    Array.from(document.querySelectorAll('.pretext-bg'), element => element.childElementCount),
  )).toEqual([1, 0, 0]);

  await page.getByTestId('html-slide-next').click();
  await expect(page.getByTestId('html-slide-status')).toHaveText('2 / 3');
  await expect.poll(() => frameBody.evaluate(() =>
    Array.from(document.querySelectorAll('.pretext-bg'), element => element.childElementCount),
  )).toEqual([0, 1, 0]);
  await page.getByTestId('html-slide-previous').click();
  await expect(page.getByTestId('html-slide-status')).toHaveText('1 / 3');

  await frameBody.dispatchEvent('wheel', { deltaY: 120 });
  await expect(page.getByTestId('html-slide-status')).toHaveText('2 / 3');

  await page.getByTestId('html-slide-next').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('html-slide-status')).toHaveText('3 / 3');

  const framesBefore = await frameBody.evaluate(() => (window as any).__piPreviewFrames as number);
  await page.waitForTimeout(500);
  const framesAfter = await frameBody.evaluate(() => (window as any).__piPreviewFrames as number);
  expect(framesAfter - framesBefore).toBeGreaterThan(5);
  expect(framesAfter - framesBefore).toBeLessThanOrEqual(18);
  expect(errors).toEqual([]);
});

test('reuses Mermaid and Excalidraw work until the file content changes', async ({ page, context }) => {
  const mermaidPath = 'pipeline.mmd';
  const excalidrawPath = 'architecture.excalidraw';
  const mermaidSource = 'flowchart LR\n  Start[Cold render] --> Cached[Cached render]';
  const excalidrawSource = JSON.stringify({
    type: 'excalidraw',
    elements: [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 260, height: 100, strokeColor: '#2563eb', backgroundColor: '#dbeafe' },
      { id: 'label', type: 'text', x: 30, y: 25, width: 200, height: 30, text: 'Cached scene', fontSize: 22, strokeColor: '#1e3a8a' },
      { id: 'arrow', type: 'arrow', x: 260, y: 50, width: 120, height: 0, points: [[0, 0], [120, 0]], strokeColor: '#2563eb' },
    ],
  });
  const snapshot = {
    ...demoSnapshot,
    files: [
      ...demoSnapshot.files,
      { file: { name: mermaidPath, path: mermaidPath, type: 'mermaid' as const, size: `${mermaidSource.length} B` }, content: mermaidSource },
      { file: { name: excalidrawPath, path: excalidrawPath, type: 'excalidraw' as const, size: `${excalidrawSource.length} B` }, content: excalidrawSource },
    ],
  };
  const errors = collectPageErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as typeof window & { __PI_RENDER_DIAGNOSTICS__?: boolean }).__PI_RENDER_DIAGNOSTICS__ = true;
  });
  await installMockAgent(page, { snapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    performance.clearMeasures('pi:mermaid:render');
    performance.clearMeasures('pi:excalidraw:prepare');
  });
  await page.getByTestId('ws-toggle').click();

  const openFile = async (name: string) => {
    await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();
    await page.getByTestId('file-item').filter({ hasText: name }).click();
  };

  await openFile(mermaidPath);
  await expect(page.getByTestId('renderer-mermaid').locator('svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('renderer-mermaid')).toContainText('Cached render');
  await page.getByTestId('cv-copy').click();
  await expect.poll(() => clipboardText(page)).toContain('Cached render');

  await openFile(excalidrawPath);
  await expect(page.getByTestId('renderer-excalidraw').locator('svg')).toBeVisible();
  await expect(page.getByTestId('renderer-excalidraw')).toContainText('Cached scene');
  await page.getByTestId('cv-copy').click();
  await expect.poll(() => clipboardText(page)).toBe('Cached scene');

  await openFile(mermaidPath);
  await expect(page.getByTestId('renderer-mermaid').locator('svg')).toBeVisible();
  await openFile(excalidrawPath);
  await expect(page.getByTestId('renderer-excalidraw').locator('svg')).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    mermaid: performance.getEntriesByName('pi:mermaid:render').length,
    excalidraw: performance.getEntriesByName('pi:excalidraw:prepare').length,
  }))).toEqual({ mermaid: 1, excalidraw: 1 });

  const updatedExcalidraw = excalidrawSource.replace('Cached scene', 'Updated scene');
  await emitAgentEvent(page, {
    type: 'file',
    file: { name: excalidrawPath, path: excalidrawPath, type: 'excalidraw', size: `${updatedExcalidraw.length} B` },
    content: updatedExcalidraw,
  });
  await expect(page.getByTestId('renderer-excalidraw')).toContainText('Updated scene');

  await openFile(mermaidPath);
  const updatedMermaid = mermaidSource.replace('Cached render', 'Updated render');
  await emitAgentEvent(page, {
    type: 'file',
    file: { name: mermaidPath, path: mermaidPath, type: 'mermaid', size: `${updatedMermaid.length} B` },
    content: updatedMermaid,
  });
  await expect(page.getByTestId('renderer-mermaid')).toContainText('Updated render');

  await expect.poll(() => page.evaluate(() => ({
    mermaid: performance.getEntriesByName('pi:mermaid:render').length,
    excalidraw: performance.getEntriesByName('pi:excalidraw:prepare').length,
  }))).toEqual({ mermaid: 2, excalidraw: 2 });
  expect(errors).toEqual([]);

  await openFile(excalidrawPath);
  await emitAgentEvent(page, {
    type: 'file',
    file: { name: excalidrawPath, path: excalidrawPath, type: 'excalidraw', size: '21 B' },
    content: '{"type":"excalidraw"}',
  });
  await expect(page.getByTestId('renderer-excalidraw-error')).toBeVisible();

  await openFile(mermaidPath);
  await emitAgentEvent(page, {
    type: 'file',
    file: { name: mermaidPath, path: mermaidPath, type: 'mermaid', size: '19 B' },
    content: 'not a valid diagram',
  });
  await expect(page.getByTestId('renderer-mermaid-error')).toBeVisible({ timeout: 20_000 });
});

test('renders Excel sheets as a dense sticky-column data matrix', async ({ page }) => {
  const workbookPath = 'evaluation.xlsx';
  const columns = ['Benchmark', 'Inkling', 'Model B', 'Model C', 'Model D', 'Model E', 'Model F', 'Model G', 'Model H', 'Model I'];
  const workbook = {
    __office: 'workbook' as const,
    sheets: [
      {
        name: 'Scores',
        rows: [
          columns,
          ['Reasoning'],
          ['HLE text only', '29.7%', '26.6%', '29.4%', '35.9%', '40.1%', '35.9%', '44.7%', '53.3%', '47.2%'],
          ['HLE with tools', '46.0%', '37.4%', '50.2%', '54.0%', '54.7%', '48.2%', '51.4%', '64.5%', '55.0%'],
          ['总计', '75.7%', '64.0%', '79.6%', '89.9%', '94.8%', '84.1%', '96.1%', '117.8%', '102.2%'],
        ],
      },
      {
        name: 'Latency',
        rows: [
          ['Metric', 'p50', 'p95', 'p99'],
          ['TTFT', '740 ms', '1.2 s', '1.9 s'],
        ],
      },
    ],
  };
  const content = JSON.stringify(workbook);
  const snapshot = {
    ...demoSnapshot,
    files: [
      ...demoSnapshot.files,
      {
        file: { name: workbookPath, path: workbookPath, type: 'sheet' as const, size: `${content.length} B` },
        content,
      },
    ],
  };
  await installMockAgent(page, { snapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ws-toggle').click();
  await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();
  await page.getByTestId('file-item').filter({ hasText: workbookPath }).click();

  const renderer = page.getByTestId('renderer-sheet');
  const scroller = renderer.locator('.r-sheet');
  await expect(renderer.getByRole('tab', { name: 'Scores' })).toHaveAttribute('aria-selected', 'true');
  await expect(renderer.locator('colgroup col')).toHaveCount(columns.length);
  await expect(renderer.locator('tbody tr.section')).toContainText('Reasoning');
  await expect(renderer.locator('tbody tr.total')).toContainText('总计');
  await expect(scroller).toHaveAttribute('data-scroll-right', 'true');
  await expect(renderer.locator('tbody th').first()).toHaveCSS('position', 'sticky');

  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(scroller).toHaveAttribute('data-scroll-left', 'true');
  await expect(scroller).toHaveAttribute('data-scroll-right', 'false');

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(renderer.locator('tbody th').first()).toHaveCSS('min-width', '144px');
  await renderer.getByRole('tab', { name: 'Scores' }).focus();
  await expect(renderer.getByRole('tab', { name: 'Scores' })).toBeFocused();

  await renderer.getByRole('tab', { name: 'Latency' }).click();
  await expect(renderer).toContainText('TTFT');
  await expect(renderer).toContainText('1.9 s');
});

test('centers harmonious unavailable states for Word and PowerPoint files', async ({ page }) => {
  const officeFiles = [
    { name: 'project-brief.docx', type: 'doc' as const, label: 'Word 文档', size: '18.4 KB' },
    { name: 'launch-review.pptx', type: 'slides' as const, label: 'PowerPoint 演示文稿', size: '2.1 MB' },
  ];
  const snapshot = {
    ...demoSnapshot,
    files: [
      ...demoSnapshot.files,
      ...officeFiles.map(file => ({
        file: { name: file.name, path: file.name, type: file.type, size: file.size },
        content: '__PI_BINARY_FILE__',
      })),
    ],
  };
  await installMockAgent(page, { snapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ws-toggle').click();

  for (const file of officeFiles) {
    await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();
    await page.getByTestId('file-item').filter({ hasText: file.name }).click();

    const unavailable = page.getByTestId('renderer-office-unavailable');
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText(file.label);
    await expect(unavailable).toContainText('暂不支持在 Canvas 中预览');
    await expect(unavailable).toContainText(file.name);
    await expect(unavailable).toContainText(file.size);
    await expect(unavailable).toHaveCSS('align-items', 'center');
    await expect(unavailable).toHaveCSS('justify-items', 'center');
    await expect(unavailable.locator('.r-office-unavailable-content')).toHaveCSS('text-align', 'center');
    const download = page.getByTestId('renderer-office-download');
    await expect(download).toHaveAttribute('href', new RegExp(`path=${encodeURIComponent(file.name)}.*download=1`));
    await expect(download).toContainText('下载文件');
    await download.focus();
    await expect(download).toBeFocused();
  }
});

test('uses the full Canvas width for files, turns and trajectory details', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openArtifact(page, 'report.html');

  const canvasBox = await page.getByTestId('canvas-viewport').boundingBox();
  const iframeBox = await page.getByTestId('renderer-html').locator('iframe').boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(iframeBox).not.toBeNull();
  expect(iframeBox!.width).toBeGreaterThanOrEqual(canvasBox!.width * 0.9);
  await expect(page.getByTestId('renderer-html').locator('iframe')).toHaveCSS('border-top-width', '0px');

  await page.getByTestId('open-turn').click();
  const turn = page.getByTestId('turn-report');
  await expect(turn).toBeVisible();
  const turnBox = await turn.boundingBox();
  expect(turnBox!.width).toBeGreaterThanOrEqual(canvasBox!.width * 0.9);
  await expect(page.getByTestId('turn-step')).toHaveCount(8);
  await expect(turn.locator('.turn-summary-copy')).toContainText('6 次工具调用');
  await expect(turn.locator('.turn-summary-copy')).toContainText('2 轮思考');

  await page.getByTestId('turn-step').first().click();
  const step = page.getByTestId('renderer-step');
  await expect(step).toBeVisible();
  await expect(page.getByTestId('step-think')).toContainText('先解析 PDF');
  await expect(page.locator('.step-io')).toHaveCount(0);
  const stepBox = await step.boundingBox();
  expect(stepBox!.width).toBeGreaterThanOrEqual(canvasBox!.width * 0.9);

  await page.getByTestId('open-turn').click();
  await page.getByTestId('turn-step').nth(1).click();
  await expect(page.locator('.step-io')).toHaveCount(2);
});

test('previews a server-backed SVG and copies its caption as plain text', async ({ page, context }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2563eb"/></svg>';
  const path = 'image-preview-test.svg';
  const snapshot = {
    ...demoSnapshot,
    files: [...demoSnapshot.files, {
      file: { name: path, path, type: 'png' as const, size: '124 B', caption: 'Blue preview square' },
      content: '__PI_BINARY_FILE__',
    }],
  };
  await installMockAgent(page, { snapshot });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/file/raw?**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: svg,
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ws-toggle').click();
  await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();
  await page.locator(`[data-testid="file-item"][data-file-path="${path}"]`).click();

  const image = page.getByTestId('renderer-png').locator('img');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await page.getByTestId('cv-copy').click();
  await expect.poll(() => clipboardText(page)).toBe('Blue preview square');

  const canvasBox = await page.getByTestId('canvas-viewport').boundingBox();
  const rendererBox = await page.getByTestId('renderer-png').boundingBox();
  expect(rendererBox!.width).toBeGreaterThanOrEqual(canvasBox!.width - 2);
});

test('imports dropped text with progress and rejects binary content', async ({ page }) => {
  await installMockAgent(page, { snapshot: demoSnapshot });
  await page.route('**/api/file', async route => {
    const body = route.request().postDataJSON() as { path: string; content: string };
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    const event: AgentEventPayload = {
      type: 'file',
      file: { name: body.path, path: body.path, type: 'md', size: `${body.content.length} B` },
      content: body.content,
    };
    await emitAgentEvent(page, event);
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ws-toggle').click();
  await page.locator('[data-testid="ws-tab"][data-tab="files"]').click();

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['# Imported'], 'dragged_notes.md', { type: 'text/markdown' }));
    const target = document.querySelector('#workspace-panel-files')!;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByTestId('ws-import-progress')).toContainText('正在导入到当前工作区');
  await expect(page.locator('[data-testid="file-item"][data-file-path="dragged_notes.md"]')).toBeVisible();

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0, 1, 2, 3])], 'tiny.png', { type: 'image/png' }));
    const target = document.querySelector('#workspace-panel-files')!;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByTestId('drop-msg')).toContainText('写入失败');
  await expect(page.locator('[data-testid="file-item"][data-file-path="tiny.png"]')).toHaveCount(0);
});

test('shows one full Thinking payload without repeating its preview', async ({ page }) => {
  const snapshot = {
    ...demoSnapshot,
    messages: [{
      role: 'agent' as const,
      status: 'done' as const,
      traj: [{
        t: 'think',
        title: '分析需求',
        det: '重复的摘要不应出现在 Canvas',
        text: '这是唯一需要阅读的完整 Thinking 内容。',
        status: 'done' as const,
        time: '10:00',
      }],
      blocks: [{ kind: 'step' as const, step: 0 }],
    }],
  };
  await installMockAgent(page, { snapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('flow-step').click();

  const panel = page.locator('#canvas-document-panel');
  await expect(panel).toContainText('完整 Thinking');
  await expect(panel).toContainText('这是唯一需要阅读的完整 Thinking 内容。');
  await expect(panel).not.toContainText('重复的摘要不应出现在 Canvas');
  await expect(panel.locator('.step-head .step-hd')).toHaveCSS('flex-direction', 'row');
  await expect(panel.locator('.step-head .step-hd b')).toHaveCSS('font-size', '13.5px');
  await expect(panel.locator('.step-head .step-time')).toHaveCSS('font-size', '10px');
  await expect(panel.locator('.step-head .step-ico')).toHaveCSS('width', '22px');
  await expect(panel.locator('.step-think')).toHaveCSS('border-left-width', '2px');
});

test('shows Goal content and semantic input/output in Traj instead of an empty object', async ({ page }) => {
  const snapshot = {
    ...demoSnapshot,
    messages: [{
      role: 'agent' as const,
      status: 'done' as const,
      traj: [{
        t: 'goal',
        title: '读取 Goal',
        det: '当前 Goal · active · 完成 Goal Traj 强化',
        in: JSON.stringify({
          operation: 'get_goal',
          requestedFields: ['objective', 'status', 'tokenBudget', 'tokensUsed', 'timeUsedSeconds'],
        }),
        out: JSON.stringify({
          operation: 'get_goal',
          ok: true,
          goal: {
            goalId: 'goal-canvas-1',
            objective: '完成 Goal Traj 强化',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 900,
            timeUsedSeconds: 42,
          },
          remainingTokens: null,
        }),
        status: 'done' as const,
        time: '10:00',
      }],
      blocks: [{ kind: 'step' as const, step: 0 }],
    }],
  };
  await installMockAgent(page, { snapshot });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const goalStep = page.getByTestId('flow-step');
  await expect(goalStep).toContainText('完成 Goal Traj 强化');
  await expect(goalStep).toHaveAttribute('data-kind', 'goal');
  await goalStep.click();

  await expect(page.getByTestId('renderer-step')).toBeVisible();
  await expect(page.locator('#canvas-document-panel .step-head .step-det')).toHaveCSS('font-size', '10.5px');
  await expect(page.getByTestId('step-input')).toContainText('requestedFields');
  await expect(page.getByTestId('step-input')).toContainText('objective');
  await expect(page.getByTestId('step-output')).toContainText('完成 Goal Traj 强化');
  await expect(page.getByTestId('step-output')).toContainText('tokensUsed');
  await expect(page.getByTestId('step-output')).toContainText('tokenBudget');
  await expect(page.getByTestId('step-output')).toContainText('remainingTokens');
});

test('opens a generated Goal budget report directly in Canvas', async ({ page }) => {
  await installMockAgent(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('composer-input')).toBeVisible();

  await emitAgentEvent(page, {
    type: 'goal_report',
    goalId: 'goal-report-1',
    file: {
      name: 'goal-budget-report-goalrepo.md',
      path: 'goal-budget-report-goalrepo.md',
      type: 'md',
      size: '1.4 KB',
    },
    content: [
      '# Goal 预算终止报告',
      '',
      '> Token 预算已用尽。此 Goal 保持 `budgetLimited`，没有被错误标记为完成。',
      '',
      '| 指标 | 结果 |',
      '| --- | ---: |',
      '| Token 消耗 | 12,000 |',
      '| Agent Loop | 6 轮 |',
      '| 活跃执行时间 | 8 分钟 |',
    ].join('\n'),
  });

  await expect(page.getByTestId('canvas-panel')).toBeVisible();
  await expect(page.getByTestId('canvas-tab')).toContainText('goal-budget-report-goalrepo.md');
  await expect(page.getByTestId('md-canvas-editor')).toBeVisible();
  const report = page.getByTestId('canvas-viewport');
  await expect(report.locator('h1')).toHaveText('Goal 预算终止报告');
  await expect(report.locator('table')).toContainText('12,000');
  await expect(report.locator('table')).toContainText('6 轮');
});

import { expect, test } from '@playwright/test';
import { emptySnapshot, installMockAgent } from '../fixtures/agent';

test('shows a session index without account or upgrade UI', async ({ page }) => {
  await installMockAgent(page, {
    snapshot: emptySnapshot,
    sessions: [
      emptySnapshot.session,
      { id: 'older', title: '旧会话', group: '昨天', time: '昨天', live: false },
    ],
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('session-switcher').click();

  await expect(page.getByTestId('session-list')).toBeVisible();
  await expect(page.getByTestId('session-item')).toHaveCount(2);
  await expect(page.locator('.drawer-foot')).toHaveCount(0);
  await expect(page.locator('.avatar')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Jing Yang|免费版|升级 Pro/);
});

test('toggles full-page destinations without modal overlays or mixed views', async ({ page }) => {
  await installMockAgent(page, { snapshot: emptySnapshot });
  await page.route('**/api/models', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"models":[],"active":null}',
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByTestId('session-switcher').click();
  await expect(page.getByTestId('session-list')).toBeVisible();
  await expect(page.locator('.modal-backdrop, .modal-card')).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toHaveCount(0);

  await page.getByTestId('session-switcher').click();
  await expect(page.getByTestId('composer-input')).toBeVisible();

  await page.getByTestId('model-center').click();
  await expect(page.getByTestId('model-master')).toBeVisible();
  await expect(page.getByTestId('skill-master')).toHaveCount(0);

  await page.getByTestId('skill-hub').click();
  await expect(page.getByTestId('skill-master')).toBeVisible();
  await expect(page.getByTestId('model-master')).toHaveCount(0);

  await page.getByTestId('skill-hub').click();
  await expect(page.getByTestId('composer-input')).toBeVisible();
});

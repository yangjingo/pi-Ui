import { expect, test } from '@playwright/test';
import { emptySnapshot, installMockAgent } from '../fixtures/agent';

const configuredTheme = ['zengrid', 'aida'].includes((process.env.PI_UI_THEME || '').toLowerCase())
  ? process.env.PI_UI_THEME!.toLowerCase() as 'zengrid' | 'aida'
  : 'dark';
const configuredLanguage = ['zh', 'zh-cn'].includes((process.env.PI_UI_LANGUAGE || '').toLowerCase()) ? 'zh-CN' : 'en';
const configuredBrand = ['pi', 'aida'].includes((process.env.PI_UI_BRAND || '').toLowerCase())
  ? process.env.PI_UI_BRAND!.toLowerCase()
  : configuredTheme === 'aida' ? 'aida' : 'pi';
const themeBackgrounds = {
  dark: 'rgb(23, 23, 23)',
  zengrid: 'rgb(250, 249, 246)',
  aida: 'rgb(246, 248, 251)',
} as const;

test('uses startup-configured theme and language without browser toggles', async ({ page }) => {
  await installMockAgent(page, { snapshot: emptySnapshot, startAtWelcome: true });
  await page.addInitScript(theme => window.localStorage.setItem('pi.ui.theme', theme), configuredTheme === 'dark' ? 'zengrid' : 'dark');
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', configuredTheme);
  await expect(page.locator('html')).toHaveAttribute('data-language', configuredLanguage);
  await expect(page.locator('html')).toHaveAttribute('data-brand', configuredBrand);
  await expect(page.locator('html')).toHaveAttribute('lang', configuredLanguage);
  await expect(page.locator('body')).toHaveCSS('background-color', themeBackgrounds[configuredTheme]);
  await expect(page.getByRole('heading', {
    name: configuredBrand === 'aida' ? 'AIDA Cooks. You Look busy' : 'Pi Cooks. You Look busy',
  })).toBeVisible();
  await expect(page.locator('.empty-welcome-lockup')).toHaveCSS('transition-duration', '0.22s, 0.22s');
  if (configuredTheme === 'aida') {
    await expect(page.locator('.empty-pi-banner')).toHaveCSS('color', 'rgb(53, 81, 216)');
    await page.locator('.empty-welcome-lockup').hover();
    await expect(page.locator('.empty-pi-banner')).toHaveCSS('color', 'rgb(42, 68, 194)');
    await page.getByTestId('composer-attach').hover();
    await expect(page.getByTestId('composer-attach')).toHaveCSS('background-color', 'rgb(238, 241, 252)');
    await expect(page.getByTestId('composer-attach').locator('svg')).toHaveCSS('color', 'rgb(53, 81, 216)');
    await expect(page.getByTestId('composer-send')).toHaveCSS('background-color', 'rgb(203, 213, 225)');
    await page.getByTestId('composer-input').fill('Theme check');
    await expect(page.getByTestId('composer-send')).toHaveCSS('background-color', 'rgb(53, 81, 216)');
  }
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
  await expect(page.getByTestId('ws-toggle')).toHaveAttribute('aria-label', configuredLanguage === 'en' ? 'Show workspace' : '显示工作区');
});

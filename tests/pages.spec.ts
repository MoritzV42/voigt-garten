import { test, expect } from '@playwright/test';

test.describe('Seitenladung - Alle Seiten erreichbar', () => {
  const pages = [
    { path: '/', title: 'Start' },
    { path: '/wartung', title: 'Wartung' },
    { path: '/galerie', title: 'Galerie' },
    { path: '/buchen', title: 'Buchen' },
    { path: '/ueber-den-garten', title: 'Der Garten' },
    { path: '/umgebung', title: 'Umgebung' },
    { path: '/inventar', title: 'Inventar' },
    { path: '/dienstleister', title: 'Dienstleister' },
    { path: '/gartenkarte', title: 'Gartenkarte' },
    { path: '/admin', title: 'Admin' },
    { path: '/impressum', title: 'Impressum' },
    { path: '/datenschutz', title: 'Datenschutz' },
    { path: '/agb', title: 'AGB' },
    { path: '/hausordnung', title: 'Hausordnung' },
  ];

  for (const p of pages) {
    test(`${p.path} lädt ohne Fehler`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      const res = await page.goto(p.path, { waitUntil: 'domcontentloaded' });
      expect(res?.ok()).toBeTruthy();

      // Some pages load external scripts (e.g. Leaflet) that may throw
      // Only fail on errors from our own code, not CDN scripts
      const ownErrors = errors.filter(e => !e.includes('L is not defined') && !e.includes('leaflet'));
      expect(ownErrors).toHaveLength(0);
    });
  }
});

test.describe('Navigation - Links vorhanden', () => {
  test('Hauptnavigation enthält alle Links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const nav = page.locator('nav').first();
    // Logo link
    await expect(nav.locator('a[href="/"]').first()).toBeVisible();
    // Main navigation links (use first() since mobile nav duplicates them)
    await expect(nav.locator('a[href="/galerie"]').first()).toBeVisible();
    await expect(nav.locator('a[href="/buchen"]').first()).toBeVisible();
    await expect(nav.locator('a[href="/wartung"]').first()).toBeVisible();
    await expect(nav.locator('a[href="/inventar"]').first()).toBeVisible();
    await expect(nav.locator('a[href="/umgebung"]').first()).toBeVisible();
  });
});

test.describe('Footer - Legal Links', () => {
  test('Footer enthält Impressum, Datenschutz, AGB, Hausordnung Links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="/impressum"]')).toBeVisible();
    await expect(footer.locator('a[href="/datenschutz"]')).toBeVisible();
    await expect(footer.locator('a[href="/agb"]')).toBeVisible();
    await expect(footer.locator('a[href="/hausordnung"]')).toBeVisible();
  });
});

test.describe('Footer', () => {
  test('Footer enthält mailto-Link', async ({ page }) => {
    await page.goto('/');
    const mailto = page.locator('a[href^="mailto:"]');
    await expect(mailto.first()).toBeVisible();
  });

  test('Mailto-Link hat target=_blank auf Desktop', async ({ page }) => {
    // Playwright simulates hover-capable device by default
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Give the script time to run
    await page.waitForTimeout(500);
    const mailto = page.locator('a[href^="mailto:"]').first();
    const target = await mailto.getAttribute('target');
    expect(target).toBe('_blank');
  });
});

import { test, expect } from '@playwright/test';

const BASE = 'https://garten.infinityspace42.de';

/**
 * Smoke-Test (ack_only): Minimaler Post-Deploy-Check.
 * Prueft nur, ob die Anwendung erreichbar ist und korrekt antwortet.
 */
test.describe('Smoke-Test: ack_only', () => {
  test('GET /api/health antwortet mit ok', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('voigt-garten-pi');
    expect(body).toHaveProperty('timestamp');
  });

  test('Startseite laed und liefert HTML', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('Startseite rendert ohne JS-Fehler', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res?.ok()).toBeTruthy();

    const ownErrors = errors.filter(
      (e) => !e.includes('L is not defined') && !e.includes('leaflet')
    );
    expect(ownErrors).toHaveLength(0);
  });

  test('Statische Assets erreichbar (CSS)', async ({ request }) => {
    const html = await (await request.get(`${BASE}/`)).text();
    const cssMatch = html.match(/href="(\/[^"]+\.css)"/);
    if (cssMatch) {
      const res = await request.get(`${BASE}${cssMatch[1]}`);
      expect(res.ok()).toBeTruthy();
    }
  });

  test('API antwortet (GET /api/gallery)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/gallery`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('items');
  });
});

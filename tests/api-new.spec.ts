import { test, expect } from '@playwright/test';

const BASE = 'https://garten.infinityspace42.de';

test.describe('Pricing API', () => {
  test('POST /api/pricing/calculate with valid body returns pricing details', async ({ request }) => {
    const res = await request.post(`${BASE}/api/pricing/calculate`, {
      data: { checkIn: '2026-05-01', checkOut: '2026-05-03', guests: 2 }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('nights');
    expect(body).toHaveProperty('base_total');
    expect(body).toHaveProperty('person_factor');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('discounts');
    expect(body).toHaveProperty('nightly_breakdown');
    expect(Array.isArray(body.discounts)).toBeTruthy();
    expect(Array.isArray(body.nightly_breakdown)).toBeTruthy();
    expect(body.nights).toBe(2);
  });

  test('POST /api/pricing/calculate with invalid dates returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/pricing/calculate`, {
      data: { checkIn: '2026-05-05', checkOut: '2026-05-03', guests: 2 }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/pricing/calculate with guests > 6 and isDayOnly false returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/pricing/calculate`, {
      data: { checkIn: '2026-05-01', checkOut: '2026-05-03', guests: 7, isDayOnly: false }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

test.describe('Availability API', () => {
  test('GET /api/availability?month=2026-05 returns booked dates', async ({ request }) => {
    const res = await request.get(`${BASE}/api/availability?month=2026-05`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('booked_dates');
    expect(body).toHaveProperty('month');
    expect(Array.isArray(body.booked_dates)).toBeTruthy();
    expect(body.month).toBe('2026-05');
  });

  test('GET /api/availability without month returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/availability`);
    expect(res.status()).toBe(400);
  });
});

test.describe('Reviews API', () => {
  test('GET /api/reviews returns reviews with expected fields', async ({ request }) => {
    const res = await request.get(`${BASE}/api/reviews`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('reviews');
    expect(Array.isArray(body.reviews)).toBeTruthy();

    for (const review of body.reviews) {
      expect(review).toHaveProperty('rating');
      expect(review).toHaveProperty('comment');
      expect(review).toHaveProperty('name');
      expect(review).toHaveProperty('date');
      expect(review.rating).toBeGreaterThanOrEqual(4);
      expect(review.rating).toBeLessThanOrEqual(5);
    }
  });
});

test.describe('Translation API', () => {
  test('POST /api/translate with DE texts and target_lang de returns same texts', async ({ request }) => {
    const res = await request.post(`${BASE}/api/translate`, {
      data: { texts: ['Hallo', 'Garten'], target_lang: 'de' }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('translations');
    expect(body.translations['Hallo']).toBe('Hallo');
    expect(body.translations['Garten']).toBe('Garten');
  });

  test('POST /api/translate with empty texts returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/translate`, {
      data: { texts: [], target_lang: 'en' }
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/translations/preload?lang=en returns translations object', async ({ request }) => {
    const res = await request.get(`${BASE}/api/translations/preload?lang=en`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('translations');
    expect(body).toHaveProperty('lang');
    expect(body.lang).toBe('en');
    expect(typeof body.translations).toBe('object');
  });
});

test.describe('Costs API (requires auth)', () => {
  test('GET /api/costs without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/costs`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/costs/summary without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/costs/summary`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Legal Pages', () => {
  test('GET /impressum returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/impressum`);
    expect(res.ok()).toBeTruthy();
  });

  test('GET /datenschutz returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/datenschutz`);
    expect(res.ok()).toBeTruthy();
  });

  test('GET /agb returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/agb`);
    expect(res.ok()).toBeTruthy();
  });

  test('GET /hausordnung returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/hausordnung`);
    expect(res.ok()).toBeTruthy();
  });

  test('GET /404-test-page returns some response', async ({ request }) => {
    const res = await request.get(`${BASE}/404-test-page`);
    // Should get a response (404 page exists as a catch-all)
    expect(res.status()).toBeGreaterThanOrEqual(200);
  });
});

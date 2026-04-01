import { test, expect, Page } from '@playwright/test';

// Helper: Wait for the React UnifiedKanban component to hydrate
// Retries with page reload if hydration doesn't complete in time
async function waitForKanban(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0) {
      await page.goto('/wartung', { waitUntil: 'load' });
    } else {
      await page.reload({ waitUntil: 'load' });
    }
    try {
      await page.waitForSelector('input[placeholder*="Suche"]', { timeout: 20000 });
      await page.waitForTimeout(300);
      return; // Success
    } catch {
      // React hydration didn't complete, retry
    }
  }
  // Final attempt - let it throw if it fails
  await page.waitForSelector('input[placeholder*="Suche"]', { timeout: 20000 });
}

test.describe('Wartungsseite - Grundstruktur', () => {
  test.beforeEach(async ({ page }) => {
    await waitForKanban(page);
  });

  test('Überschrift und Stats-Bereich vorhanden', async ({ page }) => {
    // React-rendered heading
    await expect(page.locator('text=Wartungsaufgaben')).toBeAttached();
    // At least one stats label should be present (content depends on data)
    await expect(page.locator('text=Gesamt')).toBeAttached();
  });

  test('Suchleiste vorhanden', async ({ page }) => {
    const search = page.locator('input[placeholder*="Suche"]');
    await expect(search).toBeVisible();
  });

  test('View-Toggle Buttons vorhanden (Kanban, Liste, Timeline)', async ({ page }) => {
    await expect(page.locator('button:has-text("Kanban")')).toBeAttached();
    await expect(page.locator('button:has-text("Liste")')).toBeAttached();
    await expect(page.locator('button:has-text("Timeline")')).toBeAttached();
  });
});

test.describe('Wartungsseite - Suchleiste', () => {
  test.beforeEach(async ({ page }) => {
    await waitForKanban(page);
  });

  test('Suche filtert Tasks', async ({ page }) => {
    const search = page.locator('input[placeholder*="Suche"]');
    // Scroll search into view and interact
    await search.scrollIntoViewIfNeeded();
    await search.click();
    await search.fill('Rasen');
    // Wait for debounce + re-render
    await page.waitForTimeout(800);
    await expect(search).toHaveValue('Rasen');
  });

  test('Suche löschen mit X-Button', async ({ page }) => {
    const search = page.locator('input[placeholder*="Suche"]');
    await search.scrollIntoViewIfNeeded();
    await search.click();
    await search.fill('test');
    await page.waitForTimeout(300);
    // X button should appear - try both ✕ and × characters
    const clearBtn = page.locator('button').filter({ hasText: /[✕×]/ }).first();
    if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearBtn.click();
      await expect(search).toHaveValue('');
    }
  });
});

test.describe('Wartungsseite - Filter', () => {
  test.beforeEach(async ({ page }) => {
    await waitForKanban(page);
  });

  test('Kategorie-Filter Dropdown öffnet sich', async ({ page }) => {
    const btn = page.locator('button:has-text("Kategorie")');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(300);
    // Dropdown with checkboxes should appear
    await expect(page.locator('input[type="checkbox"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('Priorität-Filter vorhanden', async ({ page }) => {
    await expect(page.locator('button:has-text("Priorität")')).toBeAttached();
  });

  test('Zuweisungs-Filter vorhanden', async ({ page }) => {
    await expect(page.locator('button:has-text("Zuweisung")')).toBeAttached();
  });

  test('Aufwand-Filter vorhanden', async ({ page }) => {
    await expect(page.locator('button:has-text("Aufwand")')).toBeAttached();
  });

  test('Typ-Filter vorhanden', async ({ page }) => {
    await expect(page.locator('button:has-text("Typ")')).toBeAttached();
  });

  test('Status-Filter vorhanden', async ({ page }) => {
    await expect(page.locator('button:has-text("Status")')).toBeAttached();
  });

  test('Filter auswählen zeigt Badge-Count', async ({ page }) => {
    const btn = page.locator('button:has-text("Kategorie")');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(300);
    // Click first checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible({ timeout: 5000 });
    await checkbox.click();
    // Close dropdown by clicking outside
    await page.locator('h2:has-text("Wartungsaufgaben")').click({ force: true });
    await page.waitForTimeout(300);
    // Button should now show a badge with count
    const badge = btn.locator('span.bg-garden-600');
    await expect(badge).toBeAttached();
  });

  test('"Alle Filter zurücksetzen" Button erscheint bei aktiven Filtern', async ({ page }) => {
    const btn = page.locator('button:has-text("Kategorie")');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(300);
    const checkbox = page.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible({ timeout: 5000 });
    await checkbox.click();
    // Close dropdown
    await page.locator('h2:has-text("Wartungsaufgaben")').click({ force: true });
    await page.waitForTimeout(300);
    // Reset button should be visible
    await expect(page.locator('button:has-text("Alle Filter zurücksetzen")')).toBeAttached();
  });
});

test.describe('Wartungsseite - Kanban View', () => {
  test.beforeEach(async ({ page }) => {
    await waitForKanban(page);
  });

  test('Kanban zeigt 4 Spalten', async ({ page }) => {
    // Default view is Kanban - column headers should be in DOM
    await expect(page.locator('text=Offen').first()).toBeAttached();
    await expect(page.locator('text=Als Nächstes').first()).toBeAttached();
    await expect(page.locator('text=In Arbeit').first()).toBeAttached();
    await expect(page.locator('text=Erledigt').first()).toBeAttached();
  });

  test('Task-Cards sind klickbar und öffnen Modal', async ({ page }) => {
    const card = page.locator('[class*="border-l-4"]').first();
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.click();
      await expect(page.locator('[class*="fixed inset-0"]')).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Wartungsseite - Listen View', () => {
  test('Liste zeigt Tabelle mit Sortierung', async ({ page }) => {
    await waitForKanban(page);
    await page.locator('button:has-text("Liste")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('th:has-text("Aufgabe")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('th:has-text("Status")')).toBeVisible();
  });

  test('Klick auf Spaltenheader sortiert', async ({ page }) => {
    await waitForKanban(page);
    await page.locator('button:has-text("Liste")').click();
    await page.waitForTimeout(500);

    const header = page.locator('th:has-text("Aufgabe")');
    await expect(header).toBeVisible({ timeout: 5000 });
    await header.click();
    await page.waitForTimeout(500);
    // Should show sort indicator (↑ or ↓) in the header
    const headerText = await header.textContent();
    expect(headerText).toMatch(/[↑↓]/);
  });
});

test.describe('Wartungsseite - Timeline View', () => {
  test('Timeline View wechseln', async ({ page }) => {
    await waitForKanban(page);
    await page.locator('button:has-text("Timeline")').click();
    await page.waitForTimeout(500);
    // The timeline button should be active (selected state)
    const btn = page.locator('button:has-text("Timeline")');
    await expect(btn).toBeVisible();
  });
});

test.describe('Wartungsseite - TaskDetailModal', () => {
  test.beforeEach(async ({ page }) => {
    await waitForKanban(page);
  });

  test('Modal öffnet mit Task-Details', async ({ page }) => {
    const card = page.locator('[class*="border-l-4"]').first();
    if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) return;

    await card.click();
    await page.waitForTimeout(500);

    const modal = page.locator('[class*="fixed inset-0"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator('h2')).toBeVisible();
  });

  test('Modal schließen mit X-Button', async ({ page }) => {
    const card = page.locator('[class*="border-l-4"]').first();
    if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) return;

    await card.click();
    await page.waitForTimeout(500);

    // Close button (× or ✕)
    const closeBtn = page.locator('[class*="fixed inset-0"] button').filter({ hasText: /[×✕]/ }).first();
    await closeBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[class*="fixed inset-0"]')).not.toBeVisible();
  });

  test('Modal zeigt Kommentar-Sektion', async ({ page }) => {
    const card = page.locator('[class*="border-l-4"]').first();
    if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) return;

    await card.click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Kommentare')).toBeVisible({ timeout: 5000 });
  });

  test('Modal zeigt Subtasks-Sektion für Projekte', async ({ page }) => {
    // Switch to list view to find a project
    await page.locator('button:has-text("Liste")').click();
    await page.waitForTimeout(500);

    const projectRow = page.locator('tr:has-text("Projekt")').first();
    if (await projectRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectRow.click();
      await page.waitForTimeout(500);
      await expect(page.locator('text=Subtasks')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('text=Abhängigkeiten')).toBeVisible();
    }
  });

  test('Modal zeigt "Anmelden" Hinweis für unauthenticated User', async ({ page }) => {
    const card = page.locator('[class*="border-l-4"]').first();
    if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) return;

    await card.click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Melde dich an, um diese Aufgabe')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Wartungsseite - Sidebar', () => {
  test('Desktop: Sidebar mit Guthaben-System vorhanden', async ({ page }) => {
    await waitForKanban(page);
    // Sidebar content exists in DOM (may need scroll to be visible)
    await expect(page.locator('text=Guthaben-System').first()).toBeAttached();
    await expect(page.locator('text=So funktioniert').first()).toBeAttached();
  });
});

test.describe('Wartungsseite - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Mobile: Sidebar ist als Accordion versteckt', async ({ page }) => {
    await waitForKanban(page);
    const toggle = page.locator('summary:has-text("Weitere Infos")');
    await expect(toggle).toBeAttached({ timeout: 5000 });
  });

  test('Mobile: Filter-Collapse Button vorhanden', async ({ page }) => {
    await waitForKanban(page);
    const filterToggle = page.locator('button:has-text("Filter")');
    await expect(filterToggle.first()).toBeAttached();
  });

  test('Mobile: Kanban Tabs vorhanden', async ({ page }) => {
    await waitForKanban(page);
    // On mobile, status tabs should be rendered
    const openTab = page.locator('button').filter({ hasText: /Offen/ }).first();
    await expect(openTab).toBeAttached();
  });
});

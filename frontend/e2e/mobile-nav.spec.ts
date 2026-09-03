import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Uklad ponizej MOBILE_BREAKPOINT (src/hooks/use-mobile.ts = 1440), czyli m.in.
 * laptopy 1366 i 1280 — w praktyce najczestszy realny rozmiar okna.
 *
 * Ten plik uruchamia sie WYLACZNIE w projekcie `chromium-hamburger`
 * (viewport 1280x720, patrz playwright.config.ts). Reszta testow chodzi na
 * 1600x900, gdzie sidebar jest stalym panelem.
 */
test.describe('Nawigacja przy zwinietym sidebarze (hamburger)', () => {
  test('hamburger otwiera menu, wybor pozycji nawiguje i zamyka panel', async ({ page }) => {
    await login(page);

    // Asercje celuja w SAM panel, nie w cala strone: po wejsciu na /faculties
    // breadcrumb tez wystawia role="link" o nazwie "Wydzialy", wiec niezawezony
    // lokator trafialby w okruszek zamiast w pozycje menu.
    const panel = page.getByRole('dialog', { name: 'Sidebar' });

    // Sidebar jest wysuwanym Sheetem i startuje zamkniety.
    await expect(panel).toBeHidden();

    // SidebarTrigger ma sr-only "Toggle Sidebar" (components/ui/sidebar.tsx).
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('link', { name: 'Wydzialy' }).click();
    await expect(page).toHaveURL(/\/faculties$/);
    await expect(page.getByRole('heading', { name: /Wydzia/i })).toBeVisible();

    // AppSidebar zamyka Sheet po wyborze pozycji (closeOnMobile), zeby nie
    // zaslanial tresci — bez tego panel zostalby otwarty nad widokiem.
    await expect(panel).toBeHidden();
  });
});

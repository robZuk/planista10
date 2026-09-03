import { defineConfig, devices } from '@playwright/test';

/**
 * Konfiguracja testow E2E (Playwright).
 *
 * WAZNE: E2E wymaga DZIALAJACEGO CALEGO STACKU (frontend + backend + Postgres z seedem),
 * bo klika po prawdziwym UI i uderza w prawdziwe API. Playwright sam bazy nie postawi.
 * Najprosciej:
 *
 *   docker compose up -d      # z katalogu glownego repo (front :5174, backend :4001, db)
 *   cd frontend && npx playwright test
 *
 * Adres aplikacji mozna nadpisac zmienna E2E_BASE_URL (np. pod inny port albo demo).
 * Testy pierwszej iteracji sa READ-ONLY (logowanie, walidacja, nawigacja) — nie
 * modyfikuja danych, wiec mozna je puszczac wielokrotnie na tym samym seedzie.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Na CI blokujemy przypadkowo zacommitowane test.only i dajemy retry na flaky.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // UWAGA: viewport musi byc >= MOBILE_BREAKPOINT z src/hooks/use-mobile.ts (1440),
        // inaczej sidebar zwija sie w hamburger (Sheet) i testy nie widza linkow menu.
        // Desktop Chrome daje domyslnie 1280x720 — czyli PONIZEJ progu.
        viewport: { width: 1600, height: 900 },
      },
    },
  ],
});

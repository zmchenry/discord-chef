import { defineConfig, devices } from "@playwright/test";

// Smoke tests at Pixel 7 size against `vite preview` (the production build),
// with every /api request answered by page.route() mocks in e2e/mockApi.ts.
// No Worker or D1 is involved, so this runs anywhere `npm run build` does.
// The real Worker + D1 path is covered by the API tests at the repo root.
//
// The pinned @playwright/test matches the Chromium build under
// PLAYWRIGHT_BROWSERS_PATH where one is pre-installed; CI runs
// `npx playwright install chromium` first.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "off",
    // Service worker registration in the production build would intercept
    // requests and hide them from page.route().
    serviceWorkers: "block",
  },
  projects: [{ name: "pixel-7", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});

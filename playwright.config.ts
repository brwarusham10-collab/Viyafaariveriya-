import { defineConfig, devices } from "@playwright/test";

// E2E runs against a running app + backend with the demo seed loaded:
//   npm run stack:start && npm run stack:seed && npm run dev
// Set CHROMIUM_PATH to use a system Chromium instead of Playwright's download.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args: (process.env.CHROMIUM_ARGS ?? "--no-sandbox").split(" ") }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 }, hasTouch: true }, grep: /@tablet/ },
  ],
});

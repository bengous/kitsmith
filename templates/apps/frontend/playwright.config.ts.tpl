import { defineConfig, devices } from "@playwright/test";

const port = process.env["PLAYWRIGHT_PORT"] ?? "3000";
const baseURL = `http://127.0.0.1:${port}`;
const chromiumExecutablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];
const chromiumLaunchOptions =
  chromiumExecutablePath === undefined
    ? {}
    : {
        launchOptions: {
          executablePath: chromiumExecutablePath,
        },
      };

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env["PLAYWRIGHT_REUSE_SERVER"] === "true",
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...chromiumLaunchOptions },
    },
  ],
});

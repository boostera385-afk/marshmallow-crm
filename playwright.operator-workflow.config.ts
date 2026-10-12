import { defineConfig } from "@playwright/test";
import path from "node:path";
import { tmpdir } from "node:os";

// Separate from the Lovable-specific config; every backend request is mocked.
export default defineConfig({
  testDir: "./tests/operator-workflow",
  outputDir: path.join(tmpdir(), "opencode", "marshmallow-browser-results"),
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: "http://127.0.0.1:8081", browserName: "chromium", channel: "chromium", serviceWorkers: "block", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 8081 --strictPort", url: "http://127.0.0.1:8081", reuseExistingServer: false, timeout: 120000 },
});

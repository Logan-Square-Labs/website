import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The Vitest pool's workerd build lags the Wrangler CLI. Production keeps
      // today's compatibility date; tests pin the newest date this binary accepts.
      miniflare: {
        compatibilityDate: "2026-08-22",
      },
    }),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
  },
});

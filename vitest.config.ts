import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/testSetup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/extension/**/*.ts", "src/shared/**/*.ts", "src/ui/**/*.{ts,tsx}"],
      // GPU lifecycles and entry-page CSP are exercised in Chromium E2E; they
      // are not represented as unit-test coverage. All other UI is included.
      exclude: [
        "**/*.test.*",
        "src/ui/testing.tsx",
        "src/ui/DynamicBackground.tsx",
        "src/ui/backgrounds/{DotGrid,Flash,Galaxy,LightPillar,NeuroNoise,SilkFlow,Snow}.tsx"
      ],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 65,
        lines: 70,
        "src/shared/sync-decision.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "src/shared/statePatch.ts": { statements: 95, branches: 80, functions: 100, lines: 95 },
        "src/extension/stateRepository.ts": { statements: 90, branches: 80, functions: 90, lines: 90 },
        "src/ui/bookmarks.ts": { statements: 90, branches: 80, functions: 90, lines: 90 },
        "src/ui/notes/storage.ts": { statements: 90, branches: 65, functions: 90, lines: 90 }
      }
    }
  }
});

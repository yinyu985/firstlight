import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/extension/background.ts",
        "src/shared/**/*.ts",
        "src/ui/bookmarks.ts",
        "src/ui/notes/{metrics,storage,useNotes}.ts",
        "src/ui/{scrollbar,theme}.ts",
        "src/ui/backgrounds/{canvasSizing,pointerTracking}.ts"
      ],
      thresholds: {
        statements: 55,
        branches: 55,
        functions: 60,
        lines: 55
      }
    }
  }
});

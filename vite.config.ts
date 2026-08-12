import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const manifest = {
  manifest_version: 3,
  name: "Firstlight",
  version: "0.1.1",
  description: "A compact new tab powered by Chrome Bookmarks",
  permissions: ["bookmarks", "storage", "unlimitedStorage"],
  host_permissions: ["https://api.github.com/*", "https://gist.githubusercontent.com/*"],
  chrome_url_overrides: { newtab: "newtab.html" },
  background: { service_worker: "background.js" },
  action: {
    default_title: "Open Firstlight",
    default_icon: {
      "16": "icons/firstlight-16.png",
      "32": "icons/firstlight-32.png",
      "48": "icons/firstlight-48.png",
      "128": "icons/firstlight-128.png"
    }
  },
  icons: {
    "16": "icons/firstlight-16.png",
    "32": "icons/firstlight-32.png",
    "48": "icons/firstlight-48.png",
    "128": "icons/firstlight-128.png"
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src https://api.github.com https://gist.githubusercontent.com"
  }
};

export default defineConfig(({ mode }) => {
  const extension = mode === "extension";
  const plugins: PluginOption[] = [react()];
  if (extension) plugins.push({
    name: "firstlight-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2)
      });
    }
  });
  if (extension) plugins.push({
    name: "firstlight-extension-html",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/\s+crossorigin(?:="[^"]*")?/g, "");
      }
    }
  });
  const input: Record<string, string> = extension
    ? {
        newtab: resolve(rootDir, "newtab.html")
      }
    : { index: resolve(rootDir, "index.html") };
  const manualChunks = (id: string) => {
    if (!id.includes("node_modules")) return undefined;
    if (id.includes("@codemirror/")) return "codemirror";
    if (id.includes("lucide-react")) return "lucide";
    if (id.includes("react") || id.includes("react-dom")) return "react-vendor";
    return "vendor";
  };
  return {
    base: "./",
    plugins,
    define: {
      __FIRSTLIGHT_TARGET__: JSON.stringify(extension ? "extension" : "online")
    },
    build: {
      modulePreload: false,
      outDir: extension ? "dist/extension" : "dist/online",
      emptyOutDir: true,
      rollupOptions: {
        input,
        output: {
          entryFileNames: (chunk) => extension && chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
          manualChunks: extension ? (id) => manualChunks(id) : manualChunks
        }
      }
    }
  };
});

import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json";
import { build as buildScript } from "esbuild";
import { cloudflareHeaders, COMMON_HEADERS, pageCsp } from "./hosting";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const manifest = {
  manifest_version: 3,
  minimum_chrome_version: "120",
  name: "Firstlight",
  version: packageJson.version,
  description: "A compact new tab powered by Chrome Bookmarks",
  permissions: ["alarms", "bookmarks", "storage", "unlimitedStorage"],
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
    extension_pages:
      "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src https://api.github.com https://gist.githubusercontent.com"
  }
};

export default defineConfig(({ mode }) => {
  const extension = mode === "extension";
  const plugins: PluginOption[] = [
    react(),
    {
      name: "firstlight-dev-csp",
      apply: "serve",
      transformIndexHtml(html, context) {
        // Only the development server needs HMR; preview and release keep their CSP.
        return context.server ? html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi, "") : html;
      }
    }
  ];
  if (!extension) {
    const rendererScript = async () =>
      (
        await buildScript({
          entryPoints: [resolve(rootDir, "src/data-renderer.ts")],
          bundle: true,
          write: false,
          format: "iife",
          target: "chrome120",
          minify: true
        })
      ).outputFiles[0].text;
    plugins.push({
      name: "firstlight-online-security",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/data-renderer.js") return next();
          void rendererScript()
            .then((script) => {
              response.setHeader("Content-Type", "text/javascript");
              response.end(script);
            })
            .catch(next);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          for (const [key, value] of Object.entries(COMMON_HEADERS)) response.setHeader(key, value);
          const csp = pageCsp((request.url ?? "/").split("?")[0]);
          if (csp) response.setHeader("Content-Security-Policy", csp);
          next();
        });
      },
      async generateBundle() {
        this.emitFile({ type: "asset", fileName: "data-renderer.js", source: await rendererScript() });
        this.emitFile({ type: "asset", fileName: "_headers", source: cloudflareHeaders() });
      }
    });
  }
  if (extension)
    plugins.push({
      name: "firstlight-manifest",
      async writeBundle(options) {
        await rm(resolve(options.dir!, "data-renderer.html"), { force: true });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "manifest.json",
          source: JSON.stringify(manifest, null, 2)
        });
      }
    });
  if (extension)
    plugins.push({
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
    : {
        index: resolve(rootDir, "index.html"),
        "data-viewer": resolve(rootDir, "data-viewer.html")
      };
  const manualChunks = (id: string) => {
    if (!id.includes("node_modules")) return undefined;
    if (id.includes("@codemirror/")) return "codemirror";
    if (id.includes("lucide-react")) return "lucide";
    if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return "react-vendor";
    return "vendor";
  };
  return {
    base: "./",
    plugins,
    define: {
      __FIRSTLIGHT_TARGET__: JSON.stringify(extension ? "extension" : "online")
    },
    build: {
      target: "chrome120",
      modulePreload: extension ? false : { polyfill: false },
      outDir: extension ? "dist/extension" : "dist/online",
      emptyOutDir: true,
      rollupOptions: {
        input,
        output: {
          entryFileNames: (chunk) => (extension && chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
          manualChunks: extension ? (id) => manualChunks(id) : manualChunks
        }
      }
    }
  };
});

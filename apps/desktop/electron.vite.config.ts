import { defineConfig } from "electron-vite";

const updateSource = process.env.NEDIA_UPDATE_SOURCE ?? "github";

if (updateSource !== "github" && updateSource !== "gitee") {
  throw new Error(
    `NEDIA_UPDATE_SOURCE must be "github" or "gitee", received: ${updateSource}`,
  );
}

export default defineConfig({
  main: {
    define: {
      __NEDIA_UPDATE_SOURCE__: JSON.stringify(updateSource),
    },
    build: {
      rollupOptions: {
        external: ["electron", "playwright", "playwright-core"],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          inlineDynamicImports: true,
        },
      },
    },
  },
  renderer: {
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "preact",
    },
    server: {
      port: 3000,
      strictPort: true,
    },
  },
});

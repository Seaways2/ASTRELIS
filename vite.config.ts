import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type ModuleInfo = { isEntry: boolean; importers: readonly string[] } | null;

/** Whether a module is loaded at startup: an entry, or statically imported by one that is. */
function loadedAtStartup(id: string, getModuleInfo: (id: string) => ModuleInfo, seen = new Map<string, boolean>()): boolean {
  const known = seen.get(id);
  if (known !== undefined) return known;
  seen.set(id, false); // cycles resolve through another importer
  const info = getModuleInfo(id);
  const eager = Boolean(info && (info.isEntry || info.importers.some(importer => loadedAtStartup(importer, getModuleInfo, seen))));
  seen.set(id, eager);
  return eager;
}

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Third-party code changes rarely; keeping it apart from the app code
        // keeps the app chunk small. Only what startup loads anyway goes into
        // the vendor chunks: the per-format metadata parsers stay lazy.
        manualChunks(id, { getModuleInfo }) {
          if (!id.includes("node_modules") || !loadedAtStartup(id, getModuleInfo)) return undefined;
          if (/[\\/]node_modules[\\/](\.pnpm[\\/])?(react|react-dom|scheduler)[@\\/]/.test(id)) return "vendor-react";
          return "vendor";
        }
      }
    }
  }
});

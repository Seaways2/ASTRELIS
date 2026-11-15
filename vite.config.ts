import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type ModuleInfo = { isEntry: boolean; importers: readonly string[] } | null;

type GetModuleInfo = (id: string) => ModuleInfo;
/** Modules known to load at startup, per build. Only "yes" is cached: a "no" may be a cycle still being walked. */
const startupModules = new WeakMap<GetModuleInfo, Set<string>>();

/** Whether a module is loaded at startup: an entry, or statically imported by one that is. */
function loadedAtStartup(id: string, getModuleInfo: GetModuleInfo, visiting = new Set<string>()): boolean {
  let known = startupModules.get(getModuleInfo);
  if (!known) startupModules.set(getModuleInfo, known = new Set());
  if (known.has(id)) return true;
  if (visiting.has(id)) return false;
  visiting.add(id);
  const info = getModuleInfo(id);
  const eager = Boolean(info && (info.isEntry || info.importers.some(importer => loadedAtStartup(importer, getModuleInfo, visiting))));
  if (eager) known.add(id);
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

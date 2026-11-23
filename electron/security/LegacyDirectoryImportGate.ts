import fs from "node:fs";

/**
 * vst:directory-import migrates the plugin folders that 1.x kept in renderer
 * localStorage. It adds folders without the folder dialog, and the scanner
 * loads every module in them, so it must not stay a general "add directory"
 * route. It is open only while the plugin directory store has never been
 * written (the first launch of a build that has the store), for one call, and
 * only until the renderer has read the directory list (its startup does the
 * migration first).
 */
export class LegacyDirectoryImportGate {
  private open: boolean;

  constructor(directoryStoreFile: string) {
    this.open = !fs.existsSync(directoryStoreFile);
  }

  /** True once, if the migration is still allowed; closes the gate either way. */
  take() {
    const open = this.open;
    this.open = false;
    return open;
  }

  close() {
    this.open = false;
  }
}

import fs from "node:fs";
import path from "node:path";
export type VstProfile = "music" | "video";
/** Switch only while the caller owns the audio transition queue. */
export class VstStateProfiles {
  private active: VstProfile = "music";
  constructor(private root: string) {}
  directory(profile: VstProfile = this.active) { return profile === "music" ? this.root : path.join(this.root, "video"); }
  async switchTo(profile: VstProfile, hasEngine: boolean, send: (command: Record<string, unknown>) => Promise<unknown>) {
    if (profile === this.active) return;
    const command = async (value: Record<string, unknown>) => {
      const result = await send(value) as { ok?: boolean; error?: string };
      if (!result?.ok) throw new Error(result?.error || "VST_PROFILE_SWITCH_FAILED");
    };
    if (hasEngine) {
      await command({ type: "pause" });
      await command({ type: "state-save", stateDirectory: this.directory(), closeEditors: true });
      // Unload under the OLD directory. Native loadRack saves existing instances
      // before replacing them, and reuses identical IDs unless explicitly emptied.
      await command({ type: "rack", plugins: [], stateDirectory: this.directory() });
    }
    if (profile === "video") {
      const target = this.directory("video");
      const marker = path.join(target, ".migrated");
      if (!fs.existsSync(marker)) {
        fs.mkdirSync(target, { recursive: true });
        for (const name of fs.readdirSync(this.root)) {
          if (!name.endsWith(".vststate")) continue;
          const destination = path.join(target, name);
          if (!fs.existsSync(destination)) fs.copyFileSync(path.join(this.root, name), destination, fs.constants.COPYFILE_EXCL);
        }
        fs.writeFileSync(marker, "1");
      }
    }
    this.active = profile;
  }
}

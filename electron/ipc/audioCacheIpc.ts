import path from "node:path";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { AudioCacheMaintenance } from "../audioCacheMaintenance";
import type { DecodedAudioCache } from "../library/media/DecodedAudioCache";
import { missingSourceResult, sourceIsMissing } from "../library/media/sourceAvailability";

type PreparedHdmiSource = { path: string; codec: string; analysisPath?: string };

export interface AudioCacheIpcDeps {
  audioCache: AudioCacheMaintenance;
  decodedAudioCache: DecodedAudioCache;
  trustedCacheRequest(event: IpcMainInvokeEvent): boolean;
  authorisedAudio(input: unknown): string;
  prepareLocalSource(source: string): Promise<string>;
  prepareHdmiSource(source: string): Promise<PreparedHdmiSource>;
}

/** Audio cache inspection/cleanup and next-track / HDMI direct pre-preparation. */
export function registerAudioCacheIpc({
  audioCache, decodedAudioCache, trustedCacheRequest, authorisedAudio, prepareLocalSource, prepareHdmiSource
}: AudioCacheIpcDeps) {
  let prefetchBusy = false;
  ipcMain.handle("cache:inspect", async event => {
    if (!trustedCacheRequest(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
    try { return { ok: true, ...await audioCache.inspect() }; }
    catch (error) { return { ok: false, error: String(error) }; }
  });
  ipcMain.handle("cache:clear", async event => {
    if (!trustedCacheRequest(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
    try { return await audioCache.clear(); }
    catch (error) { return { ok: false, error: String(error) }; }
  });
  ipcMain.handle("cache:protect", async (event, files: unknown) => {
    if (!trustedCacheRequest(event) || !Array.isArray(files) || files.length > 4) return;
    audioCache.protect("renderer", files.filter((file): file is string => typeof file === "string" && path.isAbsolute(file)));
  });
  ipcMain.handle("library:prefetch", async (event, input: unknown, direct: boolean) => {
    if (!trustedCacheRequest(event) || prefetchBusy) return { ok: false, busy: true };
    prefetchBusy = true;
    try {
      const source = authorisedAudio(input);
      return await audioCache.use(async () => {
        if (direct === true) {
          const prepared = await prepareHdmiSource(source);
          const analysisPath = prepared.codec.startsWith("pcm") ? undefined : await decodedAudioCache.prepare(source);
          audioCache.protect("next", [prepared.path, ...(analysisPath ? [analysisPath] : [])]);
        } else audioCache.protect("next", [await prepareLocalSource(source)]);
        return { ok: true };
      });
    } catch (error) { return { ok: false, error: String(error) }; }
    finally { prefetchBusy = false; }
  });
  ipcMain.handle("library:prepare-direct", async (_, input: unknown) => {
    try {
      const source = authorisedAudio(input);
      if (await sourceIsMissing(source)) return missingSourceResult(source);
      return await audioCache.use(async () => {
        const prepared = await prepareHdmiSource(source);
        audioCache.protect("prepared-direct", [prepared.path, ...(prepared.analysisPath ? [prepared.analysisPath] : [])]);
        return { ok: true, codec: prepared.codec };
      });
    } catch (error) { return { ok: false, error: String(error) }; }
  });
}

import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { QueueStore } from "../queue/QueueStore";

/** Playback queue persistence; only the main window's top frame may use it. */
export function registerQueueIpc({ getMainWindow, queueStore, writeLog }: {
  getMainWindow(): BrowserWindow | null;
  queueStore: QueueStore;
  writeLog(level: string, message: string): void;
}) {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const window = getMainWindow();
    return Boolean(window) && event.sender === window!.webContents && event.senderFrame === window!.webContents.mainFrame;
  };
  ipcMain.handle("queue:load", event => trusted(event) ? queueStore.load() : null);
  // A one-way message so a save sent from beforeunload still arrives.
  ipcMain.on("queue:save", (event, payload: unknown) => {
    if (!trusted(event)) return;
    if (!queueStore.save(payload)) writeLog("QUEUE", "Rejected a malformed queue snapshot");
  });
}

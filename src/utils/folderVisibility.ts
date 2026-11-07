export const folderKey = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
export function withinFolder(file: string, folder: string) { const a = folderKey(file), b = folderKey(folder); return a === b || a.startsWith(b + "/"); }
export function hiddenByFolders(file: string | undefined, folders: readonly string[]) { return !!file && folders.some(folder => withinFolder(file, folder)); }

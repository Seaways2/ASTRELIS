import fs from "node:fs";
import path from "node:path";

// Installed builds fail closed: never silently create a second profile in AppData.
export function installedDataPath(executable: string) {
  const bytes = fs.readFileSync(path.join(path.dirname(executable), "astrelis-data.ini"));
  const text = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8");
  const selected = /^Path=(.+)$/mi.exec(text)?.[1].trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("安装版用户数据目录配置缺失，请重新运行安装程序。");
  const root = path.resolve(selected);
  const owner = path.join(root, ".astrelis-owner");
  // Recover an absent/empty configured folder only. Never adopt existing unknown data.
  if (!fs.existsSync(owner)) {
    if (root === path.parse(root).root)
      throw new Error("用户数据目录需要使用专用文件夹，不能直接使用磁盘根目录，请重新运行安装程序。");
    for (let cursor = root; ; cursor = path.dirname(cursor)) {
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
        throw new Error("用户数据目录不能使用链接，请重新运行安装程序。");
      if (cursor === path.dirname(cursor)) break;
    }
    if (fs.existsSync(root) && fs.readdirSync(root).length)
      throw new Error(`用户数据目录缺少归属标记，已有文件已保留。请在安装程序中选择新的空目录：${root}`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(owner, "com.auralis.player", { flag: "wx" });
  }
  const marker = fs.readFileSync(owner, "utf8").trim();
  if (marker !== "com.auralis.player") throw new Error("用户数据目录归属校验失败，请重新运行安装程序。");
  const profile = path.join(root, "Profile");
  fs.mkdirSync(profile, { recursive: true });
  const probe = path.join(profile, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, "", { flag: "wx" });
  fs.unlinkSync(probe);
  return profile;
}

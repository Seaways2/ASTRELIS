import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
const folderKey = (value: string) => path.resolve(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const withinFolder = (file: string, folder: string) => { const a = folderKey(file), b = folderKey(folder); return a === b || a.startsWith(b + "/"); };
const derive = promisify(crypto.scrypt);
type Config = { salt: string; hash: string; roots: string[] };
export class FolderVisibility {
  private data?: Config;
  private open = false;
  private broken = false;
  private retryAt = 0;
  constructor(private file: string, private encode: (s: string) => Buffer, decode: (b: Buffer) => string) {
    if (fs.existsSync(file)) try {
      const data = JSON.parse(decode(fs.readFileSync(file)));
      if (!/^[a-f0-9]{32}$/.test(data.salt) || !/^[a-f0-9]{64}$/.test(data.hash) || !Array.isArray(data.roots) || data.roots.some((p: unknown) => typeof p !== "string" || !path.isAbsolute(p))) throw Error();
      this.data = data;
    } catch { this.broken = true; }
  }
  status() { return { configured: !!this.data, unlocked: this.open, roots: this.data?.roots || [], broken: this.broken }; }
  blocked(file: string) { return this.broken || !this.open && !!this.data?.roots.some(root => withinFolder(file, root)); }
  private password(value: unknown) { if (typeof value !== "string" || value.length < 4 || value.length > 128) throw Error("密码至少 4 位，可使用纯数字"); return value; }
  private save(data: Config) { fs.mkdirSync(path.dirname(this.file), {recursive:true}); fs.writeFileSync(this.file + ".tmp", this.encode(JSON.stringify(data))); fs.renameSync(this.file + ".tmp", this.file); this.data = data; }
  private async verify(password: unknown) {
    if (this.broken) throw Error("保护配置无法读取，请恢复配置备份");
    if (!this.data) throw Error("尚未设置密码");
    if (Date.now() < this.retryAt) throw Error("请稍候再试");
    const hash = await derive(this.password(password), this.data.salt, 32) as Buffer;
    if (!crypto.timingSafeEqual(hash, Buffer.from(this.data.hash, "hex"))) { this.retryAt = Date.now() + 1000; throw Error("密码不正确"); }
  }
  async hide(folder: string, password: unknown) {
    if (this.broken) throw Error("保护配置无法读取");
    if (!path.isAbsolute(folder)) throw Error("文件夹路径无效");
    if (this.data) await this.verify(password);
    else { const salt = crypto.randomBytes(16).toString("hex"); this.save({salt,hash:(await derive(this.password(password),salt,32) as Buffer).toString("hex"),roots:[]}); }
    this.save({...this.data!, roots:this.data!.roots.some(root => withinFolder(folder,root)) ? this.data!.roots : [...this.data!.roots.filter(root => !withinFolder(root,folder)),folder]});
    this.open = false;
  }
  async unlock(password: unknown) { await this.verify(password); this.open = true; }
  lock() { this.open = false; }
  unhide(folder: string) { if (!this.open) throw Error("请先解锁"); this.save({...this.data!,roots:this.data!.roots.filter(root => !withinFolder(root, folder))}); }
  async change(password: unknown, next: unknown) { await this.verify(password); const salt = crypto.randomBytes(16).toString("hex"); this.save({...this.data!,salt,hash:(await derive(this.password(next),salt,32) as Buffer).toString("hex")}); }
}

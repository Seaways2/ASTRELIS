import { app, type BrowserWindow } from "electron";
import path from "node:path";
export interface VideoBounds { x: number; y: number; width: number; height: number; visible: boolean }
export function validVideoBounds(input: unknown): input is VideoBounds {
  const b = input as VideoBounds;
  return Boolean(b && [b.x,b.y,b.width,b.height].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 32768) && typeof b.visible === "boolean");
}
export class VideoSurface {
  private handle?: Buffer;
  private bounds: VideoBounds = { x:0,y:0,width:1,height:1,visible:false };
  private addon = require(app.isPackaged ? path.join(process.resourcesPath,"native-window/window_outline.node") : path.join(__dirname,"../native-window/build/Release/window_outline.node")) as {
    createVideoSurface(parent: Buffer): Buffer;
    moveVideoSurface(handle: Buffer,x: number,y: number,w: number,h: number,visible: boolean): boolean;
  };
  constructor(private window: BrowserWindow) {
    window.on("resize",()=>this.update());window.on("move",()=>this.update());
  }
  attach() {
    this.handle ??= this.addon.createVideoSurface(this.window.getNativeWindowHandle());
    this.update(); return String(this.handle.readUInt32LE(0));
  }
  set(input: unknown) { if(!validVideoBounds(input)) throw new Error("VIDEO_BOUNDS_INVALID");this.bounds=input;this.update(); }
  hide() { this.bounds={...this.bounds,visible:false};this.update(); }
  private update() {
    if(!this.handle || this.window.isDestroyed()) return;
    const b=this.bounds,z=this.window.webContents.getZoomFactor();
    this.addon.moveVideoSurface(this.handle,b.x*z,b.y*z,b.width*z,b.height*z,b.visible);
  }
}

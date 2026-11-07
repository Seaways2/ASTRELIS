type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type ResizeWindow = {
  getBounds(): Bounds;
  getMinimumSize(): number[];
  setBounds(bounds: Bounds, animate: boolean): void;
};

// Both the cursor provider (screen.getCursorScreenPoint) and BrowserWindow
// bounds use Electron DIP coordinates. Never accept renderer screen/client
// coordinates or multiply these values by a monitor's scaleFactor.
export class DipWindowResize {
  private session: { edge: string; cursor: Point; bounds: Bounds; window: ResizeWindow } | null = null;

  constructor(private readonly getWindow: () => ResizeWindow | null,
    private readonly cursor: () => Point, private readonly enabled: () => boolean) {}

  begin(edge: string) {
    this.end();
    const window = this.getWindow();
    if (!window || !this.enabled() || !/^(n|ne|e|se|s|sw|w|nw)$/.test(edge)) return;
    this.session = { edge, cursor: this.cursor(), bounds: window.getBounds(), window };
  }

  update() {
    const session = this.session;
    if (!session) return;
    if (!this.enabled() || this.getWindow() !== session.window) { this.end(); return; }
    const point = this.cursor();
    const dx = point.x - session.cursor.x, dy = point.y - session.cursor.y;
    const [minWidth, minHeight] = session.window.getMinimumSize();
    let { x: left, y: top } = session.bounds;
    let right = left + session.bounds.width, bottom = top + session.bounds.height;
    if (session.edge.includes("e")) right = Math.max(left + minWidth, right + dx);
    if (session.edge.includes("s")) bottom = Math.max(top + minHeight, bottom + dy);
    if (session.edge.includes("w")) left = Math.min(right - minWidth, left + dx);
    if (session.edge.includes("n")) top = Math.min(bottom - minHeight, top + dy);
    const bounds = { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
    const current = session.window.getBounds();
    if (Object.keys(bounds).some(key => bounds[key as keyof Bounds] !== current[key as keyof Bounds]))
      session.window.setBounds(bounds, false);
  }

  end() { this.session = null; }
}

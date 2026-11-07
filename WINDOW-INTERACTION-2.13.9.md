# 2.13.9 标题栏和音量浮层回归修复

## 原因与修复

1. 主输出面板的关闭按钮没有被删除。2.13.8 将标题栏改成原生拖动区域后，覆盖标题栏的 Portal 浮层没有明确排除拖动区域。原生拖动命中测试不按 CSS z-index 自动排除上面的浮层。为整个 `.channel-strip-popover` 设置 `-webkit-app-region: no-drag`，恢复关闭按钮和其他控件的鼠标输入。
2. 独立窗口的真实鼠标诊断收到 `WM_SYSCOMMAND (0x0112)`，参数是 `SC_MAXIMIZE | HTCAPTION (0xF032)`，而不是旧代码监听的 `WM_NCLBUTTONDBLCLK`。透明、无厚边框窗口需要通过 Electron 的 maximize/unmaximize API 完成动作。改为只处理这个标题栏命令，保留原生拖动；紧凑模式不执行标题栏双击最大化。

涉及 electron/main.ts、src/styles/global.css、package.json、auralis-version.json 及相关测试。应用版本 2.13.9，原生音频宿主保持 2.13.5。没有恢复 window:move 或 JavaScript setPosition 循环。

## 验证

- 本机旧安装版：真实点击主输出关闭按钮无效，标题栏双击无效，均已复现。
- 修复版独立测试窗口：真实鼠标双击最大化、双击还原均成功，消息日志包含 MAXIMIZED/RESTORED。
- 修复版 1200×720 测试窗口：点击底部喇叭打开主输出，面板顶部覆盖标题栏；点击右上角关闭按钮后面板消失，可访问性树也确认对话框已关闭。
- pnpm build：通过。
- pnpm test:electron：160 项通过，新增标题栏系统命令的最大化/还原、其他命令排除及紧凑模式保护测试。
- Renderer 专项：32 项通过（window-drag、immersive-light-theme、native-glass-corner、audio-baseline）。
- node tests/visual/run-window-geometry.cjs：通过，包括浮层 no-drag、窗口按钮、紧凑/沉浸模式、DIP 缩放取消和重启恢复副屏位置。

日志保存在 release-work/2.13.9-*.log。修复前局部副本在 release-work/2.13.9-before-caption-fix。本次风险中，保持既有数据与音频功能兼容，尚未打包安装程序。已退出诊断窗口并恢复用户的原安装版窗口；运行中的旧版不会自动获得源码修复。

上一版验证仅检查了 maximize 按钮和程序接口，未覆盖真实标题栏双击与浮层重叠，这次已补充。混合 DPI 实机验证仍沿用 2.13.8 记录中的限制。

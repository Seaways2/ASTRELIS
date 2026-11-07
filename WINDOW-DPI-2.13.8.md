# 2.13.8 窗口拖动与 DPI 修复

## 检查与原因

已读取 README.md 和《项目长期开发与安全规范.txt》。当前源码目录没有 Git，不能获得未提交修改清单；修改前相关文件保存在 release-work/2.13.8-before-window-fix，未回退既有功能。

普通标题栏原先是 no-drag，由 App.tsx 捕获 pointerdown 的 clientX/clientY，再使用后续 screenX/screenY 减去初始偏移，通过 preload 的 window:move 每帧调用 BrowserWindow.setPosition。这里把渲染器客户区偏移、跨屏屏幕坐标和主进程 DIP 坐标当作同一坐标系，也让 Windows 的 DPI 切换与连续程序移窗交错执行。

沉浸缩放原先同样把 Renderer screen 坐标差直接加到 BrowserWindow.getBounds 返回的 DIP 矩形，且缺少 lostpointercapture 和失焦清理。代码缺陷已确认；本机两块显示器均为 100%，没有实机重现混合 DPI 的逐渐增大现象，因此不能声称已完成真实混合 DPI 验收。

native-window/outline.cpp 只维护窗口轮廓和材质，不处理 WM_DPICHANGED，没有发现这里的尺寸缩放循环。

## 修改

- 普通/紧凑标题栏使用 -webkit-app-region: drag；按钮、输入等控件使用 no-drag。
- 删除普通标题栏 JavaScript 拖动、moveTo 预加载接口及 window:move 主进程处理器。保留既有原生标题栏双击最大化钩子。
- 新增 electron/windowGeometry.ts：沉浸八方向缩放只在主进程读取 screen.getCursorScreenPoint() 与窗口初始 DIP 矩形，按初始状态计算，不累计上一次结果。相同矩形不重复 setBounds。
- 不手工换算 WM_DPICHANGED 的物理像素矩形，不对已有 DIP 再乘除 scaleFactor。系统负责原生标题栏跨屏移动及 DPI 切换。
- 松键、取消、丢失捕获、失焦、最大化/还原、最小化、窗口关闭、页面重载/崩溃、沉浸/紧凑/穿透模式切换均取消缩放。禁用模式和其他窗口的缩放 IPC 不生效。
- 窗口状态文件格式不变；应用版本 2.13.8，音频原生宿主版本保持 2.13.5。

## 本机验证

- pnpm build：通过。
- pnpm test:electron：159 项通过。包括新增六项 DIP 缩放测试；已有窗口保存、恢复、关闭和偏好测试继续通过。
- node --test tests/renderer/window-drag.test.cjs tests/renderer/immersive-light-theme.test.cjs tests/renderer/native-glass-corner.test.cjs tests/renderer/audio-baseline.test.cjs：31 项通过。
- node tests/visual/run-window-geometry.cjs：真实主进程、预加载及 Renderer 集成通过。验证标题栏 CSS、最大化/还原/最小化按钮、紧凑/沉浸模式、缩放 IPC、重复位置不放大、结束/失焦后不继续缩放、保存以及独立进程重启恢复副屏负坐标位置和尺寸。使用独立测试配置，没有读取或改写用户音乐库。
- 模拟测试覆盖 100%、125%、150%、200% 的 DIP 输入、负坐标显示器、边界往返、八方向及最小尺寸。模拟不是实际 WM_DPICHANGED 测试。
- 实机显示器：(-1920, 0, 1920, 1080) 和 (0, 0, 1920, 1080)，scaleFactor 均为 1。
- 测试退出时 Chromium 输出过 GPU 清理诊断信息，窗口断言和进程退出码正常。

日志：release-work/2.13.8-build.log、2.13.8-electron-tests.log、2.13.8-renderer-tests.log、2.13.8-window-integration.log。

## 待实机验收

将两块显示器设置为不同缩放比例（如 100% 与 150%），重新启动后从两块屏幕分别开始拖动、跨屏往返和按住静止；观察 DIP 宽高不变，释放后位置不再变化。测试正常/最大化还原/紧凑/沉浸标题栏和沉浸八方向缩放，再关闭重启检查恢复。系统缩放不同会使物理像素大小变化，这不等于逻辑窗口尺寸变化。

风险等级中。已保留局部回滚副本，未改用户数据格式，建议在混合 DPI 设备上复核后再发布。本次只修改、构建和测试源码，未打包安装程序。

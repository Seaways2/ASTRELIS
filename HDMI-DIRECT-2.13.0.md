# ASTRELIS 2.13.0：HDMI 直通

本版是源码开发版，应用和原生宿主均为 2.13.0；保留原来的 2.12.9 安装包。本次没有制作新安装包。

## 使用

1. 用 HDMI 将电脑连接到功放，并让 Windows 识别功放音频输出。DisplayPort 音频端点也允许选择。
2. 打开「音频设备」，在输出设备中选择功放，再点击「播放策略 → HDMI 直通」。开关默认关闭。
3. 播放本地音乐。首次播放先完整准备并校验直通缓存，再打开设备；大文件可能需要等待。后续复用缓存。
4. 音量请在功放上调节。直通跳过软件音量、静音、淡入淡出和 VST；主输出浮层会显示直通状态。在线音乐保持原来的网页播放路线。
5. 点击「普通播放」关闭直通，恢复普通输出设置。选择其他设备后再次点击 HDMI 直通，应用新的端点。

## 支持边界

| 音源 | HDMI 输出 |
| --- | --- |
| MP3、FLAC、WAV、AIFF、APE 等可解码文件 | 本地解码为 PCM，保留采样率和已识别的声道布局，不重采样、不降混、不加音效 |
| DTS Core、AC-3、E-AC-3 | 不解码，复制压缩帧并封装成 IEC 61937 数据，由功放解码 |
| TrueHD、DTS-HD、DSD | 本版不支持编码直通，明确停止；可手动使用普通播放 |

PCM 支持已识别的 1–8 声道布局。整数 PCM 使用 16 或 32 位容器，24 位数据在 32 位容器内保持有效位数；32 位浮点 PCM 保持浮点格式。64 位浮点暂不支持原样输出。

真正播放前由 Windows WASAPI 独占模式检查目标设备是否支持精确格式。格式不支持、设备断开、缓存损坏时停止，不自动切换共享模式或其他设备。功放支持的格式也受显卡驱动和 HDMI 连接方式限制。编码直通状态中的采样率和输出声道数表示传输载体，不等于压缩音源的声道数。

PCM 的可视化只读取副本；编码直通不生成解码后的频谱。当前实现先将整首音频转换成原始传输缓存，PCM 缓存可能明显大于 FLAC/MP3，且没有自动容量淘汰。缓存位于当前用户数据目录的 `direct-audio` 子目录；源文件改变会生成新缓存。退出播放器后可删除该子目录重新生成，不要删除音乐文件。

## 验证记录（2026-09-13）

- `pnpm build`：通过。
- `pnpm test:electron`：151 项通过，包含 24 位 FLAC 逐样本一致性、缓存复用、DTS/AC-3/E-AC-3 封装和损坏帧拒绝测试。
- `pnpm test:renderer`：203 项中 199 项通过。4 项既有失败来自缺失的 LEVEL-0-LIBRARY-UPGRADE-BASELINE.md、LEVEL-1-LIBRARY-REPOSITORY.md、LEVEL-7-STORAGE-DECISION.md；没有跳过或伪造这些文档。
- `pnpm test:native`：版本、格式描述、帧对齐、设备拒绝和原有播放生命周期测试通过。
- `node tests/visual/run-electron-ui.cjs hdmi-ui.cjs`：模拟设备的深浅色开关、控件禁用、浮层及错误状态通过，不代表真实设备测试。
- `node tests/native/hdmi-device-smoke.cjs`：本机仅检测到 Quantum LT 和 WDM2VST，两者均被正确拒绝作为 HDMI 端点。实际功放出声、设备占用、热拔插、编码切换及多声道位置仍需连接 RX-V4A 后验收。
- `K:\music\HIFI\古典\01.金蛇狂舞.wav`：FFmpeg 在末尾约 309.47 秒报 `Unrecognized large DTS frame`，无法完整生成直通缓存，本版会停止并提示切回普通播放。没有截掉尾部或把编码数据作为 PCM 输出。

## 实现位置

- `electron/library/media/DirectAudioCache.ts`：音源识别、无 DSP 准备、缓存、完整帧校验。
- `native-host/src/HdmiDirectOutput.cpp`：独立 WASAPI 独占字节输出、播放/暂停/定位、设备错误处理。
- `PlaybackEngine.cpp`：直通与原有 JUCE/VST 路线的生命周期切换。
- `App.tsx`、`WorkspacePage.tsx`、`ChannelStripPopover.tsx`：入口、状态和处理旁路。

格式依据：[Microsoft IEC 61937 格式说明](https://learn.microsoft.com/en-us/windows/win32/coreaudio/representing-formats-for-iec-61937-transmissions)。

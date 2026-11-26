import { mediaLibraryMessages } from "./mediaLibrary";
import { currentFeatureMessages } from "./currentFeatures";
import { videoMessages } from "./video";
import { directOutputMessages } from "./directOutput";
import { useSyncExternalStore } from "react";
import { systemSettingsMessages } from "./systemSettings";
import { playbackNoticeMessages } from "./playbackNotices";

export type Language = "system" | "zh-CN" | "en-US" | "ja-JP";
type ResolvedLanguage = Exclude<Language, "system">;

const messages: Record<ResolvedLanguage, Record<string, string>> = {
  "zh-CN": {
    "library.manageFolders": "文件夹管理", "library.addFolder": "添加文件夹",
    "library.removeFolder": "移除", "library.removeConfirm": "移除此目录的媒体库记录？",
    "library.confirmRemove": "确认移除", "library.cancelRemove": "取消",
    "library.removeHint": "移除仅清理媒体库记录，不删除磁盘文件，不影响当前播放队列。",
    "library.stats.tracks": "媒体",
    "library.stats.artists": "艺术家",
    "library.stats.albums": "专辑",
    "library.stats.hifi": "高保真音源",
    "library.stats.size": "总容量",
    ...systemSettingsMessages["zh-CN"],
    ...directOutputMessages["zh-CN"],
    ...currentFeatureMessages["zh-CN"],
    ...videoMessages["zh-CN"],
    ...mediaLibraryMessages["zh-CN"],
    ...playbackNoticeMessages["zh-CN"],
    "playback.failed": "无法播放「{name}」：文件已损坏或格式不受支持", "playback.failedSkipped": "无法播放「{name}」（文件已损坏或格式不受支持），已跳到下一首", "playback.startFailed": "无法开始播放",
    "appearance.group.theme": "主题与背景",
    "appearance.group.glass": "玻璃与光影",
    "appearance.group.music": "音乐响应",
    "appearance.group.motion": "动画与性能",
    "appearance.group.performance": "性能选项",
    "fx.response": "起伏幅度",
    "fx.title": "视觉氛围",
    "fx.description": "调节随音乐变化的反光、唱盘光效和材质细节。",
    "fx.light": "光线",
    "fx.surface": "材质",
    "fx.disc": "唱盘",
    "fx.motion": "动态",
    "fx.coverColors": "封面氛围色",
    "fx.coverColorsHint": "提取封面颜色；无封面时使用主题色",
    "fx.glassEdges": "音乐响应反光",
    "fx.glassEdgesHint": "反光以鼠标为光源；亮度随这首歌的强弱和鼓点起伏，暂停后平缓回落",
    "fx.orbitParticles": "轨道微粒",
    "fx.orbitParticlesHint": "唱盘周围缓慢运行的少量光点",
    "fx.trackTransition": "柔和切歌过渡",
    "fx.trackTransitionHint": "切歌时封面、信息与氛围色柔和过渡",
    "fx.intensity": "装饰光效强度",
    "fx.eco": "低性能模式下暂停新增视觉效果，偏好仍会保存。",
    "fx.motionHint": "关闭界面动画或启用系统减少动态效果时，保留静态配色与材质；窗口隐藏时暂停动态效果。",
    "layout.showMeters": "展开音频仪表", "layout.hideMeters": "收起音频仪表",
    "timeline.seek": "播放进度", "timeline.help": "方向键调整 5 秒，Shift + 方向键调整 30 秒，Home / End 跳至开头或结尾",
    "nav.nowPlaying": "正在播放", "nav.playlist": "播放列表", "nav.library": "媒体中心", "nav.online": "在线音乐",
    "nav.devices": "音频设备", "nav.plugins": "插件管理", "nav.appearance": "外观设置", "nav.settings": "系统设置",
    "mode.spectrum": "柱状频谱", "mode.mirror": "镜像频谱", "mode.waveform": "银河旋涡",
    "mode.radial": "环形频谱", "mode.particles": "星空律动", "mode.pulse": "黑洞脉冲",
    "page.playlist": "播放列表", "page.library": "媒体中心", "page.online": "在线音乐", "page.devices": "音频设备",
    "page.plugins": "插件管理", "page.appearance": "外观设置", "page.settings": "系统设置",
    "settings.language": "界面语言", "settings.languageHint": "切换星律的界面显示语言", "language.system": "跟随系统",
    "language.zh": "简体中文", "language.en": "English", "language.ja": "日本語", "common.addMusic": "添加音乐",
    "common.tracks": "首曲目", "common.track": "曲目", "common.format": "格式", "common.size": "大小",
    "common.selectAudio": "选择音频文件", "common.emptyPlaylist": "播放列表中还没有曲目", "common.defaultOutput": "系统默认输出",
    "common.back": "返回", "common.refresh": "刷新", "common.close": "关闭", "common.enable": "启用", "common.disable": "停用",
    "common.open": "打开", "common.current": "当前", "common.muted": "静音", "common.mute": "静音", "common.unmute": "取消静音", "common.bypass": "旁通", "common.remove": "移除", "common.moveUp": "上移", "common.moveDown": "下移",
    "common.minimize": "最小化", "common.maximize": "最大化", "common.restore": "还原", "common.play": "播放", "common.pause": "暂停", "common.stop": "停止", "common.previous": "上一首", "common.next": "下一首", "common.shuffle": "随机播放", "common.repeat": "循环模式", "common.importFiles": "导入文件", "common.importAudio": "导入音频", "common.waitingAudio": "等待导入音频", "common.dropOrLibrary": "拖入文件或从媒体中心添加", "common.operationFailed": "操作未完成", "common.compactMode": "紧凑悬浮模式", "common.exitCompactMode": "退出紧凑悬浮模式",
    "device.detecting": "正在检测", "device.engineReady": "引擎就绪", "device.offline": "离线", "device.reportedRates": "可报告采样率", "device.bufferRange": "缓冲范围", "device.unknown": "未知",
    "device.outputMode": "输出模式", "device.modeSharedHint": "推荐日常使用。与其他程序共享声卡，VST 正常工作；不同采样率由共享引擎重采样。", "device.modeLowLatencyHint": "VST 正常工作并降低输出延迟；插件链较重时可增大缓冲以避免断续。", "device.modeExclusiveHint": "VST 正常工作并独占声卡，可跟随音源采样率；其他程序可能无声，切换音源可能短暂重建。", "device.outputDevice": "输出设备", "device.inUse": "当前使用", "device.default": "默认",
    "device.guideTitle": "输出状态与使用说明", "device.guideIntro": "日常听歌建议先选 WASAPI Shared，采样率保留 System，缓冲保留 Auto。播放正常就不必调整。下图说明开启原生输出时，本地音乐如何送到耳机或音箱。", "device.signalPath": "播放过程与设置建议", "device.signalSource": "音乐文件", "device.whenEnabled": "开启后才使用", "device.signalNative": "原生输出", "device.signalDevice": "耳机 / 音箱",
    "device.guideNativeTitle": "三种模式怎么选？", "device.guideNativeBody": "WASAPI Shared 适合日常听歌，也方便同时听到其他软件的声音。Shared Low Latency 适合需要声音更快响应的情况；若出现卡顿，可改回 Shared。WASAPI Exclusive 会独占所选设备，其他软件可能暂时无法通过它发声。原生输出负责把声音送到设备，开启它不会自动美化音色。", "device.guideVstTitle": "VST 是什么？需要开启吗？", "device.guideVstBody": "VST 是音效插件，例如均衡器，可以调节低音、高音等听感。普通听歌不需要开启。想使用插件时，先开启原生输出，再到“插件管理”添加并启用插件处理；三种模式都支持。关闭插件处理后，声音会跳过这些音效。", "device.guideRateTitle": "采样率要改吗？", "device.guideRateBody": "通常保留 System，让 Windows 或设备决定即可，数字更大不代表原来的歌曲会更好听。Follow Source 表示跟随歌曲：独占模式可能在切歌时短暂停顿来重新打开设备；共享模式会转换到设备当前使用的采样率。没有明确需要时，不必选固定数值。", "device.guideBufferTitle": "有杂音或卡顿时怎么办？", "device.guideBufferBody": "缓冲可以理解为播放器提前准备的一小段声音，通常保留 Auto。出现爆音、断续时，可以尝试增大缓冲，或减少同时使用的插件。缓冲小，声音响应更快，但对电脑要求更高；缓冲大，通常更稳，但响应稍慢。它不是音质高低的开关。",
    "device.sampleRate": "采样率", "device.rateSystem": "由设备或系统决定", "device.rateFollowSource": "Exclusive 重建 / Shared 重采样", "device.buffer": "缓冲", "device.deviceDefault": "设备默认", "device.exclusiveFallback": "独占失败处理", "device.fallbackLowLatency": "降级到 Shared Low Latency", "device.fallbackShared": "降级到 Shared", "device.fallbackRestore": "不自动降级，仅恢复旧路由", "device.applying": "正在验证并切换…", "device.switching": "正在切换…", "device.nativeDeviceHint": "原生输出、VST 和本地音乐使用此设备。网易云和 YouTube 继续使用关闭原生输出时选择的设备。", "device.nativeOn": "已开启", "device.nativeOff": "已关闭 · 网页输出", "device.nativeHdmi": "HDMI 直通中", "device.applyConfiguration": "应用输出配置", "device.webFallbackHint": "统一用于网易云、YouTube，以及关闭原生输出时的本地播放。选择后立即生效。", "device.signalFade": "淡入淡出（如已设置）", "device.signalEffects": "音效插件（VST）",
    "device.engineUnavailable": "Native 输出引擎不可用", "device.enumerateFailed": "无法枚举 Native 输出设备", "device.statusFailed": "无法读取 Native 输出状态", "device.inspectFailed": "Native 输出检测失败", "device.capabilitiesFailed": "无法读取候选设备能力", "device.applyFailed": "候选配置未能生效", "device.degraded": "候选模式不可用，已降级并恢复声音", "device.applied": "已应用并验证", "device.transactionFailed": "Native 输出事务失败", "device.recoveryPrevious": "已恢复切换前路由", "device.recoverySafeShared": "旧路由恢复失败，已启用安全 Shared", "device.recoveryFallback": "已按策略降级", "device.recoveryFailed": "自动恢复失败", "device.recoveryUnchanged": "当前路由未改变", "device.youtubeDirectNativeLocked": "YouTube Direct 播放时原生输出保持关闭；只有实验室模式允许与 YouTube VST 同时开启", "device.youtubeDirectNativeGuide": "点击前往“实验室模式 · YouTube VST”",
    "appearance.opacity": "窗口透明度与明暗", "appearance.opacityHint": "调节窗口背景层的透明程度", "appearance.glass": "全窗口玻璃材质", "appearance.glassHint": "选择 Windows 原生云母、亚克力或透明背景", "appearance.glow": "光晕强度", "appearance.glowHint": "调节控件与面板的环境光晕", "appearance.customAccent": "自定义颜色",
    "appearance.gpuAcceleration": "GPU 全局光效", "appearance.gpuReady": "合成器可用 · 2D 场景保持", "appearance.gpuUnavailable": "GPU 光效不可用，将保持纯 Canvas 2D", "appearance.gpuOn": "GPU FX ON", "appearance.gpuOff": "PURE 2D", "appearance.gpuEcoOverride": "ECO OVERRIDE",
    "appearance.gpuQuality": "GPU 光效等级", "appearance.gpuQualityHint": "设置全局 Bloom、柔光扩散与环境光层级", "appearance.gpuEco": "ECO · 核显/低功耗", "appearance.gpuStandard": "标准 · 推荐", "appearance.gpuCosmic": "宇宙级 · 高性能独显",
    "appearance.animations": "界面动画", "appearance.animationsHint": "关闭后停用装饰动画和过渡", "appearance.transition": "可视化切换效果", "appearance.transitionHint": "选择分析视图之间的过渡风格", "appearance.transitionDissolve": "柔焦溶解 · 默认", "appearance.transitionFade": "纯淡化", "appearance.transitionZoom": "景深缩放", "appearance.transitionSlide": "横向滑移", "appearance.transitionScan": "扫描揭示", "appearance.lowPerformanceMode": "全局低性能模式", "appearance.lowPerformanceModeHint": "暂停 VST、毛玻璃、背景图、光晕与高频渲染，保留基础播放", "appearance.lowPerformanceActive": "ECO ACTIVE", "appearance.lowPerformanceFull": "FULL QUALITY", "vst.lowPerformanceNotice": "全局低性能模式已暂停所有 VST 音频处理", "vst.nativeOutputRequiredTitle": "请先开启原生输出", "vst.nativeOutputRequiredChannelHint": "VST 插入链需要原生输出；点击查看协作说明", "vst.nativeOutputRequiredGuideHint": "VST 插件处理依赖原生输出链路。请使用右上角开关开启原生输出，再返回插件管理或推子使用 VST。",
    "appearance.customBackground": "自定义播放器背景", "appearance.chooseBackground": "点击选择图片", "appearance.clearBackgroundConfirm": "是否清空当前背景图片？", "appearance.backgroundSaveFailed": "无法保存背景图片", "appearance.backgroundDeleteFailed": "无法删除背景图片",
    "appearance.mica": "Mica · 稳定云母", "appearance.acrylic": "Acrylic · 兼容亚克力", "appearance.transparent": "关闭 · 仅透明背景", "appearance.colorMode": "界面明暗模式", "appearance.colorModeHint": "选择深色、浅色或跟随 Windows", "appearance.dark": "深色 · 深空控制台", "appearance.light": "浅色 · 冰晶工作台", "appearance.system": "跟随 Windows 系统",
    "settings.alwaysOnTop": "窗口置顶", "settings.alwaysOnTopHint": "让播放器保持在其他窗口上方", "settings.windowMemory": "窗口状态记忆", "settings.windowMemoryHint": "自动保存窗口位置、尺寸与最大化状态",
    "settings.mediaKeys": "Windows 媒体快捷键", "settings.mediaKeysHint": "支持播放、暂停、上一首、下一首及耳机媒体按键", "settings.performance": "性能状态", "settings.performanceHint": "Canvas 使用设备刷新率，界面仪表采用节流刷新", "settings.backend": "音频后端",
    "library.connected": "媒体库已连接", "library.create": "建立你的媒体库", "library.scanHint": "扫描音乐与视频，自动读取信息和生成封面", "library.scan": "扫描文件夹", "library.scanning": "扫描中…", "library.rescan": "重新扫描媒体库",
    "library.folder": "文件夹", "library.shelf": "分类", "library.shelfBadge": "{folders} 个文件夹 · {count} 项", "library.favorites": "我的收藏", "library.artist": "艺术家", "library.album": "专辑", "library.search": "搜索媒体、艺术家或专辑…", "library.root": "媒体中心", "library.parent": "返回上一级", "library.overview": "总览",
    "queue.missing": "文件缺失", "queue.missingHint": "找不到这个文件，可能已被移动或删除。重新扫描所在文件夹后，可从媒体中心再次加入。", "library.addLayer": "加入本层", "library.addArtist": "艺术家全部加入队列", "library.addAlbum": "整张专辑加入队列", "library.inQueue": "已在队列", "library.addQueue": "加入队列", "library.favorite": "收藏歌曲", "library.unfavorite": "取消收藏", "library.removeTrack": "移出播放列表", "library.selectTrack": "勾选歌曲", "library.selectAll": "全部勾选", "library.selectedCount": "已选 {count} 首", "library.addSelected": "加入播放列表", "library.noFavorites": "还没有收藏本地歌曲", "library.noFavoritesHint": "在媒体库或播放列表点击心形按钮即可收藏", "library.noMatch": "没有匹配的声波", "library.awaiting": "媒体库等待扫描", "library.tryFilter": "尝试更换搜索词或分类", "library.awaitingHint": "选择包含音乐的文件夹，支持 APE / DSF / FLAC 等 HiFi 音源", "library.uncategorized": "未分类",
    "library.scanDiscovering": "正在发现音频文件", "library.scanIndexing": "正在建立索引", "library.scanMetadata": "正在读取音频标签", "library.enumerating": "枚举目录中", "library.categoryOverview": "分类总览", "library.collection": "合集", "library.unknownArtist": "未知艺术家", "library.clearPlaylist": "清空播放列表", "library.scrollMore": "向下滚动继续加载", "library.queueUpdated": "播放列表已更新",
    "library.viewFlow": "3D 封面流", "library.viewGrid": "网格", "library.viewList": "列表", "library.viewMosaic": "拼贴封面", "library.previewFullscreen": "全屏预览", "library.previewExit": "退出预览", "library.zoom": "缩放", "library.media.all": "全部", "library.media.audio": "音乐", "library.media.video": "视频", "library.viewMode": "媒体库视图", "library.viewLarge": "大封面", "library.viewCards": "标准卡片", "library.viewDetails": "详细信息", "library.sortBy": "排序", "library.sortTitle": "媒体名称", "library.sortArtist": "艺术家", "library.sortAlbum": "专辑", "library.sortFormat": "格式", "library.sortSize": "文件大小", "library.sortTrack": "曲目号", "library.sortAscending": "升序", "library.sortDescending": "降序", "library.cover": "封面", "library.item": "项目", "library.info": "主要信息", "library.summary": "补充信息", "library.type": "类型", "library.countSize": "数量 / 大小", "library.actions": "操作", "library.open": "打开",
    "visual.title": "实时分析", "visual.tune": "可视化调校", "visual.smoothing": "平滑系数", "visual.sensitivity": "灵敏度", "visual.bars": "特效数量", "visual.lineWidth": "特效大小", "visual.speed": "动画速度", "visual.decay": "衰减速度", "visual.peakHold": "峰值保持", "visual.flash": "节拍闪光", "visual.glints": "星芒数量", "visual.accentShare": "星空主题色占比", "visual.pointerStrength": "互动强度", "visual.pointer": "鼠标互动", "visual.pointerHint": "星空：跟随鼠标转向，按住加速跃迁。银河：悬停吸引星星，点击发出密度波。黑洞：点击投喂物质。ECO、OBS 模式和减少动态效果时自动关闭", "visual.reset": "恢复全部默认值",
    "visual.fftSize": "FFT 大小", "visual.barOpacity": "特效透明度", "visual.immersive": "沉浸式可视化", "visual.obsTransparent": "OBS 全透明输出", "visual.lockClickThrough": "锁定并允许鼠标穿透", "visual.unlockClickThrough": "点击解除窗口穿透", "visual.maximize": "最大化窗口", "visual.restore": "还原窗口", "visual.exitImmersive": "退出沉浸式", "visual.dragMaxRestore": "拖动窗口 · 双击最大化/还原",
    "vst.installed": "已安装插件", "vst.search": "搜索名称、厂商、分类或格式", "vst.none": "没有发现兼容插件", "vst.rack": "Master 插件机架", "vst.emptyRack": "从左侧双击插件，建立处理链", "vst.addFolder": "添加自定义目录", "vst.rescan": "重新扫描", "vst.enableProcessing": "启用原生处理", "vst.disableProcessing": "停用处理",
    "vst.showUnavailable": "显示不兼容插件", "vst.hideUnavailable": "隐藏不兼容插件", "vst.waitingSession": "等待扫描会话", "vst.locations": "插件位置", "vst.enableDirectory": "启用此目录", "vst.disableDirectory": "停用此目录", "vst.removeDirectory": "移除自定义目录", "vst.retryModule": "重新尝试扫描此模块", "vst.clearQuarantine": "清除隔离并重新扫描", "vst.unknownVendor": "未知厂商", "vst.uncategorized": "未分类", "vst.discovering": "发现插件文件", "vst.readingCache": "读取扫描缓存", "vst.nativeValidation": "JUCE 原生验证", "vst.diagnosticOnly": "无法加载的插件仅供诊断，不能加入机架", "vst.addHint": "双击插件添加到机架", "vst.configOnlyWarning": "当前机架仅保存配置。启用原生处理后，本地文件与网易云将通过原生插件链播放；此按钮不会让 YouTube 进入 VST。", "vst.openEditor": "打开插件原生界面", "vst.searchAdd": "搜索并添加插件…", "vst.noMatched": "没有匹配的兼容插件", "vst.scanningDatabase": "正在扫描插件数据库…", "vst.noEffects": "未加载效果器", "vst.openFullRack": "打开完整插件机架", "vst.insertChain": "效果器插入链",
    "vst.stateNotScanned": "等待扫描", "vst.stateReady": "可用", "vst.stateMissing": "目录不存在", "vst.stateAccessDenied": "无访问权限", "vst.stateNoModules": "没有插件模块", "vst.stateNoPlugins": "没有兼容插件", "vst.stateScannerError": "扫描异常",
    "vst.skip": "跳过", "vst.disable": "禁用", "vst.skipCurrent": "跳过当前正在验证的插件", "vst.disableCurrent": "禁用当前插件，今后扫描自动跳过", "vst.enableModule": "解除禁用并重新扫描",
    "queue.title": "播放队列", "queue.empty": "导入音乐后，曲目会出现在这里", "queue.remove": "从队列删除",
    "meter.channelMonitor": "声道监视", "meter.signalEnergy": "信号能量", "meter.live": "实时", "meter.low": "低频", "meter.mid": "中频", "meter.high": "高频", "meter.peak": "峰值", "meter.rms": "平均电平", "meter.streamData": "流媒体数据", "meter.format": "格式", "meter.sampleRate": "采样率", "meter.bitDepth": "位深", "meter.unavailable": "暂不可用", "meter.output": "输出",
    "channel.title": "音量与效果器通道条", "channel.masterOutput": "主输出", "channel.rescan": "重新扫描插件", "channel.openPlugin": "打开插件界面", "channel.removePlugin": "移除插件", "channel.currentLevel": "当前输出电平", "channel.mainVolume": "主音量",
    "settings.onlineStableMode": "在线音乐稳定模式", "settings.onlineStableModeHint": "YouTube 与网易云固定使用 Web Direct，不经过 VST、原生输出或淡入淡出；本地播放的 Native/VST 设置保持不变",
    "settings.youtubeProcessLoopback": "进程回环后端 · 实验", "settings.youtubeProcessLoopbackHint": "下一次 YouTube VST 会话改用 Windows 进程回环；默认关闭，异常时单次切回 Direct",
    "settings.youtubeVstLab": "实验室模式 · YouTube VST", "settings.youtubeVstLabHint": "允许统一 VST 开关为当前 YouTube 会话接入插件链；默认仍为 YouTube Direct", "settings.knownLimit": "已知限制", "settings.youtubeVstLimit": "窗口被全屏内容完全遮挡时可能断续或爆音；最小化/托盘会自动退出 YouTube VST，恢复后不会自动重启。", "settings.youtubeVstConfirm": "YouTube VST 属于实验功能，仅建议在星律保持前台时使用。\n\n窗口被全屏程序完全遮挡时仍可能出现断续或爆音；最小化或进入托盘时，星律会自动退出 VST 并切回 YouTube Direct，恢复窗口后需要手动重新开启。\n\n是否继续开启实验室模式？",
    "vst.modeNotice": "VST 模式提示", "vst.onlineWebDirect": "在线音乐固定使用 Web Direct；本地音乐仍可使用 VST 与原生输出", "vst.labLockedDetail": "YouTube 当前为 Direct；请先在设置中开启实验室模式", "vst.youtubeDisableDetail": "关闭本次 YouTube VST 会话并切回 YouTube Direct", "vst.youtubeEnableDetail": "为本次 YouTube 会话启用实验 VST；最小化或进入托盘时会自动退出", "vst.labRequiredNotice": "YouTube 保持 Direct。请先在设置中确认并开启“实验室模式 · YouTube VST”。", "vst.youtubeDisabledNotice": "YouTube VST 已关闭，当前已切回 YouTube Direct。", "vst.backgroundFallbackNotice": "检测到窗口最小化或进入托盘，YouTube VST 已自动退出并切回 Direct。恢复前台后请手动重新开启 VST。", "vst.labDisabledNotice": "实验室模式已关闭，YouTube VST 已退出并切回 Direct。", "vst.youtubeDirectNativeDisabledNotice": "YouTube Direct 已启动，VST 与原生输出保持关闭；只有实验室模式允许同时开启。", "vst.localPlayback": "本地播放", "vst.processingOn": "VST 插件处理已开启", "vst.processingOff": "VST 插件处理已关闭",
    "vst.healthFallbackNotice": "检测到后台音频时钟失速或输出不连续，已短淡出并切回 YouTube Direct。",
    "drop.releaseImport": "释放以导入文件", "drop.addToQueue": "文件将添加到当前播放队列",
    "module.browse": "浏览与筛选", "online.back": "后退", "online.forward": "前进", "online.home": "YouTube Music 主页", "online.initializing": "正在初始化安全浏览器…"
  },
  "en-US": {
    "library.manageFolders": "Manage folders", "library.addFolder": "Add folder",
    "library.removeFolder": "Remove", "library.removeConfirm": "Remove this folder from the library?",
    "library.confirmRemove": "Confirm removal", "library.cancelRemove": "Cancel",
    "library.removeHint": "Removes library records only. Files on disk and the playback queue are preserved.",
    "library.stats.tracks": "MEDIA",
    "library.stats.artists": "ARTISTS",
    "library.stats.albums": "ALBUMS",
    "library.stats.hifi": "HIFI SOURCES",
    "library.stats.size": "ARCHIVE SIZE",
    ...systemSettingsMessages["en-US"],
    ...directOutputMessages["en-US"],
    ...currentFeatureMessages["en-US"],
    ...videoMessages["en-US"],
    ...mediaLibraryMessages["en-US"],
    ...playbackNoticeMessages["en-US"],
    "playback.failed": "Can't play \"{name}\": the file is damaged or its format is not supported", "playback.failedSkipped": "Can't play \"{name}\" (the file is damaged or its format is not supported); skipped to the next track", "playback.startFailed": "Playback could not start",
    "appearance.group.theme": "Theme & background",
    "appearance.group.glass": "Glass & lighting",
    "appearance.group.music": "Music response",
    "appearance.group.motion": "Animation & performance",
    "appearance.group.performance": "Performance options",
    "fx.response": "Pulse depth",
    "fx.title": "Visual atmosphere",
    "fx.description": "Adjust music-reactive reflections, disc lighting and surface details.",
    "fx.light": "Light",
    "fx.surface": "Surface",
    "fx.disc": "Disc",
    "fx.motion": "Motion",
    "fx.coverColors": "Artwork colors",
    "fx.coverColorsHint": "Use artwork colors, with your theme as fallback",
    "fx.glassEdges": "Music-reactive reflection",
    "fx.glassEdgesHint": "The pointer is the light source; brightness pulses with the song's dynamics and beats, settling when paused",
    "fx.orbitParticles": "Orbital particles",
    "fx.orbitParticlesHint": "A few light points orbit the optical deck",
    "fx.trackTransition": "Track transitions",
    "fx.trackTransitionHint": "Gently fade artwork, text and ambient colors",
    "fx.intensity": "Decorative lighting strength",
    "fx.eco": "New effects are paused in low-performance mode; preferences are saved.",
    "fx.motionHint": "Disabling animations or requesting reduced motion keeps static color and material. Motion pauses when hidden.",
    "layout.showMeters": "Show audio meters", "layout.hideMeters": "Hide audio meters",
    "timeline.seek": "Playback position", "timeline.help": "Arrow keys: 5 seconds. Shift + arrow: 30 seconds. Home / End: start or end.",
    "nav.nowPlaying": "Now Playing", "nav.playlist": "Playlist", "nav.library": "Media Library", "nav.online": "Online Music",
    "nav.devices": "Audio Devices", "nav.plugins": "Plugins", "nav.appearance": "Appearance", "nav.settings": "Settings",
    "mode.spectrum": "Bar Spectrum", "mode.mirror": "Mirror Spectrum", "mode.waveform": "Galaxy Spiral",
    "mode.radial": "Radial Spectrum", "mode.particles": "Starfield Motion", "mode.pulse": "Black Hole Pulse",
    "page.playlist": "Playlist", "page.library": "Media Library", "page.online": "Online Music", "page.devices": "Audio Devices",
    "page.plugins": "Plugin Management", "page.appearance": "Appearance Settings", "page.settings": "System Settings",
    "settings.language": "Interface Language", "settings.languageHint": "Choose the language used by ASTRELIS", "language.system": "Follow System",
    "language.zh": "简体中文", "language.en": "English", "language.ja": "日本語", "common.addMusic": "Add Music",
    "common.tracks": "tracks", "common.track": "Track", "common.format": "Format", "common.size": "Size",
    "common.selectAudio": "Select Audio Files", "common.emptyPlaylist": "No tracks in the playlist", "common.defaultOutput": "System Default Output",
    "common.back": "Back", "common.refresh": "Refresh", "common.close": "Close", "common.enable": "Enable", "common.disable": "Disable",
    "common.open": "Open", "common.current": "Current", "common.muted": "Muted", "common.mute": "Mute", "common.unmute": "Unmute", "common.bypass": "Bypass", "common.remove": "Remove", "common.moveUp": "Move Up", "common.moveDown": "Move Down",
    "common.minimize": "Minimize", "common.maximize": "Maximize", "common.restore": "Restore", "common.play": "Play", "common.pause": "Pause", "common.stop": "Stop", "common.previous": "Previous", "common.next": "Next", "common.shuffle": "Shuffle", "common.repeat": "Repeat Mode", "common.importFiles": "Import Files", "common.importAudio": "Import Audio", "common.waitingAudio": "Waiting for Audio", "common.dropOrLibrary": "Drop files here or add them from the library", "common.operationFailed": "Operation Failed", "common.compactMode": "Compact Floating Mode", "common.exitCompactMode": "Exit Compact Floating Mode",
    "device.detecting": "Detecting", "device.engineReady": "Engine Ready", "device.offline": "Offline", "device.reportedRates": "Reported sample rates", "device.bufferRange": "Buffer range", "device.unknown": "Unknown",
    "device.outputMode": "Output Mode", "device.modeSharedHint": "Recommended for everyday use. Shares the device with other apps, supports VST, and resamples differing rates in the shared engine.", "device.modeLowLatencyHint": "Keeps VST available while reducing output latency; increase the buffer if a heavy plug-in chain stutters.", "device.modeExclusiveHint": "Keeps VST available while taking exclusive control and following source rates; other apps may be silent and source changes may briefly reopen the device.", "device.outputDevice": "Output Device", "device.inUse": "In Use", "device.default": "Default",
    "device.guideTitle": "Output status and help", "device.guideIntro": "For everyday listening, start with WASAPI Shared, System sample rate and Auto buffer. If playback works well, leave them as they are. The diagram shows how local music reaches your headphones or speakers with Native output enabled.", "device.signalPath": "Playback and setup tips", "device.signalSource": "Music file", "device.whenEnabled": "if enabled", "device.signalNative": "Native Output", "device.signalDevice": "Headphones / speakers",
    "device.guideNativeTitle": "Which mode should I choose?", "device.guideNativeBody": "WASAPI Shared suits everyday listening and lets other apps share the device. Shared Low Latency is useful when you need a quicker response; switch back to Shared if playback stutters. WASAPI Exclusive reserves the selected device, so other apps may be unable to use it. Native output sends sound to the device; enabling it does not automatically improve the tone.", "device.guideVstTitle": "What is VST? Do I need it?", "device.guideVstBody": "VST plug-ins are optional effects, such as an equalizer for adjusting bass and treble. You do not need them for ordinary listening. To use them, enable Native output, then add plug-ins and enable processing in Plug-ins. All three modes support them. Disabling processing skips the effects.", "device.guideRateTitle": "Should I change the sample rate?", "device.guideRateBody": "Usually leave this on System and let Windows or the device decide. A higher number does not make the original song sound better. Follow Source follows the track: Exclusive may pause briefly to reopen the device between tracks; Shared converts to the device’s current rate. Choose a fixed value only when you need one.", "device.guideBufferTitle": "What if playback crackles or stutters?", "device.guideBufferBody": "The buffer is a short piece of sound prepared ahead of time. Usually leave it on Auto. If you hear crackling or dropouts, try a larger buffer or fewer active plug-ins. Smaller buffers respond faster but demand more from the computer; larger buffers tend to be steadier but respond slightly later. This is not a sound-quality switch.",
    "device.sampleRate": "Sample Rate", "device.rateSystem": "Decided by the device or system", "device.rateFollowSource": "Exclusive reopen / Shared resampling", "device.buffer": "Buffer", "device.deviceDefault": "Device default", "device.exclusiveFallback": "Exclusive Failure Handling", "device.fallbackLowLatency": "Fall back to Shared Low Latency", "device.fallbackShared": "Fall back to Shared", "device.fallbackRestore": "Do not fall back; restore the previous route", "device.applying": "Validating and switching…", "device.switching": "Switching…", "device.nativeDeviceHint": "Native output, VST and local music use this device. NetEase and YouTube keep the device chosen while native output is off.", "device.nativeOn": "On", "device.nativeOff": "Off · web output", "device.nativeHdmi": "HDMI direct", "device.applyConfiguration": "Apply Output Configuration", "device.webFallbackHint": "Used by NetEase Cloud Music, YouTube, and local playback when Native output is off. Changes apply immediately.", "device.signalFade": "Fade (if configured)", "device.signalEffects": "Effects (VST)",
    "device.engineUnavailable": "Native output engine is unavailable", "device.enumerateFailed": "Could not enumerate Native output devices", "device.statusFailed": "Could not read Native output status", "device.inspectFailed": "Native output inspection failed", "device.capabilitiesFailed": "Could not read candidate device capabilities", "device.applyFailed": "The candidate configuration could not be applied", "device.degraded": "Candidate mode unavailable; audio recovered using fallback", "device.applied": "Applied and verified", "device.transactionFailed": "Native output transaction failed", "device.recoveryPrevious": "Restored the route used before switching", "device.recoverySafeShared": "Previous route restore failed; Safe Shared is active", "device.recoveryFallback": "Fell back according to policy", "device.recoveryFailed": "Automatic recovery failed", "device.recoveryUnchanged": "The current route was not changed", "device.youtubeDirectNativeLocked": "Native output stays off during YouTube Direct playback; only Laboratory mode allows it together with YouTube VST", "device.youtubeDirectNativeGuide": "Open Laboratory mode · YouTube VST",
    "appearance.opacity": "Window Transparency & Brightness", "appearance.opacityHint": "Adjust the transparency of the window background layer", "appearance.glass": "Full-window Glass Material", "appearance.glassHint": "Choose native Windows Mica, Acrylic, or a transparent background", "appearance.glow": "Glow Strength", "appearance.glowHint": "Adjust the ambient glow around controls and panels", "appearance.customAccent": "Custom Color",
    "appearance.gpuAcceleration": "GPU Global Lighting", "appearance.gpuReady": "Compositor available · 2D scenes retained", "appearance.gpuUnavailable": "GPU lighting unavailable; pure Canvas 2D remains active", "appearance.gpuOn": "GPU FX ON", "appearance.gpuOff": "PURE 2D", "appearance.gpuEcoOverride": "ECO OVERRIDE",
    "appearance.gpuQuality": "GPU Lighting Level", "appearance.gpuQualityHint": "Set global bloom, soft-light spread and ambient-light quality", "appearance.gpuEco": "ECO · Integrated/Low Power", "appearance.gpuStandard": "Standard · Recommended", "appearance.gpuCosmic": "Cosmic · High-performance GPU",
    "appearance.animations": "Interface Animations", "appearance.animationsHint": "Turn off to disable decorative animations and transitions", "appearance.transition": "Visualizer Transition", "appearance.transitionHint": "Choose the handoff style between analysis views", "appearance.transitionDissolve": "Soft Dissolve · Default", "appearance.transitionFade": "Pure Fade", "appearance.transitionZoom": "Depth Zoom", "appearance.transitionSlide": "Horizontal Slide", "appearance.transitionScan": "Scan Reveal", "appearance.lowPerformanceMode": "Global Low Performance Mode", "appearance.lowPerformanceModeHint": "Pause VST, glass, backgrounds, glow and high-rate rendering while keeping playback", "appearance.lowPerformanceActive": "ECO ACTIVE", "appearance.lowPerformanceFull": "FULL QUALITY", "vst.lowPerformanceNotice": "Global Low Performance Mode has suspended all VST audio processing", "vst.nativeOutputRequiredTitle": "Enable Native Output First", "vst.nativeOutputRequiredChannelHint": "The VST insert chain requires Native Output; click to view the guide", "vst.nativeOutputRequiredGuideHint": "VST processing depends on the Native Output path. Use the switch at the top right to enable Native Output, then return to the plug-in rack or channel strip.",
    "appearance.customBackground": "Custom Player Background", "appearance.chooseBackground": "Click to choose image", "appearance.clearBackgroundConfirm": "Clear the current background image?", "appearance.backgroundSaveFailed": "Could not save the background image", "appearance.backgroundDeleteFailed": "Could not remove the background image",
    "appearance.mica": "Mica · Stable Backdrop", "appearance.acrylic": "Acrylic · Compatible Blur", "appearance.transparent": "Off · Transparent Background Only", "appearance.colorMode": "Color Mode", "appearance.colorModeHint": "Use dark, light, or the Windows setting", "appearance.dark": "Dark · Deep Space", "appearance.light": "Light · Frosted Studio", "appearance.system": "Follow Windows",
    "settings.alwaysOnTop": "Always on Top", "settings.alwaysOnTopHint": "Keep the player above other windows", "settings.windowMemory": "Remember Window State", "settings.windowMemoryHint": "Save position, size and maximized state automatically",
    "settings.mediaKeys": "Windows Media Keys", "settings.mediaKeysHint": "Play, pause, previous, next and headset media controls", "settings.performance": "Performance Status", "settings.performanceHint": "Canvas follows the display refresh rate while UI meters are throttled", "settings.backend": "Audio Backend",
    "library.connected": "Music Universe Connected", "library.create": "Build Your Music Universe", "library.scanHint": "Scan folders and let ASTRELIS read tags and build the library index", "library.scan": "Scan Folder", "library.scanning": "Scanning…", "library.rescan": "Rescan Library",
    "library.folder": "Folders", "library.shelf": "Group", "library.shelfBadge": "Folders {folders} · Items {count}", "library.favorites": "My Favorites", "library.artist": "Artists", "library.album": "Albums", "library.search": "Search tracks, artists or albums…", "library.root": "Media Library", "library.parent": "Up One Level", "library.overview": "Overview",
    "queue.missing": "File missing", "queue.missingHint": "This file was not found: it may have been moved or deleted. Rescan its folder, then add it again from the media centre.", "library.addLayer": "Add This Level", "library.addArtist": "Add all artist tracks to queue", "library.addAlbum": "Add entire album to queue", "library.inQueue": "In Queue", "library.addQueue": "Add to Queue", "library.favorite": "Add to Favorites", "library.unfavorite": "Remove from Favorites", "library.removeTrack": "Remove from Playlist", "library.selectTrack": "Select Track", "library.selectAll": "Select All", "library.selectedCount": "{count} tracks selected", "library.addSelected": "Add to Playlist", "library.noFavorites": "No favorite local tracks yet", "library.noFavoritesHint": "Use the heart button in the library or playlist to add favorites", "library.noMatch": "No Matching Tracks", "library.awaiting": "Library Awaiting Scan", "library.tryFilter": "Try another search or category", "library.awaitingHint": "Choose a music folder; APE, DSF, FLAC and other HiFi formats are supported", "library.uncategorized": "Uncategorized",
    "library.scanDiscovering": "Discovering audio files", "library.scanIndexing": "Building library index", "library.scanMetadata": "Reading audio metadata", "library.enumerating": "Enumerating folders", "library.categoryOverview": "Category Overview", "library.collection": "Collection", "library.unknownArtist": "Unknown Artist", "library.clearPlaylist": "Clear Playlist", "library.scrollMore": "Scroll down to load more", "library.queueUpdated": "Playlist Updated",
    "library.viewFlow": "Cover Flow", "library.viewGrid": "Grid", "library.viewList": "List", "library.viewMosaic": "Mosaic Covers", "library.previewFullscreen": "Fullscreen Preview", "library.previewExit": "Exit Preview", "library.zoom": "Zoom", "library.media.all": "All", "library.media.audio": "Music", "library.media.video": "Video", "library.viewMode": "Library View", "library.viewLarge": "Large Covers", "library.viewCards": "Standard Cards", "library.viewDetails": "Details", "library.sortBy": "Sort by", "library.sortTitle": "Track Title", "library.sortArtist": "Artist", "library.sortAlbum": "Album", "library.sortFormat": "Format", "library.sortSize": "File Size", "library.sortTrack": "Track Number", "library.sortAscending": "Ascending", "library.sortDescending": "Descending", "library.cover": "Cover", "library.item": "Item", "library.info": "Primary Info", "library.summary": "Additional Info", "library.type": "Type", "library.countSize": "Count / Size", "library.actions": "Actions", "library.open": "Open",
    "visual.title": "Realtime Analysis", "visual.tune": "Visualizer Tuning", "visual.smoothing": "Smoothing", "visual.sensitivity": "Sensitivity", "visual.bars": "Effect Count", "visual.lineWidth": "Effect Size", "visual.speed": "Animation Speed", "visual.decay": "Decay Speed", "visual.peakHold": "Peak Hold", "visual.flash": "Beat flash", "visual.glints": "Glints", "visual.accentShare": "Starfield theme colour", "visual.pointerStrength": "Interaction strength", "visual.pointer": "Pointer interaction", "visual.pointerHint": "Starfield: steer with the pointer, hold to warp. Galaxy: hover to pull the stars, click to send a density wave. Black hole: click to feed it matter. Off in ECO, OBS mode and with reduced motion", "visual.reset": "Restore All Defaults",
    "visual.fftSize": "FFT Size", "visual.barOpacity": "Effect Opacity", "visual.immersive": "Immersive Visualizer", "visual.obsTransparent": "OBS Transparent Output", "visual.lockClickThrough": "Lock and Enable Click-through", "visual.unlockClickThrough": "Click to Disable Click-through", "visual.maximize": "Maximize Window", "visual.restore": "Restore Window", "visual.exitImmersive": "Exit Immersive Mode", "visual.dragMaxRestore": "Drag Window · Double-click to Maximize/Restore",
    "vst.installed": "Installed Plugins", "vst.search": "Search name, vendor, category or format", "vst.none": "No compatible plugins found", "vst.rack": "Master Plugin Rack", "vst.emptyRack": "Double-click a plugin on the left to build the chain", "vst.addFolder": "Add Custom Folder", "vst.rescan": "Rescan", "vst.enableProcessing": "Enable Native Processing", "vst.disableProcessing": "Disable Processing",
    "vst.showUnavailable": "Show incompatible plugins", "vst.hideUnavailable": "Hide incompatible plugins", "vst.waitingSession": "Waiting for scan session", "vst.locations": "Plugin Locations", "vst.enableDirectory": "Enable this folder", "vst.disableDirectory": "Disable this folder", "vst.removeDirectory": "Remove custom folder", "vst.retryModule": "Retry this module", "vst.clearQuarantine": "Clear quarantine and rescan", "vst.unknownVendor": "Unknown Vendor", "vst.uncategorized": "Uncategorized", "vst.discovering": "Discovering plugin files", "vst.readingCache": "Reading scan cache", "vst.nativeValidation": "JUCE native validation", "vst.diagnosticOnly": "Unavailable plugins are diagnostic only and cannot be loaded", "vst.addHint": "Double-click a plugin to add it to the rack", "vst.configOnlyWarning": "The rack currently stores configuration only. Enable native processing to route local files and NetEase through the plugin chain; this control never routes YouTube into VST.", "vst.openEditor": "Open native plugin editor", "vst.searchAdd": "Search and add plugins…", "vst.noMatched": "No matching compatible plugins", "vst.scanningDatabase": "Scanning plugin database…", "vst.noEffects": "No effects loaded", "vst.openFullRack": "Open Full Plugin Rack", "vst.insertChain": "Effect Insert Chain",
    "vst.stateNotScanned": "Awaiting scan", "vst.stateReady": "Ready", "vst.stateMissing": "Folder Missing", "vst.stateAccessDenied": "Access Denied", "vst.stateNoModules": "No Plugin Modules", "vst.stateNoPlugins": "No Compatible Plugins", "vst.stateScannerError": "Scanner Error",
    "vst.skip": "Skip", "vst.disable": "Disable", "vst.skipCurrent": "Skip the plugin currently being validated", "vst.disableCurrent": "Disable this plugin and skip it in future scans", "vst.enableModule": "Enable and rescan this module",
    "queue.title": "Play Queue", "queue.empty": "Imported tracks will appear here", "queue.remove": "Remove from queue",
    "meter.channelMonitor": "Channel Monitor", "meter.signalEnergy": "Signal Energy", "meter.live": "Live", "meter.low": "Low", "meter.mid": "Mid", "meter.high": "High", "meter.peak": "Peak", "meter.rms": "Average level", "meter.streamData": "Stream Data", "meter.format": "Format", "meter.sampleRate": "Sample Rate", "meter.bitDepth": "Bit Depth", "meter.unavailable": "Unavailable", "meter.output": "Output",
    "channel.title": "Volume and Effects Channel Strip", "channel.masterOutput": "Master Output", "channel.rescan": "Rescan plugins", "channel.openPlugin": "Open plugin editor", "channel.removePlugin": "Remove plugin", "channel.currentLevel": "Current output level", "channel.mainVolume": "Master volume",
    "settings.onlineStableMode": "Online Music Stable Mode", "settings.onlineStableModeHint": "YouTube and NetEase always use Web Direct without VST, Native output, or fades; local Native/VST settings remain unchanged",
    "settings.youtubeProcessLoopback": "Process Loopback Backend · Experimental", "settings.youtubeProcessLoopbackHint": "Use Windows process loopback for the next YouTube VST session; off by default and falls back once to Direct on failure",
    "settings.youtubeVstLab": "Laboratory Mode · YouTube VST", "settings.youtubeVstLabHint": "Allow the unified VST switch to route the current YouTube session through the plugin chain; YouTube Direct remains the default", "settings.knownLimit": "Known Limitation", "settings.youtubeVstLimit": "Audio may stutter or crackle when the window is fully covered by fullscreen content. Minimizing or using the tray automatically exits YouTube VST, and it does not restart automatically after restore.", "settings.youtubeVstConfirm": "YouTube VST is experimental and is recommended only while ASTRELIS remains in the foreground.\n\nAudio may still stutter or crackle when fully covered by fullscreen content. Minimizing or entering the tray automatically exits VST and returns to YouTube Direct; after restoring the window, VST must be enabled manually.\n\nEnable laboratory mode?",
    "vst.modeNotice": "VST Mode Notice", "vst.onlineWebDirect": "Online music always uses Web Direct; local music can still use VST and Native output", "vst.labLockedDetail": "YouTube is using Direct; enable Laboratory Mode in Settings first", "vst.youtubeDisableDetail": "End this YouTube VST session and return to YouTube Direct", "vst.youtubeEnableDetail": "Enable experimental VST for this YouTube session; it exits automatically when minimized or sent to the tray", "vst.labRequiredNotice": "YouTube remains in Direct mode. Confirm and enable Laboratory Mode · YouTube VST in Settings first.", "vst.youtubeDisabledNotice": "YouTube VST is off and playback has returned to YouTube Direct.", "vst.backgroundFallbackNotice": "The window was minimized or sent to the tray. YouTube VST exited automatically and returned to Direct. Re-enable VST manually after restoring the window.", "vst.labDisabledNotice": "Laboratory Mode was disabled. YouTube VST exited and returned to Direct.", "vst.youtubeDirectNativeDisabledNotice": "YouTube Direct started with VST and Native output off; only Laboratory mode allows both at the same time.", "vst.localPlayback": "Local Playback", "vst.processingOn": "VST plugin processing is on", "vst.processingOff": "VST plugin processing is off",
    "vst.healthFallbackNotice": "A stalled background audio clock or discontinuous output was detected. YouTube VST faded out and returned to Direct.",
    "drop.releaseImport": "Release to Import Files", "drop.addToQueue": "Files will be added to the current play queue",
    "module.browse": "Browse and filter", "online.back": "Back", "online.forward": "Forward", "online.home": "YouTube Music Home", "online.initializing": "Initializing secure browser…"
  },
  "ja-JP": {
    "library.manageFolders": "フォルダー管理", "library.addFolder": "フォルダーを追加",
    "library.removeFolder": "除外", "library.removeConfirm": "このフォルダーをライブラリから除外しますか？",
    "library.confirmRemove": "除外する", "library.cancelRemove": "キャンセル",
    "library.removeHint": "ライブラリの記録のみ削除します。ディスク上のファイルと再生キューは保持されます。",
    "library.stats.tracks": "楽曲",
    "library.stats.artists": "アーティスト",
    "library.stats.albums": "アルバム",
    "library.stats.hifi": "Hi-Fi音源",
    "library.stats.size": "合計容量",
    ...systemSettingsMessages["ja-JP"],
    ...directOutputMessages["ja-JP"],
    ...currentFeatureMessages["ja-JP"],
    ...videoMessages["ja-JP"],
    ...mediaLibraryMessages["ja-JP"],
    ...playbackNoticeMessages["ja-JP"],
    "playback.failed": "「{name}」を再生できません：ファイルが破損しているか、形式に対応していません", "playback.failedSkipped": "「{name}」を再生できません（ファイルの破損または非対応の形式）。次の曲へスキップしました", "playback.startFailed": "再生を開始できません",
    "appearance.group.theme": "テーマと背景",
    "appearance.group.glass": "ガラスと光",
    "appearance.group.music": "音楽への反応",
    "appearance.group.motion": "アニメーションと性能",
    "appearance.group.performance": "性能オプション",
    "fx.response": "揺れの深さ",
    "fx.title": "ビジュアル演出",
    "fx.description": "音楽に反応する反射、ディスクの光、質感を調整します。",
    "fx.light": "光",
    "fx.surface": "質感",
    "fx.disc": "ディスク",
    "fx.motion": "動き",
    "fx.coverColors": "アートワークの色",
    "fx.coverColorsHint": "画像から色を抽出。取得できない場合はテーマ色を使います",
    "fx.glassEdges": "音楽に反応する反射",
    "fx.glassEdgesHint": "ポインターが光源です。明るさは曲の強弱とビートに合わせて揺れ、一時停止で穏やかに落ち着きます",
    "fx.orbitParticles": "軌道の粒子",
    "fx.orbitParticlesHint": "唱盤の周囲を少数の光点がゆっくり回ります",
    "fx.trackTransition": "曲切替時のフェード",
    "fx.trackTransitionHint": "曲の変更時に画像、文字、背景色を柔らかく切り替えます",
    "fx.intensity": "装飾光の強さ",
    "fx.eco": "低負荷モードでは演出を停止します。設定は保存されます。",
    "fx.motionHint": "アニメーション無効時や動きを減らす設定では静的な色と質感を保持し、非表示時は動きを停止します。",
    "layout.showMeters": "メーターを表示", "layout.hideMeters": "メーターを隠す",
    "timeline.seek": "再生位置", "timeline.help": "矢印キーで5秒、Shift＋矢印で30秒移動。Home / Endで先頭・末尾へ。",
    "nav.nowPlaying": "再生中", "nav.playlist": "再生リスト", "nav.library": "ライブラリ", "nav.online": "オンライン",
    "nav.devices": "音声出力", "nav.plugins": "プラグイン", "nav.appearance": "外観", "nav.settings": "設定",
    "mode.spectrum": "バースペクトラム", "mode.mirror": "ミラースペクトラム", "mode.waveform": "銀河スパイラル",
    "mode.radial": "円形スペクトラム", "mode.particles": "星空リズム", "mode.pulse": "ブラックホールパルス",
    "page.playlist": "プレイリスト", "page.library": "ライブラリ", "page.online": "オンライン音楽", "page.devices": "オーディオデバイス",
    "page.plugins": "プラグイン管理", "page.appearance": "外観設定", "page.settings": "システム設定",
    "settings.language": "表示言語", "settings.languageHint": "アストレリスの表示言語を切り替えます", "language.system": "システム設定に従う",
    "language.zh": "简体中文", "language.en": "English", "language.ja": "日本語", "common.addMusic": "音楽を追加",
    "common.tracks": "曲", "common.track": "曲名", "common.format": "形式", "common.size": "サイズ",
    "common.selectAudio": "オーディオファイルを選択", "common.emptyPlaylist": "プレイリストに曲がありません", "common.defaultOutput": "システム既定の出力",
    "common.back": "戻る", "common.refresh": "更新", "common.close": "閉じる", "common.enable": "有効", "common.disable": "無効",
    "common.open": "開く", "common.current": "現在", "common.muted": "ミュート", "common.mute": "ミュート", "common.unmute": "ミュート解除", "common.bypass": "バイパス", "common.remove": "削除", "common.moveUp": "上へ", "common.moveDown": "下へ",
    "common.minimize": "最小化", "common.maximize": "最大化", "common.restore": "元に戻す", "common.play": "再生", "common.pause": "一時停止", "common.stop": "停止", "common.previous": "前の曲", "common.next": "次の曲", "common.shuffle": "シャッフル", "common.repeat": "リピートモード", "common.importFiles": "読込", "common.importAudio": "音楽を追加", "common.waitingAudio": "音楽の読み込み待ち", "common.dropOrLibrary": "ファイルをドロップするかライブラリから追加", "common.operationFailed": "操作を完了できませんでした", "common.compactMode": "コンパクトフローティングモード", "common.exitCompactMode": "コンパクトモードを終了",
    "device.detecting": "検出中", "device.engineReady": "エンジン準備完了", "device.offline": "オフライン", "device.reportedRates": "報告されたサンプルレート", "device.bufferRange": "バッファ範囲", "device.unknown": "不明",
    "device.outputMode": "出力モード", "device.modeSharedHint": "通常利用に推奨。ほかのアプリとデバイスを共有し、VST を使用できます。異なるレートは共有エンジンで変換します。", "device.modeLowLatencyHint": "VST を使用したまま出力遅延を抑えます。重いプラグインチェーンで音切れする場合はバッファを大きくしてください。", "device.modeExclusiveHint": "VST を使用したままデバイスを排他利用し、音源のサンプルレートに合わせることができます。他のアプリが無音になり、音源切替時に短い再接続が発生する場合があります。", "device.outputDevice": "出力デバイス", "device.inUse": "使用中", "device.default": "既定",
    "device.guideTitle": "出力状態と使い方", "device.guideIntro": "普段の音楽再生には WASAPI Shared、サンプルレートは System、バッファは Auto がおすすめです。問題なく再生できれば変更は不要です。図はネイティブ出力を有効にしたときのローカル音楽の流れです。", "device.signalPath": "再生の流れと設定のヒント", "device.signalSource": "音楽ファイル", "device.whenEnabled": "有効な場合のみ", "device.signalNative": "ネイティブ出力", "device.signalDevice": "ヘッドホン / スピーカー",
    "device.guideNativeTitle": "どのモードを選べばよい？", "device.guideNativeBody": "WASAPI Shared は普段の再生に適し、他のアプリの音も同時に聞けます。Shared Low Latency は反応を速くしたい場合に使い、音切れが出たら Shared に戻してください。WASAPI Exclusive は選択した機器を独占するため、他のアプリで使えなくなることがあります。ネイティブ出力は音を機器へ送る機能で、音色を自動で良くするものではありません。", "device.guideVstTitle": "VST とは？有効にする必要は？", "device.guideVstBody": "VST は低音や高音を調整するイコライザーなどの音響効果です。普通に聴く場合は不要です。使うときはネイティブ出力をオンにし、「プラグイン」で追加して処理を有効にします。3つのモードすべてで利用でき、処理をオフにすると効果を通らず再生します。", "device.guideRateTitle": "サンプルレートは変更すべき？", "device.guideRateBody": "通常は System のまま Windows や機器に任せてください。数値を上げても元の曲の音が良くなるわけではありません。Follow Source は曲に合わせます。排他モードでは機器の再接続で曲間に短い間が生じることがあり、共有モードでは機器の現在の値に変換します。必要がなければ固定値の指定は不要です。", "device.guideBufferTitle": "ノイズや音切れが出るときは？", "device.guideBufferBody": "バッファは先に用意しておく短い音のデータです。通常は Auto のままで構いません。ノイズや音切れが出る場合は大きくするか、同時に使うプラグインを減らしてください。小さいと反応が速い分、パソコンへの負荷が高くなり、大きいと安定しやすい分、反応が少し遅くなります。音質の優劣を決める設定ではありません。",
    "device.sampleRate": "サンプルレート", "device.rateSystem": "デバイスまたはシステムが決定", "device.rateFollowSource": "Exclusive は再接続 / Shared はリサンプル", "device.buffer": "バッファ", "device.deviceDefault": "デバイス既定", "device.exclusiveFallback": "排他モード失敗時", "device.fallbackLowLatency": "Shared Low Latency に切替", "device.fallbackShared": "Shared に切替", "device.fallbackRestore": "自動切替せず以前のルートを復元", "device.applying": "検証して切替中…", "device.switching": "切替中…", "device.nativeDeviceHint": "ネイティブ出力・VST・ローカル音楽はこのデバイスを使います。NetEase と YouTube はネイティブ出力オフ時に選んだデバイスを使います。", "device.nativeOn": "オン", "device.nativeOff": "オフ · Web 出力", "device.nativeHdmi": "HDMI ダイレクト", "device.applyConfiguration": "出力設定を適用", "device.webFallbackHint": "NetEase Cloud Music、YouTube、ネイティブ出力がオフのローカル再生に共通で使用します。選択後すぐに反映されます。", "device.signalFade": "フェード（設定時）", "device.signalEffects": "音響効果（VST）",
    "device.engineUnavailable": "ネイティブ出力エンジンを利用できません", "device.enumerateFailed": "ネイティブ出力デバイスを列挙できません", "device.statusFailed": "ネイティブ出力の状態を取得できません", "device.inspectFailed": "ネイティブ出力の検出に失敗しました", "device.capabilitiesFailed": "候補デバイスの能力を取得できません", "device.applyFailed": "候補設定を適用できませんでした", "device.degraded": "候補モードを利用できないためフォールバックで音声を復旧しました", "device.applied": "適用して検証しました", "device.transactionFailed": "ネイティブ出力の切替処理に失敗しました", "device.recoveryPrevious": "切替前のルートを復元しました", "device.recoverySafeShared": "以前のルートを復元できないため Safe Shared を使用しています", "device.recoveryFallback": "設定した方針でフォールバックしました", "device.recoveryFailed": "自動復旧に失敗しました", "device.recoveryUnchanged": "現在のルートは変更されていません", "device.youtubeDirectNativeLocked": "YouTube Direct 再生中はネイティブ出力をオフに保ちます。YouTube VST と同時に有効化できるのはラボモードのみです", "device.youtubeDirectNativeGuide": "「ラボモード · YouTube VST」を開く",
    "appearance.opacity": "透明度と明るさ", "appearance.opacityHint": "ウィンドウ背景レイヤーの透明度を調整します", "appearance.glass": "ウィンドウ全体のガラス素材", "appearance.glassHint": "Windows ネイティブの Mica、Acrylic、透明背景を選択します", "appearance.glow": "グロー強度", "appearance.glowHint": "コントロールとパネル周辺のグローを調整します", "appearance.customAccent": "カスタムカラー",
    "appearance.gpuAcceleration": "GPU グローバルライティング", "appearance.gpuReady": "コンポジター利用可能 · 2D シーンを維持", "appearance.gpuUnavailable": "GPU ライティングを利用できないため純粋な Canvas 2D を使用します", "appearance.gpuOn": "GPU FX ON", "appearance.gpuOff": "PURE 2D", "appearance.gpuEcoOverride": "ECO OVERRIDE",
    "appearance.gpuQuality": "GPU ライティング品質", "appearance.gpuQualityHint": "グローバル Bloom、ソフトライト、環境光の品質を設定します", "appearance.gpuEco": "ECO · 内蔵 GPU / 低消費電力", "appearance.gpuStandard": "標準 · 推奨", "appearance.gpuCosmic": "宇宙級 · 高性能 GPU",
    "appearance.animations": "UI アニメーション", "appearance.animationsHint": "オフにすると装飾アニメーションと切替効果を無効にします", "appearance.transition": "ビジュアライザー切替効果", "appearance.transitionHint": "解析ビュー間の切替スタイルを選択します", "appearance.transitionDissolve": "ソフトディゾルブ · 既定", "appearance.transitionFade": "フェード", "appearance.transitionZoom": "デプスズーム", "appearance.transitionSlide": "水平スライド", "appearance.transitionScan": "スキャン表示", "appearance.lowPerformanceMode": "グローバル低負荷モード", "appearance.lowPerformanceModeHint": "VST、ガラス、背景、グロー、高頻度描画を停止し基本再生を維持します", "appearance.lowPerformanceActive": "ECO ACTIVE", "appearance.lowPerformanceFull": "FULL QUALITY", "vst.lowPerformanceNotice": "グローバル低負荷モードにより VST オーディオ処理は停止中です", "vst.nativeOutputRequiredTitle": "先にネイティブ出力を有効にしてください", "vst.nativeOutputRequiredChannelHint": "VST インサートチェーンにはネイティブ出力が必要です。クリックして連携ガイドを表示します", "vst.nativeOutputRequiredGuideHint": "VST 処理はネイティブ出力経路を使用します。右上のスイッチでネイティブ出力を有効にしてから、プラグインラックまたはチャンネルストリップへ戻ってください。",
    "appearance.customBackground": "カスタムプレーヤー背景", "appearance.chooseBackground": "クリックして画像を選択", "appearance.clearBackgroundConfirm": "現在の背景画像を消去しますか？", "appearance.backgroundSaveFailed": "背景画像を保存できませんでした", "appearance.backgroundDeleteFailed": "背景画像を削除できませんでした",
    "appearance.mica": "Mica · 安定した背景", "appearance.acrylic": "Acrylic · 互換ブラー", "appearance.transparent": "オフ · 透明背景のみ", "appearance.colorMode": "表示モード", "appearance.colorModeHint": "ダーク、ライト、Windows 連動を選択", "appearance.dark": "ダーク · 深宇宙", "appearance.light": "ライト · フロスト", "appearance.system": "Windows に合わせる",
    "settings.alwaysOnTop": "常に手前に表示", "settings.alwaysOnTopHint": "プレーヤーを他のウィンドウより前に保ちます", "settings.windowMemory": "ウィンドウ状態を記憶", "settings.windowMemoryHint": "位置・サイズ・最大化状態を自動保存します",
    "settings.mediaKeys": "Windows メディアキー", "settings.mediaKeysHint": "再生、一時停止、前後の曲、ヘッドセットキーに対応", "settings.performance": "パフォーマンス状態", "settings.performanceHint": "Canvas は画面更新率に追従し、UI メーターは間引いて更新します", "settings.backend": "オーディオバックエンド",
    "library.connected": "音楽宇宙に接続しました", "library.create": "音楽宇宙を構築", "library.scanHint": "フォルダーをスキャンしてタグと分類インデックスを作成します", "library.scan": "フォルダーをスキャン", "library.scanning": "スキャン中…", "library.rescan": "ライブラリを再スキャン",
    "library.folder": "フォルダー", "library.shelf": "グループ", "library.shelfBadge": "{folders} フォルダー · {count} 件", "library.favorites": "お気に入り", "library.artist": "アーティスト", "library.album": "アルバム", "library.search": "曲、アーティスト、アルバムを検索…", "library.root": "音楽ライブラリ", "library.parent": "1つ上へ", "library.overview": "一覧",
    "queue.missing": "ファイルなし", "queue.missingHint": "ファイルが見つかりません。移動または削除された可能性があります。フォルダーを再スキャンしてから、メディアセンターで追加し直してください。", "library.addLayer": "この階層を追加", "library.addArtist": "アーティストの全曲をキューに追加", "library.addAlbum": "アルバム全曲をキューに追加", "library.inQueue": "キューに追加済み", "library.addQueue": "キューに追加", "library.favorite": "お気に入りに追加", "library.unfavorite": "お気に入りから削除", "library.removeTrack": "プレイリストから削除", "library.selectTrack": "曲を選択", "library.selectAll": "すべて選択", "library.selectedCount": "{count}曲を選択", "library.addSelected": "プレイリストに追加", "library.noFavorites": "お気に入りのローカル曲はまだありません", "library.noFavoritesHint": "ライブラリまたはプレイリストのハートボタンで追加できます", "library.noMatch": "一致する曲がありません", "library.awaiting": "スキャン待ち", "library.tryFilter": "検索語または分類を変更してください", "library.awaitingHint": "音楽フォルダーを選択してください。APE / DSF / FLAC などに対応しています", "library.uncategorized": "未分類",
    "library.scanDiscovering": "オーディオファイルを検索中", "library.scanIndexing": "ライブラリ索引を作成中", "library.scanMetadata": "オーディオタグを読み込み中", "library.enumerating": "フォルダーを列挙中", "library.categoryOverview": "カテゴリー一覧", "library.collection": "コレクション", "library.unknownArtist": "不明なアーティスト", "library.clearPlaylist": "プレイリストを消去", "library.scrollMore": "下へスクロールして読み込み", "library.queueUpdated": "プレイリストを更新しました",
    "library.viewFlow": "カバーフロー", "library.viewGrid": "グリッド", "library.viewList": "リスト", "library.viewMosaic": "モザイクカバー", "library.previewFullscreen": "全画面プレビュー", "library.previewExit": "プレビューを終了", "library.zoom": "ズーム", "library.media.all": "すべて", "library.media.audio": "音楽", "library.media.video": "動画", "library.viewMode": "ライブラリ表示", "library.viewLarge": "大きいカバー", "library.viewCards": "標準カード", "library.viewDetails": "詳細", "library.sortBy": "並び順", "library.sortTitle": "曲名", "library.sortArtist": "アーティスト", "library.sortAlbum": "アルバム", "library.sortFormat": "形式", "library.sortSize": "ファイルサイズ", "library.sortTrack": "トラック番号", "library.sortAscending": "昇順", "library.sortDescending": "降順", "library.cover": "カバー", "library.item": "項目", "library.info": "主な情報", "library.summary": "補足情報", "library.type": "種類", "library.countSize": "曲数 / サイズ", "library.actions": "操作", "library.open": "開く",
    "visual.title": "リアルタイム解析", "visual.tune": "ビジュアライザー調整", "visual.smoothing": "スムージング", "visual.sensitivity": "感度", "visual.bars": "エフェクト数", "visual.lineWidth": "エフェクトサイズ", "visual.speed": "アニメーション速度", "visual.decay": "減衰速度", "visual.peakHold": "ピーク保持", "visual.flash": "ビートの光", "visual.glints": "光芒の数", "visual.accentShare": "星空のテーマ色の割合", "visual.pointerStrength": "操作の強さ", "visual.pointer": "マウス操作", "visual.pointerHint": "星空：ポインターの方向へ進み、押し続けるとワープ。銀河：ホバーで星を引き寄せ、クリックで密度波。ブラックホール：クリックで物質を落とす。ECO・OBS モードと動きを減らす設定ではオフ", "visual.reset": "すべて初期値に戻す",
    "visual.fftSize": "FFT サイズ", "visual.barOpacity": "エフェクト透明度", "visual.immersive": "没入型ビジュアライザー", "visual.obsTransparent": "OBS 透明出力", "visual.lockClickThrough": "ロックしてクリック透過を有効化", "visual.unlockClickThrough": "クリックして透過を解除", "visual.maximize": "最大化", "visual.restore": "ウィンドウを元に戻す", "visual.exitImmersive": "没入モードを終了", "visual.dragMaxRestore": "ドラッグで移動 · ダブルクリックで最大化/復元",
    "vst.installed": "インストール済みプラグイン", "vst.search": "名前、メーカー、カテゴリ、形式を検索", "vst.none": "互換プラグインが見つかりません", "vst.rack": "Master プラグインラック", "vst.emptyRack": "左のプラグインをダブルクリックしてチェーンを作成", "vst.addFolder": "カスタムフォルダーを追加", "vst.rescan": "再スキャン", "vst.enableProcessing": "ネイティブ処理を有効化", "vst.disableProcessing": "処理を無効化",
    "vst.showUnavailable": "非互換プラグインを表示", "vst.hideUnavailable": "非互換プラグインを非表示", "vst.waitingSession": "スキャンセッション待ち", "vst.locations": "プラグインの場所", "vst.enableDirectory": "このフォルダーを有効化", "vst.disableDirectory": "このフォルダーを無効化", "vst.removeDirectory": "カスタムフォルダーを削除", "vst.retryModule": "このモジュールを再試行", "vst.clearQuarantine": "隔離を解除して再スキャン", "vst.unknownVendor": "不明なメーカー", "vst.uncategorized": "未分類", "vst.discovering": "プラグインファイルを検索中", "vst.readingCache": "スキャンキャッシュを読み込み中", "vst.nativeValidation": "JUCE ネイティブ検証", "vst.diagnosticOnly": "読み込めないプラグインは診断表示のみで、ラックには追加できません", "vst.addHint": "ダブルクリックしてラックに追加", "vst.configOnlyWarning": "現在のラックは設定のみを保存します。ネイティブ処理を有効にするとローカルファイルと NetEase がプラグインチェーンを通ります。この操作で YouTube が VST に入ることはありません。", "vst.openEditor": "プラグインのネイティブ画面を開く", "vst.searchAdd": "プラグインを検索して追加…", "vst.noMatched": "一致する互換プラグインがありません", "vst.scanningDatabase": "プラグインデータベースをスキャン中…", "vst.noEffects": "エフェクト未読込", "vst.openFullRack": "完全なプラグインラックを開く", "vst.insertChain": "エフェクト挿入チェーン",
    "vst.stateNotScanned": "スキャン待ち", "vst.stateReady": "利用可能", "vst.stateMissing": "フォルダーがありません", "vst.stateAccessDenied": "アクセス拒否", "vst.stateNoModules": "プラグインモジュールなし", "vst.stateNoPlugins": "互換プラグインなし", "vst.stateScannerError": "スキャナーエラー",
    "vst.skip": "スキップ", "vst.disable": "無効化", "vst.skipCurrent": "検証中のプラグインをスキップ", "vst.disableCurrent": "このプラグインを無効化し、今後のスキャンでスキップ", "vst.enableModule": "有効化して再スキャン",
    "queue.title": "再生キュー", "queue.empty": "音楽を読み込むと曲がここに表示されます", "queue.remove": "キューから削除",
    "meter.channelMonitor": "チャンネルモニター", "meter.signalEnergy": "信号エネルギー", "meter.live": "ライブ", "meter.low": "低域", "meter.mid": "中域", "meter.high": "高域", "meter.peak": "ピーク", "meter.rms": "平均レベル", "meter.streamData": "ストリーム情報", "meter.format": "形式", "meter.sampleRate": "サンプルレート", "meter.bitDepth": "ビット深度", "meter.unavailable": "利用不可", "meter.output": "出力",
    "channel.title": "音量・エフェクトチャンネルストリップ", "channel.masterOutput": "マスター出力", "channel.rescan": "プラグインを再スキャン", "channel.openPlugin": "プラグイン画面を開く", "channel.removePlugin": "プラグインを削除", "channel.currentLevel": "現在の出力レベル", "channel.mainVolume": "マスター音量",
    "settings.onlineStableMode": "オンライン音楽安定モード", "settings.onlineStableModeHint": "YouTube と NetEase は VST、ネイティブ出力、フェードを経由せず常に Web Direct を使用し、ローカルの Native/VST 設定は維持されます",
    "settings.youtubeProcessLoopback": "プロセスループバック · 実験", "settings.youtubeProcessLoopbackHint": "次回の YouTube VST セッションで Windows プロセスループバックを使用します。既定はオフで、異常時は一度だけ Direct に戻ります",
    "settings.youtubeVstLab": "ラボモード · YouTube VST", "settings.youtubeVstLabHint": "統合 VST スイッチで現在の YouTube セッションをプラグインチェーンへ接続します。既定は YouTube Direct のままです", "settings.knownLimit": "既知の制限", "settings.youtubeVstLimit": "全画面コンテンツに完全に隠れると音切れやノイズが発生する場合があります。最小化またはトレイ移動時は YouTube VST を自動終了し、復元後も自動再開しません。", "settings.youtubeVstConfirm": "YouTube VST は実験機能で、アストレリスが前面にある場合のみ推奨されます。\n\n全画面コンテンツに完全に隠れると音切れやノイズが発生する場合があります。最小化またはトレイ移動時は VST を終了して YouTube Direct に戻り、復元後は手動で再度有効にする必要があります。\n\nラボモードを有効にしますか？",
    "vst.modeNotice": "VST モード通知", "vst.onlineWebDirect": "オンライン音楽は常に Web Direct を使用し、ローカル音楽では VST とネイティブ出力を引き続き利用できます", "vst.labLockedDetail": "YouTube は Direct を使用中です。先に設定でラボモードを有効にしてください", "vst.youtubeDisableDetail": "この YouTube VST セッションを終了して YouTube Direct に戻す", "vst.youtubeEnableDetail": "この YouTube セッションで実験 VST を有効化します。最小化またはトレイ移動時は自動終了します", "vst.labRequiredNotice": "YouTube は Direct のままです。設定で「ラボモード · YouTube VST」を確認して有効にしてください。", "vst.youtubeDisabledNotice": "YouTube VST を終了し、YouTube Direct に戻しました。", "vst.backgroundFallbackNotice": "最小化またはトレイ移動を検出したため、YouTube VST を自動終了して Direct に戻しました。復元後に VST を手動で有効にしてください。", "vst.labDisabledNotice": "ラボモードが無効になったため、YouTube VST を終了して Direct に戻しました。", "vst.youtubeDirectNativeDisabledNotice": "YouTube Direct は VST とネイティブ出力をオフにして開始します。同時に有効化できるのはラボモードのみです。", "vst.localPlayback": "ローカル再生", "vst.processingOn": "VST プラグイン処理は有効です", "vst.processingOff": "VST プラグイン処理は無効です",
    "vst.healthFallbackNotice": "バックグラウンドのオーディオクロック停滞または出力の不連続を検出したため、短くフェードアウトして YouTube Direct に戻しました。",
    "drop.releaseImport": "ドロップしてファイルを読み込む", "drop.addToQueue": "ファイルを現在の再生キューに追加します",
    "module.browse": "表示と絞り込み", "online.back": "戻る", "online.forward": "進む", "online.home": "YouTube Music ホーム", "online.initializing": "安全なブラウザーを初期化中…"
  }
} as const;

const normalizeLanguage = (value: unknown): Language =>
  value === "zh-CN" || value === "en-US" || value === "ja-JP" ? value : "system";
let selected = normalizeLanguage(localStorage.getItem("auralis.ui.language"));
const listeners = new Set<() => void>();
const resolve = (): ResolvedLanguage => {
  if (selected !== "system") return selected;
  const locale = navigator.language.toLowerCase();
  return locale.startsWith("ja") ? "ja-JP" : locale.startsWith("zh") ? "zh-CN" : "en-US";
};
export const applicationName = (language: string) => language === "zh-CN" ? "星律" : language === "ja-JP" ? "アストレリス" : "ASTRELIS";
const syncLanguage = () => {
  document.documentElement.lang = resolve();
  document.title = applicationName(resolve());
  window.desktop?.setDisplayLanguage(resolve());
};
export const getLanguage = () => selected;
export const setLanguage = (language: Language) => {
  selected = normalizeLanguage(language);
  localStorage.setItem("auralis.ui.language", selected);
  syncLanguage();
  listeners.forEach(listener => listener());
};
export const translate = (key: string, values: Record<string, string | number> = {}) => {
  const text = messages[resolve()][key] || messages["zh-CN"][key] || key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
};
// IPC errors retain stable source text; translate known messages only at display time.
const sourceMessageKeys = new Map(Object.entries(messages["zh-CN"]).map(([key, value]) => [value, key]));
/** A known source text, or one with its first number as {count} ("3 个…"); undefined otherwise. */
const translateSourceText = (message: string) => {
  const key = sourceMessageKeys.get(message);
  if (key) return translate(key);
  const count = /\d+/.exec(message);
  const counted = count ? sourceMessageKeys.get(message.replace(/\d+/, "{count}")) : undefined;
  return counted ? translate(counted, { count: count![0] }) : undefined;
};
// Several source texts in one message are joined by a full-width semicolon.
const SOURCE_TEXT_SEPARATOR = "；";
export const translateMessage = (message: string) => {
  const http = /^TMDB 请求失败（(\d+)）$/.exec(message);
  if (http) return translate("media.httpError", { status: http[1] });
  const known = translateSourceText(message);
  if (known !== undefined) return known;
  if (message.includes(SOURCE_TEXT_SEPARATOR)) {
    const parts = message.split(SOURCE_TEXT_SEPARATOR).map(part => translateSourceText(part));
    if (parts.every(part => part !== undefined)) return parts.join(resolve() === "en-US" ? "; " : SOURCE_TEXT_SEPARATOR);
  }
  return translate(message);
};
export function useI18n() {
  useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => `${selected}:${resolve()}`);
  return { t: translate, tm: translateMessage, appName: applicationName(resolve()), language: selected, resolvedLanguage: resolve(), setLanguage };
}
syncLanguage();
window.addEventListener("languagechange", () => { if (selected === "system") { syncLanguage(); listeners.forEach(listener => listener()); } });

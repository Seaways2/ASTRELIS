import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Cloud, Heart, Home, ListMusic, LoaderCircle, LogOut, Pause, Play, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";

import { useI18n } from "../i18n";
import { usePlayerStore } from "../stores/playerStore";
import { browserBoundsAroundOverlay, type OverlayRect } from "../utils/browserOverlayBounds";

const initialState: BrowserState = {
  url: "https://music.youtube.com/",
  title: "YouTube Music",
  loading: true,
  canGoBack: false,
  canGoForward: false
};

// What main answers for an address-bar entry (global.d.ts still types
// navigate() as returning nothing).
type NavigateResult = { ok: boolean; external?: "opened" | "throttled"; error?: string };
type AddressHint = "external" | "throttled" | "invalid";
// Only YouTube and Google sign-in open in the view; main hands other sites
// to the system browser, and the address bar says so for a few seconds.
// Words that are not an address search YouTube Music.
const addressHints: Record<"zh-CN" | "en-US" | "ja-JP", Record<AddressHint, string>> = {
  "zh-CN": {
    external: "该网址已在系统浏览器中打开：这里只显示 YouTube 页面",
    throttled: "打开得太频繁了，请稍后再试",
    invalid: "这不是有效的网址"
  },
  "en-US": {
    external: "Opened in your system browser: this view only shows YouTube pages",
    throttled: "Too many links at once; try again in a moment",
    invalid: "This is not a valid web address"
  },
  "ja-JP": {
    external: "システムのブラウザーで開きました（ここでは YouTube のページのみ表示します）",
    throttled: "短時間に開きすぎています。少し待ってからもう一度お試しください",
    invalid: "有効な Web アドレスではありません"
  }
};
const addressHintText = (language: string, hint: AddressHint) =>
  (addressHints[language as keyof typeof addressHints] ?? addressHints["en-US"])[hint];

type OnlineProvider = "youtube" | "netease";
type NeteaseView = "search" | "playlists" | "playlist";
const rememberedProvider = localStorage.getItem("auralis.online.provider") === "netease" ? "netease" : "youtube";
const onlineUiMemory: {
  provider: OnlineProvider;
  query: string;
  songs: NeteaseSearchItem[];
  playlists: NeteasePlaylistItem[];
  view: NeteaseView;
  selectedPlaylist: NeteasePlaylistItem | null;
  playlistFocus: number;
  scrollTop: number;
} = {
  provider: rememberedProvider,
  query: "",
  songs: [],
  playlists: [],
  view: "search",
  selectedPlaylist: null,
  playlistFocus: 0,
  scrollTop: 0
};

export function OnlineBrowser() {
  const [provider, setProviderState] = useState<OnlineProvider>(onlineUiMemory.provider);
  const setProvider = (next: OnlineProvider) => {
    onlineUiMemory.provider = next;
    localStorage.setItem("auralis.online.provider", next);
    setProviderState(next);
  };
  return <div className="online-browser online-multi workspace-online">
    <div className="online-provider-tabs">
      <button className={provider === "youtube" ? "active" : ""} onClick={() => setProvider("youtube")}><span>YT</span>YouTube Music</button>
      <button className={provider === "netease" ? "active" : ""} onClick={() => setProvider("netease")}><Cloud />网易云音乐 <i>ALPHA</i></button>
    </div>
    {provider === "youtube" ? <YouTubeSurface /> : <NeteaseSurface />}
  </div>;
}

function YouTubeSurface() {
  const { t, resolvedLanguage } = useI18n();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(initialState);
  const [address, setAddress] = useState(initialState.url);
  const [addressHint, setAddressHint] = useState<AddressHint | null>(null);
  useEffect(() => {
    if (!addressHint) return;
    const timer = window.setTimeout(() => setAddressHint(null), 4500);
    return () => window.clearTimeout(timer);
  }, [addressHint]);
  const navigate = async () => {
    const browser = window.desktop?.browser;
    if (!browser || !address.trim()) return;
    setAddressHint(null);
    const result: NavigateResult | undefined = await Promise.resolve(browser.navigate(address)).catch(() => undefined);
    if (!result) return;
    if (!result.ok) { if (result.error === "ONLINE_ADDRESS_INVALID") setAddressHint("invalid"); return; }
    if (!result.external) return;
    // The view stays where it was, so the address bar shows that page again.
    setAddress(state.url);
    setAddressHint(result.external === "opened" ? "external" : "throttled");
  };
  useEffect(() => {
    const surface = surfaceRef.current;
    const browser = window.desktop?.browser;
    if (!surface || !browser) return;
    let overlayBounds: OverlayRect | null = null;
    const bounds = () => {
      const rect = surface.getBoundingClientRect();
      return {
        x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height))
      };
    };
    let frame = 0;
    let secondFrame = 0;
    const updateBounds = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      frame = requestAnimationFrame(() => {
        // A second frame is intentional: CSS grid/media-query layout can settle
        // one frame after BrowserWindow's resize event on mixed-DPI displays.
        secondFrame = requestAnimationFrame(() => {
          const visibleBounds = overlayBounds ? browserBoundsAroundOverlay(bounds(), overlayBounds) : bounds();
          if (visibleBounds) browser.show(visibleBounds);
          else browser.hide();
        });
      });
    };
    const handleNativeOverlay = (event: Event) => {
      const detail = (event as CustomEvent<boolean | { open: boolean; bounds?: OverlayRect }>).detail;
      if (typeof detail === "boolean") {
        overlayBounds = null;
        if (detail) browser.hide();
        else browser.show(bounds());
        return;
      }
      overlayBounds = detail.open && detail.bounds ? detail.bounds : null;
      const visibleBounds = overlayBounds ? browserBoundsAroundOverlay(bounds(), overlayBounds) : bounds();
      if (visibleBounds) browser.show(visibleBounds);
      else browser.hide();
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(surface);
    browser.show(bounds());
    const removeStateListener = browser.onState(next => {
      setState(next);
      if (next.url) setAddress(next.url);
    });
    const removeBoundsSyncListener = browser.onBoundsSync(updateBounds);
    window.addEventListener("resize", updateBounds);
    document.addEventListener("transitionend", updateBounds);
    window.addEventListener("auralis:native-overlay-block", handleNativeOverlay);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      removeStateListener();
      removeBoundsSyncListener();
      window.removeEventListener("resize", updateBounds);
      document.removeEventListener("transitionend", updateBounds);
      window.removeEventListener("auralis:native-overlay-block", handleNativeOverlay);
      browser.hide();
    };
  }, []);


  return <div className="online-provider-content youtube-provider">
    <div className="browser-toolbar">
      <div className="browser-nav">
        <button disabled={!state.canGoBack} onClick={() => window.desktop?.browser.back()} title={t("online.back")}><ArrowLeft /></button>
        <button disabled={!state.canGoForward} onClick={() => window.desktop?.browser.forward()} title={t("online.forward")}><ArrowRight /></button>
        <button onClick={() => window.desktop?.browser.reload()} title={t("common.refresh")}><RefreshCw className={state.loading ? "spinning" : ""} /></button>
        <button onClick={() => window.desktop?.browser.home()} title={t("online.home")}><Home /></button>
      </div>
      <form onSubmit={event => { event.preventDefault(); void navigate(); }}>
        <ShieldCheck /><input aria-label="网址" value={address} onChange={event => setAddress(event.target.value)} />
      </form>
      <span className="loopback-status active" role="status" aria-live="polite">{addressHint ? addressHintText(resolvedLanguage, addressHint) : "YouTube Direct · 音量由 ASTRELIS 控制"}</span>
    </div>
    <div className="browser-surface" ref={surfaceRef}><div><LoaderCircle className="spinning" /><span>{t("online.initializing")}</span></div></div>
  </div>;
}

function NeteaseSurface() {
  const enqueueStreamTrack = usePlayerStore(state => state.enqueueStreamTrack);
  const enqueueStreamTracks = usePlayerStore(state => state.enqueueStreamTracks);
  const currentTrackId = usePlayerStore(state => state.tracks[state.currentIndex]?.id || "");
  const playing = usePlayerStore(state => state.playing);
  const setPlaying = usePlayerStore(state => state.setPlaying);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(onlineUiMemory.query);
  const [songs, setSongs] = useState<NeteaseSearchItem[]>(onlineUiMemory.songs);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [account, setAccount] = useState({ loggedIn: false, userId: 0, nickname: "", avatarUrl: "" });
  const [accountLoading, setAccountLoading] = useState(true);
  const [playlists, setPlaylists] = useState<NeteasePlaylistItem[]>(onlineUiMemory.playlists);
  const [playlistFocus, setPlaylistFocus] = useState(onlineUiMemory.playlistFocus);
  const [view, setView] = useState<NeteaseView>(onlineUiMemory.view);
  const [selectedPlaylist, setSelectedPlaylist] = useState<NeteasePlaylistItem | null>(onlineUiMemory.selectedPlaylist);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 4500);
    return () => window.clearTimeout(timer);
  }, [error]);
  const [qr, setQr] = useState<{ key: string; image: string; url: string } | null>(null);
  const [qrMessage, setQrMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [playlistAdded, setPlaylistAdded] = useState(false);
  const [selectedSongIds, setSelectedSongIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    void window.desktop?.netease.loginStatus().then(status => { setAccount(status); setAccountLoading(false); });
  }, []);

  useEffect(() => {
    Object.assign(onlineUiMemory, { query, songs, playlists, view, selectedPlaylist, playlistFocus });
  }, [query, songs, playlists, view, selectedPlaylist, playlistFocus]);

  useLayoutEffect(() => {
    const element = resultsRef.current;
    if (!element) return;
    element.scrollTop = onlineUiMemory.scrollTop;
  }, [view]);

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const poll = async () => {
      const result = await window.desktop?.netease.checkQr(qr.key);
      if (stopped || !result) return;
      if (!result.ok) { setQrMessage(result.error || "无法检查扫码状态"); return; }
      if (result.code === 800) { setQrMessage("二维码已过期，请重新生成"); return; }
      if (result.code === 802) { setQrMessage("已扫码，请在手机上确认登录"); return; }
      if (result.loggedIn || result.code === 803) {
        setQrMessage("登录成功，正在恢复播放权限…");
        const status = await window.desktop?.netease.loginStatus();
        if (status) setAccount(status.loggedIn ? status : { loggedIn: true, userId: 0, nickname: "网易云用户", avatarUrl: "" });
        setAccountLoading(false);
        window.setTimeout(() => setQr(null), 900);
        return;
      }
      setQrMessage("请使用网易云音乐 App 扫描二维码");
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1800);
    return () => { stopped = true; window.clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one poll loop per QR code; the rest of qr only changes as the poll reports
  }, [qr?.key]);

  const startLogin = async () => {
    if (!window.desktop?.netease) return;
    setLoginLoading(true); setError(""); setQrMessage("正在生成二维码…");
    const result = await window.desktop.netease.createQr();
    setLoginLoading(false);
    if (!result.ok || !result.key) { setError(result.error || "二维码创建失败"); return; }
    setQr({ key: result.key, image: result.qrImage || "", url: result.qrUrl || "" });
    setQrMessage("请使用网易云音乐 App 扫描二维码");
  };
  const logout = async () => {
    if (!window.desktop?.netease) return;
    setLoginLoading(true); setError("");
    const result = await window.desktop.netease.logout();
    setLoginLoading(false);
    if (!result.ok) { setError(result.error || "退出登录失败"); return; }
    setAccount({ loggedIn: false, userId: 0, nickname: "", avatarUrl: "" });
    onlineUiMemory.scrollTop = 0;
    setPlaylists([]); setSongs([]); setSelectedPlaylist(null); setView("search"); setQr(null);
  };

  const search = async () => {
    if (!query.trim() || !window.desktop?.netease) return;
    setLoading(true); setError("");
    const result = await window.desktop.netease.search(query.trim());
    setLoading(false);
    if (!result.ok) { setSongs([]); setError(result.error || "网易云搜索失败"); return; }
    onlineUiMemory.scrollTop = 0;
    setSongs(result.songs);
    setSelectedPlaylist(null); setView("search");
  };
  const loadPlaylists = async () => {
    if (!window.desktop?.netease || !account.loggedIn) { setError("请先扫码登录网易云音乐"); return; }
    setLoading(true); setError("");
    const result = await window.desktop.netease.playlists();
    setLoading(false);
    if (!result.ok) { setError(result.error || "歌单加载失败"); return; }
    onlineUiMemory.scrollTop = 0;
    setPlaylists(result.playlists); setPlaylistFocus(0); setView("playlists"); setSelectedPlaylist(null);
  };
  const openPlaylist = async (playlist: NeteasePlaylistItem) => {
    if (!window.desktop?.netease) return;
    setLoading(true); setError(""); setSelectedPlaylist(playlist);
    const result = await window.desktop.netease.playlistTracks(playlist.id);
    setLoading(false);
    if (!result.ok) { setError(result.error || "歌单曲目加载失败"); return; }
    onlineUiMemory.scrollTop = 0;
    setSongs(result.songs); setSelectedSongIds(new Set()); setPlaylistAdded(false); setView("playlist");
  };
  const toggleSongSelection = (id: number) => {
    setPlaylistAdded(false);
    setSelectedSongIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setPlaylistAdded(false);
    setSelectedSongIds(current => current.size === songs.length ? new Set() : new Set(songs.map(song => song.id)));
  };
  const addSelectedSongs = () => {
    const selected = songs.filter(item => selectedSongIds.has(item.id));
    if (!selected.length) return;
    enqueueStreamTracks(selected.map(item => ({
      id: `netease-${item.id}`,
      name: item.name,
      artist: item.artist,
      album: item.album,
      coverUrl: item.coverUrl || undefined,
      duration: item.duration,
      url: `auralis-netease://stream/${item.id}`,
      format: "NETEASE",
      size: 0
    })));
    setPlaylistAdded(true);
  };
  const addSong = async (song: NeteaseSearchItem, playNow: boolean) => {
    if (!window.desktop?.netease) return;
    if (playNow && currentTrackId === `netease-${song.id}`) {
      setPlaying(!playing);
      return;
    }
    setBusyId(song.id); setError("");
    const prepared = await window.desktop.netease.prepare(song.id);
    if (!prepared.ok || !prepared.url) {
      setError(`${song.name}：${prepared.error || "当前无法播放"}`);
      setBusyId(null);
      return;
    }
    await enqueueStreamTrack({
      id: `netease-${song.id}`,
      name: song.name,
      artist: song.artist,
      album: song.album,
      coverUrl: song.coverUrl || undefined,
      duration: song.duration,
      url: prepared.url,
      format: "NETEASE",
      size: 0
    }, playNow);
    setBusyId(null);
  };

  useEffect(() => {
    if (account.loggedIn && !playlists.length) void loadPlaylists();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads playlists once after logging in, not again whenever the list changes
  }, [account.loggedIn]);

  if (accountLoading) return <div className="online-provider-content netease-provider netease-login-gate"><LoaderCircle className="spinning" /><b>正在恢复网易云登录状态</b></div>;
  if (!account.loggedIn) return <div className="online-provider-content netease-provider netease-login-gate">
    {!qr ? <div className="netease-login-entry">
      <div className="netease-login-mark"><Cloud /></div>
      <span>NETEASE CLOUD MUSIC</span>
      <h2>登录网易云音乐</h2>
      <p>同步“我喜欢的音乐”和个人歌单，并由星律接管播放与可视化。</p>
      <button disabled={loginLoading} onClick={() => void startLogin()}>{loginLoading ? <LoaderCircle className="spinning" /> : <Cloud />}{loginLoading ? "正在连接…" : "扫码登录网易云音乐"}</button>
      {error && <div className="netease-error"><span>{error}</span><button title="关闭提示" onClick={() => setError("")}>×</button></div>}
    </div> : <div className="netease-login-qr">
      <button className="netease-qr-close" onClick={() => setQr(null)}>×</button>
      <div className="netease-qr-image">{qr.image ? <img src={qr.image} alt="网易云登录二维码" /> : <a href={qr.url}>打开登录二维码</a>}</div>
      <span>NETEASE SECURE LOGIN</span><h2>使用网易云音乐扫码</h2><p>{qrMessage}</p><small>请在手机端确认登录。星律不会获取你的账号密码。</small>
    </div>}
  </div>;

  return <div className="online-provider-content netease-provider">
    <form className="netease-search" onSubmit={event => { event.preventDefault(); void search(); }}>
      <Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索网易云歌曲、歌手或专辑" />
      <button type="submit" disabled={loading || !query.trim()}>{loading ? <LoaderCircle className="spinning" /> : "搜索"}</button>
    </form>
    <div className="netease-status"><span><i /> LOCAL API PORT</span><b>播放、进度与可视化由星律接管</b></div>
    {view !== "playlist" && <div className="netease-user-toolbar">
      {account.avatarUrl && <img src={account.avatarUrl} alt="" />}
      <b>{account.nickname || "已登录网易云"}</b>
      <button onClick={() => void loadPlaylists()}><ListMusic />我的歌单</button>
      <button disabled={loginLoading} onClick={() => void logout()}>{loginLoading ? <LoaderCircle className="spinning" /> : <LogOut />}{loginLoading ? "正在退出" : "退出登录"}</button>
    </div>}
    {qr && <div className="netease-qr-panel">
      <button className="netease-qr-close" onClick={() => setQr(null)}>×</button>
      <div className="netease-qr-image">{qr.image ? <img src={qr.image} alt="网易云登录二维码" /> : <a href={qr.url}>打开登录二维码</a>}</div>
      <div><b>网易云音乐扫码登录</b><span>{qrMessage}</span><small>二维码只用于获取网易云会话，星律不接触账号密码。</small></div>
    </div>}
    {error && <div className="netease-error"><span>{error}</span><button title="关闭提示" onClick={() => setError("")}>×</button></div>}
    <div className="netease-results" ref={resultsRef} onScroll={event => { onlineUiMemory.scrollTop = event.currentTarget.scrollTop; }}>
      {view === "playlists" && playlists.length > 0 && <div className="netease-playlist-browser">
        <div className="netease-playlist-stage">
          {playlists.map((playlist, index) => {
            const offset = index - playlistFocus;
            if (Math.abs(offset) > 3) return null;
            const distance = Math.abs(offset);
            return <button className={`${offset === 0 ? "focused" : ""} ${playlist.liked ? "liked" : ""}`} style={{ "--playlist-offset": offset, "--playlist-scale": distance === 0 ? 1 : .66, "--playlist-opacity": Math.max(.28, 1 - distance * .24), "--playlist-brightness": distance === 0 ? 1 : .55 } as React.CSSProperties} key={playlist.id} onClick={() => offset === 0 ? void openPlaylist(playlist) : setPlaylistFocus(index)}>
              <div>{playlist.coverUrl ? <img src={playlist.coverUrl} alt="" /> : playlist.liked ? <Heart /> : <ListMusic />}</div>
              {playlist.liked && <em>我喜欢的音乐</em>}
            </button>;
          })}
        </div>
        <div className="netease-playlist-caption"><h2>{playlists[playlistFocus]?.name}</h2><span>{playlists[playlistFocus]?.trackCount || 0} 首歌曲 · {account.nickname}</span></div>
        <div className="netease-carousel-controls"><button disabled={playlistFocus <= 0} onClick={() => setPlaylistFocus(value => Math.max(0, value - 1))}>‹</button><span>{playlistFocus + 1} / {playlists.length}</span><button disabled={playlistFocus >= playlists.length - 1} onClick={() => setPlaylistFocus(value => Math.min(playlists.length - 1, value + 1))}>›</button></div>
      </div>}
      {view === "playlist" && selectedPlaylist && <div className="netease-playlist-toolbar">
        <button className="netease-home-button" onClick={() => setView("playlists")}><Home />返回首页</button>
        <div><b>{selectedPlaylist.name}</b><span>{songs.length} 首曲目 · 已选择 {selectedSongIds.size} 首</span></div>
        <div className="netease-selection-actions">
          <button onClick={toggleSelectAll}><Check />{selectedSongIds.size === songs.length && songs.length ? "取消全选" : "全选"}</button>
          <button className={playlistAdded ? "added" : ""} disabled={!selectedSongIds.size} onClick={addSelectedSongs}>{playlistAdded ? <Check /> : <ListMusic />}{playlistAdded ? "已加入" : "加入播放列表"}</button>
        </div>
      </div>}
      {view !== "playlists" && songs.map((song, index) => {
        const active = currentTrackId === `netease-${song.id}`;
        return <article className={`${active ? "active" : ""} ${view === "playlist" ? "selectable" : ""}`} key={song.id}>
        {view === "playlist" && <label className="netease-song-check" title="选择曲目"><input type="checkbox" checked={selectedSongIds.has(song.id)} onChange={() => toggleSongSelection(song.id)} /><span /></label>}
        <span className="netease-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="netease-cover">{song.coverUrl ? <img src={song.coverUrl} alt="" /> : <Cloud />}</div>
        <div className="netease-song"><b>{song.name}</b><span>{song.artist}</span><small>{active ? playing ? "正在播放 · " : "已暂停 · " : ""}{song.album}</small></div>
        <time>{formatDuration(song.duration)}</time>
        <button disabled={busyId === song.id} title="加入播放列表" onClick={() => void addSong(song, false)}><Plus /></button>
        {view !== "playlist" && <button className="netease-play" disabled={busyId === song.id} title={active && playing ? "暂停" : "立即播放"} onClick={() => void addSong(song, true)}>{busyId === song.id ? <LoaderCircle className="spinning" /> : active && playing ? <Pause /> : <Play />}</button>}
      </article>;})}
      {!loading && view !== "playlists" && !songs.length && !error && <div className="netease-empty"><Cloud /><b>网易云端口已就绪</b><span>输入歌曲或歌手名称开始搜索</span></div>}
    </div>
  </div>;
}

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

// Shared by display and seeking: stream duration can be only the appended
// portion of a gapless media timeline, rather than the complete song.
const songDurationScript = `(() => {
  const data = typeof player.getVideoData === 'function' ? player.getVideoData() : {};
  try {
    const response = typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null;
    const details = response && response.videoDetails;
    const full = Number(details && details.lengthSeconds);
    if (data.video_id && details && details.videoId === data.video_id && Number.isFinite(full) && full > 0) return full;
  } catch {}
  const label = document.querySelector('ytmusic-player-bar .time-info');
  const text = label && label.textContent || '';
  const match = text.match(/[/／]\\s*((?:\\d+:)?\\d+:\\d{2})/);
  if (match) {
    const full = match[1].split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    if (Number.isFinite(full) && full > 0) return full;
  }
  return 0; // Unknown is preferable to displaying a partial stream length.
})()`;

export function onlinePlayerTimelineScript(): string {
  return `(() => {
    if (window.__auralisPlayerTimelineInstalled) return;
    window.__auralisPlayerTimelineInstalled = true;
    const report = (mediaEvent = 'poll') => {
      // Only applies a changed user request; repeated polling is a no-op.
      window.__astrelisFlushVolume?.();
      const player = document.getElementById('movie_player');
      if (!player || typeof player.getCurrentTime !== 'function' || typeof player.getDuration !== 'function') return;
      const position = Number(player.getCurrentTime());
      const duration = ${songDurationScript};
      if (!Number.isFinite(position) || !Number.isFinite(duration)) return;
      const elements = Array.from(document.querySelectorAll('video, audio'));
      const media = document.querySelector('video.video-stream.html5-main-video') || elements[0];
      const meta = navigator.mediaSession && navigator.mediaSession.metadata;
      const data = typeof player.getVideoData === 'function' ? player.getVideoData() : {};
      window.postMessage({ __auralisPlayerTimeline: true, state: {
        trackId: data.video_id || '',
        title: meta && meta.title || data.title || '',
        artist: meta && meta.artist || data.author || '',
        album: meta && meta.album || 'YouTube Music',
        artwork: meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : '',
        currentTime: Math.max(0, position), duration: Math.max(0, duration),
        playing: media ? !media.paused && !media.ended : false,
        readyState: media ? media.readyState : 0,
        mediaIndex: elements.indexOf(media), mediaCount: elements.length,
        rawPosition: media ? media.currentTime : 0,
        mediaEvent, timelineSource: 'youtube-player'
      } }, location.origin);
    };
    for (const event of ['play', 'playing', 'pause', 'ended', 'loadedmetadata', 'seeking', 'seeked', 'waiting', 'stalled', 'emptied']) {
      document.addEventListener(event, () => queueMicrotask(() => report(event)), true);
    }
    setInterval(report, 350);
    report('initial');
  })()`;
}

export function onlinePlayerSeekScript(position: number): string {
  const target = Number.isFinite(position) ? position : 0;
  return `const player = document.getElementById('movie_player');
    if (player && typeof player.seekTo === 'function' && typeof player.getDuration === 'function') {
      const duration = ${songDurationScript};
      if (!Number.isFinite(duration) || duration <= 0) return { ok: false, error: '当前曲目不能定位' };
      player.seekTo(Math.max(0, Math.min(duration, ${target})), true);
      return { ok: true };
    }
    return { ok: false, error: 'YouTube 播放器定位接口尚未就绪，请稍后重试' };`;
}

// One application per user request/player instance. No volumechange listener
// and no raw media.volume writes that fight YouTube's internal normalization.
export function onlineVolumeScript(volume: number, muted: boolean): string {
  const value = Math.max(0, Math.min(1, Number(volume) || 0)) * 100;
  return `(() => {
    window.__astrelisVolumeRequest = { value: ${value}, muted: ${Boolean(muted)} };
    if (!window.__astrelisFlushVolume) {
      let appliedPlayer, appliedKey;
      window.__astrelisFlushVolume = () => {
        const request = window.__astrelisVolumeRequest;
        const player = document.getElementById('movie_player');
        if (!request || !player || typeof player.setVolume !== 'function'
          || typeof player.mute !== 'function' || typeof player.unMute !== 'function') return;
        const key = request.value + ':' + request.muted;
        if (appliedPlayer === player && appliedKey === key) return;
        player.setVolume(request.value);
        if (request.muted) player.mute(); else player.unMute();
        appliedPlayer = player; appliedKey = key;
      };
    }
    window.__astrelisFlushVolume();
  })()`;
}

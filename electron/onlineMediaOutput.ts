// No polling: only initialization, explicit requests and media element events.
export function onlineOutputSetupScript(deviceId: string, explicit = false): string {
  return `(async () => {
    const previous = window.__auralisOutputTarget || 'default';
    window.__auralisOutputTarget = ${JSON.stringify(deviceId)};
    if (!window.__auralisApplyOutput) {
      const attempts = new WeakMap();
      window.__auralisApplyOutput = (media, force = false) => {
        const target = window.__auralisOutputTarget;
        const primary = document.querySelector('video.video-stream.html5-main-video');
        if (primary && media !== primary) return Promise.resolve({ok:true});
        if (!media || typeof media.setSinkId !== 'function') return Promise.resolve({ok:false,error:'网页暂不支持输出设备切换'});
        const old = attempts.get(media);
        if (!force && old && old.target === target) return old.promise;
        const promise = (async () => {
          if (old) await old.promise;
          try {
            if (media.sinkId !== target && !(target === 'default' && media.sinkId === '')) await media.setSinkId(target);
            const result = {ok:true, deviceId:target};
            window.__auralisOutputStatus = result;
            return result;
          } catch (error) {
            const result = {ok:false,error:String(error && error.message || error)};
            window.__auralisOutputStatus = result;
            return result;
          }
        })();
        attempts.set(media, {target,promise});
        return promise;
      };
      new MutationObserver(() => {
        const media = document.querySelector('video.video-stream.html5-main-video') || document.querySelector('video, audio');
        if (media) void window.__auralisApplyOutput(media);
      }).observe(document.documentElement, {childList:true,subtree:true});
      document.addEventListener('loadedmetadata', event => {
        if (event.target instanceof HTMLMediaElement) void window.__auralisApplyOutput(event.target);
      }, true);
    }
    const media = document.querySelector('video.video-stream.html5-main-video') || document.querySelector('video, audio');
    if (!media) {
      const result = {ok:true,deviceId:window.__auralisOutputTarget,deferred:true};
      window.__auralisOutputStatus = result;
      return result;
    }
    const result = await window.__auralisApplyOutput(media, ${explicit});
    if (!result.ok && ${explicit}) window.__auralisOutputTarget = previous;
    return result;
  })()`;
}

export const LIBRARY_THUMBNAILS_REFRESH_EVENT = "astrelis:library-thumbnails-refresh";

export function refreshLibraryThumbnails(sources: string[]) {
  if (typeof window === "undefined") return;
  const uniqueSources = [...new Set(sources.filter(source => typeof source === "string" && source.length > 0))];
  if (!uniqueSources.length) return;
  window.dispatchEvent(new CustomEvent(LIBRARY_THUMBNAILS_REFRESH_EVENT, { detail: { sources: uniqueSources } }));
}

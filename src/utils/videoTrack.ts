export const isVideoFile = (name: string) => /\.(mp4|mkv|mov|m4v|webm|avi|ts|m2ts|mpg|mpeg|wmv|asf|flv|ogv|3gp|3g2|f4v|vob|mxf|rm|rmvb|mts|m2t|m1v|m2v|divx|mpe|m2p|qt|tp|trp|vro|mpv)$/i.test(name);
export const isVideoTrack = (track?: { mediaKind?: string; format: string }) => Boolean(track && (track.mediaKind === "video" || isVideoFile("file." + track.format)));

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { resolveNeteaseStream } from "./neteaseApi";
import { fetchNativeStream } from "./nativeHttpStream";
import type { LocalMediaAccessPolicy } from "./security/ElectronSecurity";

const mediaMime = (filePath: string) => ({
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
  ".aac": "audio/aac", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".opus": "audio/ogg", ".aiff": "audio/aiff", ".aif": "audio/aiff",
  ".wma": "audio/x-ms-wma", ".ape": "audio/ape", ".dsf": "audio/dsf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif"
} as Record<string, string>)[path.extname(filePath).toLowerCase()] || "application/octet-stream";

export interface MediaProtocolDeps {
  localMediaAccess: LocalMediaAccessPolicy;
  writeLog(level: string, message: string): void;
}

/**
 * auralis-media serves authorised local files with byte ranges;
 * auralis-netease proxies NetEase CDN audio through Node's HTTP stack.
 */
export function registerMediaProtocols({ localMediaAccess, writeLog }: MediaProtocolDeps) {
  protocol.handle("auralis-media", request => {
    try {
      const parsed = new URL(request.url);
      const filePath = decodeURIComponent(parsed.pathname.slice(1));
      if ((request.method !== "GET" && request.method !== "HEAD")
        || parsed.hostname !== "local" || parsed.search || parsed.hash
        || !path.isAbsolute(filePath) || !localMediaAccess?.isAllowed(filePath) || !fs.existsSync(filePath))
        return new Response("Not found", { status: 404 });
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      const commonHeaders: Record<string, string> = {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Content-Type": mediaMime(filePath)
      };
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (!match) return new Response(null, { status: 416, headers: { ...commonHeaders, "Content-Range": `bytes */${stat.size}` } });
        const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0;
        const start = suffixLength > 0 ? Math.max(0, stat.size - suffixLength) : Number(match[1] || 0);
        const requestedEnd = match[1] && match[2] ? Number(match[2]) : stat.size - 1;
        const end = Math.min(stat.size - 1, requestedEnd);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size)
          return new Response(null, { status: 416, headers: { ...commonHeaders, "Content-Range": `bytes */${stat.size}` } });
        const length = end - start + 1;
        const headers = { ...commonHeaders, "Content-Length": String(length), "Content-Range": `bytes ${start}-${end}/${stat.size}` };
        if (request.method === "HEAD") return new Response(null, { status: 206, headers });
        const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
        return new Response(body, { status: 206, headers });
      }
      const headers = { ...commonHeaders, "Content-Length": String(stat.size) };
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
      return new Response(body, { status: 200, headers });
    } catch { return new Response("Invalid media path", { status: 400 }); }
  });
  protocol.handle("auralis-netease", async request => {
    try {
      const parsed = new URL(request.url);
      const id = Number(parsed.pathname.split("/").filter(Boolean).at(-1));
      if (parsed.hostname !== "stream" || !Number.isFinite(id))
        return new Response("Invalid NetEase track", { status: 400 });
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Range"
          }
        });
      }
      const streamUrl = await resolveNeteaseStream(id);
      // Do not forward renderer Origin/Referer headers to the NetEase CDN.
      // Some CDN nodes reject them; seeking only requires the byte range.
      const upstreamHeaders: Record<string, string> = {};
      const range = request.headers.get("range");
      if (range) upstreamHeaders.Range = range;
      upstreamHeaders.Accept = "audio/*,*/*;q=0.8";
      upstreamHeaders.Referer = "https://music.163.com/";
      upstreamHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
      // Electron's Chromium network service can report ERR_BLOCKED_BY_CLIENT
      // on some PCs due to filters, proxies, or security software. Stream the
      // CDN response with Node's native HTTP stack so playback is independent
      // of browser request blocking while retaining byte-range seeking.
      const upstream = await fetchNativeStream(streamUrl, request.method === "HEAD" ? "HEAD" : "GET", upstreamHeaders);
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      responseHeaders.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
      if (!responseHeaders.has("Accept-Ranges")) responseHeaders.set("Accept-Ranges", "bytes");
      const contentType = upstream.headers.get("content-type") || "unknown";
      const host = (() => { try { return new URL(streamUrl).hostname; } catch { return "unknown"; } })();
      writeLog(upstream.status >= 200 && upstream.status < 400 ? "INFO" : "ERROR", `NetEase stream ${id}: ${upstream.status} ${contentType} via ${host}${range ? ` ${range}` : ""}`);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "NetEase stream unavailable";
      writeLog("ERROR", `NetEase stream failed: ${message}`);
      return new Response(message, {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  });
}

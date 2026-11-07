import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

export interface NativeHttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}

export function fetchNativeStream(url: string, method: "GET" | "HEAD", headers: Record<string, string>, redirects = 0): Promise<NativeHttpResponse> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try { target = new URL(url); }
    catch { reject(new Error("Invalid NetEase CDN URL")); return; }
    const client = target.protocol === "https:" ? https : target.protocol === "http:" ? http : null;
    if (!client) { reject(new Error(`Unsupported NetEase CDN protocol: ${target.protocol}`)); return; }
    const request = client.request(target, { method, headers }, response => {
      const status = response.statusCode || 502;
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        if (redirects >= 5) { reject(new Error("NetEase CDN redirected too many times")); return; }
        void fetchNativeStream(new URL(location, target).toString(), method, headers, redirects + 1).then(resolve, reject);
        return;
      }
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, String(value));
      }
      resolve({
        status,
        statusText: response.statusMessage || "",
        headers: responseHeaders,
        body: Readable.toWeb(response) as ReadableStream<Uint8Array>
      });
    });
    request.setTimeout(20_000, () => request.destroy(new Error("NetEase CDN request timed out")));
    request.once("error", reject);
    request.end();
  });
}

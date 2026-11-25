import { NextResponse } from "next/server";
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function appOrigin() {
  const raw = process.env.APP_ORIGIN;
  if (!raw) throw new Error("APP_ORIGIN is required");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("APP_ORIGIN must be an origin");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const octets = url.hostname.split(".").map(Number);
  const privateIPv4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  // Explicit opt-in for the owner's trusted LAN; never enables plaintext public origins.
  const permittedHttp = loopback || (process.env.ALLOW_LAN_HTTP === "true" && privateIPv4);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && permittedHttp)) throw new Error("HTTPS is required outside loopback unless private LAN HTTP is explicitly enabled");
  return url.origin;
}
export function checkMutation(request: Request) {
  if (request.headers.get("origin") !== appOrigin()) throw new HttpError(403, "origin_not_allowed");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "origin_not_allowed");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "json_required");
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  checkMutation(request);
  if (!request.body) throw new HttpError(400, "invalid_request");
  const reader = request.body.getReader();
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw new HttpError(413, "request_too_large"); }
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "invalid_request"); }
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: {
    "Cache-Control": "no-store, private", "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  } });
}
export function failure(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  // Do not leak SQL text, child records, credentials, or infrastructure details.
  return json({ error: "service_unavailable" }, 503);
}

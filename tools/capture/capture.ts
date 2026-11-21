// One captured callback, stored exactly as received. Shared by the Cloudflare Worker and the local capture server,
// so it uses web APIs only.

export const CAPTURE_GATEWAYS: readonly string[] = ["paymob", "kashier", "fawry", "geidea", "paytabs", "payfort", "tap"];

export const MAX_BODY_BYTES = 1_048_576;

// Hop-by-hop, proxy and credential headers: never part of a gateway signature, and never stored.
const DROPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "true-client-ip",
  "forwarded",
  "cdn-loop",
  "connection",
  "keep-alive",
]);

const LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface Capture {
  readonly id: string;
  readonly gateway: string;
  readonly label: string | null;
  readonly receivedAt: string;
  readonly method: string;
  readonly path: string;
  readonly rawQuery: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBodyBase64: string;
}

export type CaptureResult = { readonly capture: Capture } | { readonly status: number; readonly message: string };

export interface CaptureOptions {
  readonly now: Date;
  readonly id: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function keptHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (!DROPPED_HEADERS.has(name) && !name.startsWith("cf-") && !name.startsWith("x-vercel-")) {
      kept[name] = value;
    }
  });

  return kept;
}

// Routes: /hooks/<gateway> or /hooks/<gateway>/<label>, for any method (redirects arrive as GET).
export function parseHookPath(pathname: string): { gateway: string; label: string | null } | undefined {
  const [first, gateway, label, ...rest] = pathname.split("/").filter((part) => part !== "");

  if (first !== "hooks" || gateway === undefined || !CAPTURE_GATEWAYS.includes(gateway) || rest.length > 0) {
    return undefined;
  }

  if (label !== undefined && !LABEL.test(label)) {
    return undefined;
  }

  return { gateway, label: label ?? null };
}

export async function captureRequest(request: Request, options: CaptureOptions): Promise<CaptureResult> {
  const url = new URL(request.url);
  const route = parseHookPath(url.pathname);

  if (route === undefined) {
    return { status: 404, message: "Not found. Use /hooks/<gateway> or /hooks/<gateway>/<label>." };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (declaredLength > MAX_BODY_BYTES) {
    return { status: 413, message: "Body too large" };
  }

  const body = new Uint8Array(await request.arrayBuffer());

  if (body.length > MAX_BODY_BYTES) {
    return { status: 413, message: "Body too large" };
  }

  return {
    capture: {
      id: options.id,
      gateway: route.gateway,
      label: route.label,
      receivedAt: options.now.toISOString(),
      method: request.method,
      path: url.pathname,
      rawQuery: url.search.replace(/^\?/, ""),
      headers: keptHeaders(request.headers),
      rawBodyBase64: bytesToBase64(body),
    },
  };
}

export function captureKey(capture: Capture): string {
  return `capture:${capture.gateway}:${capture.receivedAt}:${capture.id}`;
}

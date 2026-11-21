// Local capture server, for use behind a tunnel (cloudflared or ngrok) during an interactive sandbox session.
// Writes each callback to tools/.captures/<gateway>/, in the same format as the Cloudflare Worker.
// Run: node --experimental-strip-types tools/capture-server.ts [port]
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { captureRequest } from "./capture/capture.ts";

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const outputDir = join(import.meta.dirname, ".captures");

async function toRequest(message: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];

  for await (const chunk of message) {
    chunks.push(chunk as Buffer);
  }

  const headers = new Headers();

  for (const [name, value] of Object.entries(message.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) headers.append(name, item);
    }
  }

  const method = message.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);

  return new Request(`http://localhost:${port}${message.url ?? "/"}`, { method, headers, ...(body === undefined ? {} : { body }) });
}

createServer((message, response) => {
  toRequest(message)
    .then((request) => captureRequest(request, { now: new Date(), id: randomUUID() }))
    .then((result) => {
      if ("status" in result) {
        response.writeHead(result.status, { "content-type": "text/plain" }).end(result.message);
        return;
      }

      const { capture } = result;
      const dir = join(outputDir, capture.gateway);
      const file = join(dir, `${capture.receivedAt.replaceAll(":", "-")}-${capture.id}.json`);

      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`);
      console.log(`captured ${capture.method} ${capture.path} -> ${file}`);
      response.writeHead(200, { "content-type": "text/plain" }).end("OK");
    })
    .catch((error: unknown) => {
      console.error("capture failed:", error instanceof Error ? error.message : error);
      response.writeHead(500).end("Capture failed");
    });
}).listen(port, () => {
  console.log(`Capturing on http://localhost:${port}/hooks/<gateway>; point the tunnel here. Ctrl+C to stop.`);
});

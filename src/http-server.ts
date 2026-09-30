import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Context } from "./context.js";
import { createServer } from "./mcp.js";
import type { Store } from "./store.js";

const CONNECTOR_FILE = "connector.json";
export const LOCAL_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8765;

interface ConnectorConfig {
  secret: string;
}

// claude.ai connectors can't send custom headers, so the secret travels in the URL path and acts as the password.
export async function connectorSecret(store: Store, options: { rotate?: boolean } = {}): Promise<string> {
  const saved = await store.readJson<ConnectorConfig>(CONNECTOR_FILE);
  if (saved?.secret && !options.rotate) return saved.secret;
  const secret = randomBytes(32).toString("base64url");
  await store.writeJson(CONNECTOR_FILE, { secret } satisfies ConnectorConfig);
  return secret;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function secretMatches(candidate: string, secret: string): boolean {
  return timingSafeEqual(digest(candidate), digest(secret));
}

function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
}

export interface HttpServerHandle {
  port: number;
  path: string;
  close(): Promise<void>;
}

export async function startHttpServer(
  ctx: Context,
  options: { secret: string; port?: number; host?: string },
): Promise<HttpServerHandle> {
  const path = `/mcp/${options.secret}`;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    const [, prefix, candidate, ...extra] = requestPath.split("/");
    // Every miss looks the same, so a scanner learns nothing about whether the server exists.
    if (prefix !== "mcp" || !candidate || extra.length > 0 || !secretMatches(candidate, options.secret)) {
      return reply(res, 404, "Not found");
    }
    if (req.method !== "POST") return reply(res, 405, "Method not allowed");

    // Stateless: a fresh server and transport per request, so nothing is shared between callers.
    const server = createServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  const http: Server = createHttpServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, "Internal error");
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? DEFAULT_PORT, options.host ?? LOCAL_HOST, () => {
      http.off("error", reject);
      resolve();
    });
  });

  return {
    port: (http.address() as AddressInfo).port,
    path,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close(error => (error ? reject(error) : resolve()));
      }),
  };
}

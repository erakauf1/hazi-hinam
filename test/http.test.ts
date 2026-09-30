import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { createContext } from "../src/context.js";
import { connectorSecret, startHttpServer, type HttpServerHandle } from "../src/http-server.js";
import { operations } from "../src/operations/index.js";
import { NOW, signedIn, tempStore } from "./helpers.js";

let server: HttpServerHandle | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(ctx: ReturnType<typeof createContext>, secret = "s3cret-value") {
  server = await startHttpServer(ctx, { secret, port: 0 });
  return `http://127.0.0.1:${server.port}`;
}

async function connect(url: string, headers?: Record<string, string>) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });

describe("http mcp server", () => {
  it("serves every tool at the secret path and runs them", async () => {
    const { ctx } = await signedIn({ "GET order/history": { Orders: [] } });
    const base = await start(ctx);
    const client = await connect(`${base}${server!.path}`);
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(operations.map(o => o.name).sort());
    const result = await client.callTool({ name: "list_orders", arguments: { limit: 3 } });
    expect(JSON.parse((result.content as any)[0].text)).toEqual([]);
    await client.close();
  });

  it("accepts the secret as a bearer header at /mcp", async () => {
    const { ctx } = await signedIn({ "GET order/history": { Orders: [] } });
    const base = await start(ctx);
    const client = await connect(`${base}/mcp`, { Authorization: "Bearer s3cret-value" });
    const result = await client.callTool({ name: "list_orders", arguments: { limit: 3 } });
    expect(JSON.parse((result.content as any)[0].text)).toEqual([]);
    await client.close();
  });

  it("answers 404 at /mcp for a missing, wrong or malformed header", async () => {
    const { ctx } = await signedIn({});
    const base = await start(ctx);
    for (const authorization of [undefined, "Bearer wrong", "Bearer s3cret-valu", "s3cret-value", "Basic s3cret-value", "Bearer s3cret-value extra"]) {
      const res = await post(`${base}/mcp`, authorization === undefined ? {} : { Authorization: authorization });
      expect(res.status, String(authorization)).toBe(404);
    }
    // The header only unlocks /mcp itself, never another path.
    expect((await post(`${base}/other`, { Authorization: "Bearer s3cret-value" })).status).toBe(404);
    await expect(connect(`${base}/mcp`, { Authorization: "Bearer wrong" })).rejects.toThrow();
  });

  it("handles several clients one after another", async () => {
    const { ctx } = await signedIn({});
    const base = await start(ctx);
    for (let i = 0; i < 3; i++) {
      const client = await connect(`${base}${server!.path}`);
      expect((await client.listTools()).tools.length).toBe(operations.length);
      await client.close();
    }
  });

  it("answers 404 for a wrong secret, a missing secret or any other path", async () => {
    const { ctx } = await signedIn({});
    const base = await start(ctx);
    for (const path of ["/mcp/wrong", "/mcp/s3cret-valu", "/mcp/s3cret-value/extra", "/mcp", "/mcp/", "/", "/s3cret-value"]) {
      expect((await post(`${base}${path}`)).status, path).toBe(404);
    }
    await expect(connect(`${base}/mcp/wrong`)).rejects.toThrow();
  });

  it("refuses non-POST requests at the secret path", async () => {
    const { ctx } = await signedIn({});
    const base = await start(ctx);
    expect((await fetch(`${base}${server!.path}`)).status).toBe(405);
  });
});

describe("connector secret", () => {
  it("is created once, kept private on disk, and reused", async () => {
    const store = await tempStore();
    const first = await connectorSecret(store);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await connectorSecret(store)).toBe(first);
    expect((await stat(join(store.dir, "connector.json"))).mode & 0o777).toBe(0o600);
  });

  it("is replaced on request", async () => {
    const store = await tempStore();
    const first = await connectorSecret(store);
    const second = await connectorSecret(store, { rotate: true });
    expect(second).not.toBe(first);
    expect(await connectorSecret(store)).toBe(second);
  });
});

describe("mcp cli flags", () => {
  const io = () => {
    const out = { stdout: "", stderr: "" };
    return { out, io: { stdout: (t: string) => void (out.stdout += t), stderr: (t: string) => void (out.stderr += t), readLine: async () => "" } };
  };

  it("rejects HTTP-only flags without --http", async () => {
    const { out, io: cliIo } = io();
    const code = await main(["mcp", "--tunnel"], cliIo, createContext({ store: await tempStore(), now: () => NOW }));
    expect(code).toBe(1);
    expect(out.stderr).toMatch(/need --http/);
  });

  it("rejects a bad port and unknown flags", async () => {
    const ctx = createContext({ store: await tempStore(), now: () => NOW });
    for (const argv of [["mcp", "--http", "--port", "99999"], ["mcp", "--http", "--port", "abc"], ["mcp", "--http", "--host", "0.0.0.0"]]) {
      const { out, io: cliIo } = io();
      expect(await main(argv, cliIo, ctx), argv.join(" ")).toBe(1);
      expect(out.stderr).toMatch(/BAD_ARGS/);
    }
  });
});

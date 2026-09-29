import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { z } from "zod";
import type { Item } from "../src/api/types.js";
import { Store } from "../src/store.js";
import { createContext } from "../src/context.js";
import { operations } from "../src/operations/index.js";

export interface Call {
  method: string;
  path: string;
  url: URL;
  headers: Headers;
  body: any;
}

export interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
}

export const ok = (results: unknown): Reply => ({ json: { IsOK: true, Results: results, ErrorResponse: null } });

/** Routes are keyed "METHOD path" (path relative to /proxy/api/). A non-function value is used as `Results`. */
export function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/proxy\/api\//, "");
    const call: Call = {
      method,
      path,
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    if (route === undefined) return new Response("", { status: 404 });
    const reply: Reply = typeof route === "function" ? (route as (c: Call) => Reply)(call) : ok(route);
    return new Response(reply.text ?? JSON.stringify(reply.json), { status: reply.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const item = (id: number, overrides: Partial<Item> = {}): Item => ({
  Id: id,
  BarKod: `7290000000${id}`,
  Name: `Item ${id}`,
  IsInStock: true,
  Price_NET: 10,
  Cart: null,
  ...overrides,
});

export const tempStore = async () => new Store(join(await mkdtemp(join(tmpdir(), "hh-")), "cfg"));

export const NOW = new Date("2026-09-29T19:00:00Z");

export async function signedIn(routes: Record<string, unknown>, now: Date = NOW) {
  const store = await tempStore();
  await store.saveSession("tok", 172800, now);
  const f = fakeFetch(routes);
  return { ctx: createContext({ store, fetch: f.fetch, now: () => now }), calls: f.calls, store };
}

export function runOp(ctx: ReturnType<typeof createContext>, name: string, args: Record<string, unknown> = {}) {
  const op = operations.find(o => o.name === name);
  if (!op) throw new Error(`no operation ${name}`);
  return op.run(ctx, z.object(op.input).parse(args));
}

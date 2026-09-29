# Hazi Hinam MCP + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node.js library, CLI, and MCP server that let an AI assistant fill the user's Hazi Hinam cart with their saved "usual order", find delivery slots for a requested day, and hand off to the website for payment.

**Architecture:** A small core (`client` → `api/*` → `usual-order`) talks to the store's JSON API at `https://shop.hazi-hinam.co.il/proxy/api/` with a bearer token the user obtains by logging in themselves. Every user-facing capability is an **operation** (name, description, zod input, `run`) in `src/operations/`; the CLI and the MCP server are both generated from that one registry, so adding a new API later means adding one operation file and nothing else.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node ≥ 22 built-in `fetch`, `@modelcontextprotocol/sdk`, `zod` 3.25+, `vitest`. Optional: `playwright-core` for browser login.

**Spec:** `docs/API.md` (endpoints, request conventions, live test results).

## Global Constraints

- Node `>=22`, `"type": "module"`, TypeScript `strict: true`, relative imports end in `.js`.
- API base: `https://shop.hazi-hinam.co.il/proxy/api/`. Every request sends `Authorization: Bearer <token>`, `Accept: application/json`, `User-Agent: Mozilla/5.0`, and `DEVICE_INFO: {"DEVICE_TYPE":4,"UDID":"","MANUFACTURER":"","MODEL":"","VERSION":""}`.
- **Every POST/PUT body is wrapped as `{"Object": <payload>}`**; an empty payload is `{"Object":{}}`. A bare or empty body gets HTTP 500.
- Responses are `{ IsOK, Results, ErrorResponse }`; callers only ever see `Results`.
- **Payment is out of scope for this version.** Do not call `order/post` (that call is payment), `user/cc`, or `user/GetIFrameURL`; the client refuses these paths before any network I/O. Payment support may be added later in its own plan, by removing the guard deliberately.
- **Never solve, bypass, or automate the login CAPTCHA.** The user logs in themselves; the tool only reuses the resulting token (valid 48 h, `expires_in: 172800`).
- Personal data (token, usual order) lives only in the config dir: `$HAZI_HINAM_CONFIG_DIR`, else `$XDG_CONFIG_HOME/hazi-hinam`, else `~/.config/hazi-hinam`. Dir mode `0700`, files `0600`, written atomically.
- Never commit real tokens, order IDs, totals, or the usual order. Test fixtures use made-up values.
- `item/addItemToCart` **sets** the quantity (absolute); `Quantity: 0` deletes the line. `Type` 1 = unit, 2 = kg.
- Dates from the site are `dd/MM/yyyy`; the tool uses ISO `YYYY-MM-DD` and Israel time (`Asia/Jerusalem`).

## File Structure

```
package.json, tsconfig.json, vitest.config.ts
src/
  errors.ts            error classes + formatError
  config.ts            configDir()
  store.ts             Store: atomic private JSON files, session load/save/clear
  client.ts            HaziHinamClient: headers, {"Object"} wrapping, envelope, forbidden paths
  api/types.ts         response shapes observed on the live site
  api/items.ts         flattenCategories()
  api/orders.ts        listOrders, getOrderItems, copyOrderToCart
  api/cart.ts          getCart, getCartSummary, setItemQuantity, clearCart
  api/account.ts       getUserInfo
  dates.ts             parseSiteDate, todayInIsrael, resolveDay
  api/delivery.ts      listDeliverySlots, filterSlotsByDates
  usual-order.ts       snapshotCart, loadUsualOrder, replayUsualOrder
  context.ts           Context + createContext
  operations/define.ts Operation type + defineOperation
  operations/account.ts, orders.ts, cart.ts, delivery.ts, usual-order.ts
  operations/index.ts  the registry
  cli.ts               main(argv, io, ctx)
  mcp.ts               createServer(ctx), runMcpServer(ctx)
  browser-login.ts     extractToken, captureTokenFromBrowser (optional playwright-core)
  bin.ts               process entry point
  index.ts             library exports
test/
  helpers.ts           fakeFetch, ok, item, tempStore
  *.test.ts
```

---

### Task 1: Project scaffold, errors, config dir, private file store

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/errors.ts`, `src/config.ts`, `src/store.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Produces:
  - `class HaziHinamError extends Error { code: string }`, `class AuthRequired`, `class UpstreamError { status?: number }`, `class ForbiddenOperation`, `formatError(e: unknown): string`
  - `configDir(env?: NodeJS.ProcessEnv): string`
  - `interface Session { accessToken: string; savedAt: string; expiresAt: string }`
  - `class Store { dir; readJson<T>(name): Promise<T|undefined>; writeJson(name, value): Promise<void>; remove(name): Promise<void>; saveSession(token: string, expiresInSeconds: number, now: Date): Promise<Session>; loadSession(now: Date): Promise<Session|undefined>; clearSession(): Promise<void> }`

- [ ] **Step 1: Create the scaffold and install dependencies**

`package.json`:
```json
{
  "name": "hazi-hinam",
  "version": "0.1.0",
  "private": true,
  "description": "Unofficial MCP server and CLI for the Hazi Hinam online store",
  "type": "module",
  "bin": { "hazi-hinam": "dist/bin.js" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "license": "MIT"
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

Run:
```bash
npm install @modelcontextprotocol/sdk zod@^3.25
npm install -D typescript vitest @types/node
```

- [ ] **Step 2: Write the failing test**

`test/store.test.ts`:
```ts
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configDir } from "../src/config.js";
import { Store } from "../src/store.js";

const freshStore = async () => new Store(join(await mkdtemp(join(tmpdir(), "hh-")), "cfg"));

describe("configDir", () => {
  it("prefers HAZI_HINAM_CONFIG_DIR", () => {
    expect(configDir({ HAZI_HINAM_CONFIG_DIR: "/x", XDG_CONFIG_HOME: "/xdg" })).toBe("/x");
  });
  it("falls back to XDG_CONFIG_HOME", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/hazi-hinam");
  });
  it("defaults to ~/.config/hazi-hinam", () => {
    expect(configDir({})).toMatch(/\.config\/hazi-hinam$/);
  });
});

describe("Store", () => {
  it("writes owner-only files and leaves no temp files behind", async () => {
    const store = await freshStore();
    await store.writeJson("a.json", { x: 1 });
    expect(await store.readJson("a.json")).toEqual({ x: 1 });
    expect((await stat(store.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(store.dir, "a.json"))).mode & 0o777).toBe(0o600);
    expect(await readdir(store.dir)).toEqual(["a.json"]);
  });

  it("returns undefined for a missing file", async () => {
    expect(await (await freshStore()).readJson("nope.json")).toBeUndefined();
  });

  it("saves a session that expires after expires_in seconds", async () => {
    const store = await freshStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const saved = await store.saveSession("tok", 172800, now);
    expect(saved).toEqual({ accessToken: "tok", savedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-03T00:00:00.000Z" });
    expect(await store.loadSession(now)).toEqual(saved);
  });

  it("deletes and hides an expired session", async () => {
    const store = await freshStore();
    await store.saveSession("tok", 172800, new Date("2026-01-01T00:00:00Z"));
    expect(await store.loadSession(new Date("2026-01-03T00:00:01Z"))).toBeUndefined();
    expect(await store.readJson("session.json")).toBeUndefined();
  });

  it("clearSession removes the session and tolerates a missing one", async () => {
    const store = await freshStore();
    await store.saveSession("tok", 60, new Date());
    await store.clearSession();
    await store.clearSession();
    expect(await store.readJson("session.json")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL, cannot resolve `../src/config.js`.

- [ ] **Step 4: Implement**

`src/errors.ts`:
```ts
import { z } from "zod";

export class HaziHinamError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthRequired extends HaziHinamError {
  constructor(message = "Not signed in, or the 48-hour login expired. Run `hazi-hinam login`.") {
    super("AUTH_REQUIRED", message);
  }
}

export class UpstreamError extends HaziHinamError {
  constructor(message: string, readonly status?: number) {
    super("UPSTREAM_ERROR", message);
  }
}

export class ForbiddenOperation extends HaziHinamError {
  constructor(path: string) {
    super("FORBIDDEN_OPERATION", `Refusing to call ${path}: placing and paying for orders is done on the website only.`);
  }
}

export function formatError(error: unknown): string {
  if (error instanceof HaziHinamError) return `${error.code}: ${error.message}`;
  if (error instanceof z.ZodError) {
    return "BAD_ARGS: " + error.issues.map(i => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  }
  return `UNEXPECTED: ${error instanceof Error ? error.message : String(error)}`;
}
```

`src/config.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HAZI_HINAM_CONFIG_DIR) return env.HAZI_HINAM_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "hazi-hinam");
  return join(homedir(), ".config", "hazi-hinam");
}
```

`src/store.ts`:
```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Session {
  accessToken: string;
  savedAt: string;
  expiresAt: string;
}

const SESSION_FILE = "session.json";

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class Store {
  constructor(readonly dir: string) {}

  async readJson<T>(name: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.dir, name), "utf8")) as T;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  // Created at 0600 and swapped in with rename, so a token file is never briefly world-readable or truncated.
  async writeJson(name: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, name);
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    try {
      await unlink(join(this.dir, name));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async saveSession(accessToken: string, expiresInSeconds: number, now: Date): Promise<Session> {
    const session: Session = {
      accessToken,
      savedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    };
    await this.writeJson(SESSION_FILE, session);
    return session;
  }

  async loadSession(now: Date): Promise<Session | undefined> {
    const session = await this.readJson<Session>(SESSION_FILE);
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      await this.remove(SESSION_FILE);
      return undefined;
    }
    return session;
  }

  clearSession(): Promise<void> {
    return this.remove(SESSION_FILE);
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/store.test.ts && npm run typecheck`
Expected: 8 tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src test
git commit -m "feat: project scaffold, errors, private config store"
```

---

### Task 2: HTTP client

**Files:**
- Create: `src/client.ts`, `test/helpers.ts`
- Test: `test/client.test.ts`

**Interfaces:**
- Consumes: `AuthRequired`, `UpstreamError`, `ForbiddenOperation` from Task 1.
- Produces:
  - `SITE_ORIGIN = "https://shop.hazi-hinam.co.il"`, `API_BASE = SITE_ORIGIN + "/proxy/api/"`
  - `class HaziHinamClient { constructor(token: string, options?: { fetch?: typeof fetch; timeoutMs?: number }); get<T>(path: string, query?: Record<string, string | number>): Promise<T>; post<T>(path: string, payload?: unknown): Promise<T>; delete<T>(path: string): Promise<T> }`
  - `test/helpers.ts`: `fakeFetch(routes)`, `ok(results)`, `item(id, overrides?)`, `tempStore()`

- [ ] **Step 1: Write the test helpers**

`test/helpers.ts`:
```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { Item } from "../src/api/types.js";
import { Store } from "../src/store.js";

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
```

Note: `test/helpers.ts` imports `Item` from `src/api/types.ts`, created in Step 4 of this task.

- [ ] **Step 2: Write the failing test**

`test/client.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HaziHinamClient } from "../src/client.js";
import { AuthRequired, ForbiddenOperation, UpstreamError } from "../src/errors.js";
import { fakeFetch } from "./helpers.js";

describe("HaziHinamClient", () => {
  it("sends the headers the site's own app sends", async () => {
    const f = fakeFetch({ "GET user/info": { CartItemsCount: 0 } });
    await new HaziHinamClient("tok", { fetch: f.fetch }).get("user/info");
    const h = f.calls[0].headers;
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(h.get("device_info")!)).toEqual({ DEVICE_TYPE: 4, UDID: "", MANUFACTURER: "", MODEL: "", VERSION: "" });
    expect(h.get("user-agent")).toBe("Mozilla/5.0");
  });

  it("returns Results and passes query parameters", async () => {
    const f = fakeFetch({ "GET item/getItemsPromoted": { Items: [1] } });
    const results = await new HaziHinamClient("t", { fetch: f.fetch }).get("item/getItemsPromoted", { SortBy: -1 });
    expect(results).toEqual({ Items: [1] });
    expect(f.calls[0].url.searchParams.get("SortBy")).toBe("-1");
  });

  it("wraps POST bodies in {Object}", async () => {
    const f = fakeFetch({ "POST item/addItemToCart": null, "POST order/addOrderItemsToCart/5": null });
    const c = new HaziHinamClient("t", { fetch: f.fetch });
    await c.post("item/addItemToCart", { ItemId: 1 });
    await c.post("order/addOrderItemsToCart/5");
    expect(f.calls[0].body).toEqual({ Object: { ItemId: 1 } });
    expect(f.calls[1].body).toEqual({ Object: {} });
    expect(f.calls[0].headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("maps 401 to AuthRequired", async () => {
    const f = fakeFetch({ "GET user/info": () => ({ status: 401, text: "" }) });
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).get("user/info")).rejects.toBeInstanceOf(AuthRequired);
  });

  it("reports HTTP errors and non-JSON bodies as UpstreamError", async () => {
    const f = fakeFetch({
      "POST order/addOrderItemsToCart/1": () => ({ status: 500, text: "" }),
      "GET order/history": () => ({ status: 200, text: "<html>" }),
    });
    const c = new HaziHinamClient("t", { fetch: f.fetch });
    await expect(c.post("order/addOrderItemsToCart/1")).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 500 });
    await expect(c.get("order/history")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("surfaces the site's rejection reason when IsOK is false", async () => {
    const f = fakeFetch({
      "POST item/addItemToCart": () => ({ json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "Item not available" } } }),
    });
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).post("item/addItemToCart", {})).rejects.toThrow(/Item not available/);
  });

  it.each(["order/post", "/order/post", "user/cc", "user/cc/12", "user/GetIFrameURL"])(
    "refuses %s without touching the network",
    async path => {
      const f = fakeFetch({});
      await expect(new HaziHinamClient("t", { fetch: f.fetch }).post(path, {})).rejects.toBeInstanceOf(ForbiddenOperation);
      expect(f.calls).toHaveLength(0);
    },
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/client.test.ts`
Expected: FAIL, cannot resolve `../src/client.js`.

- [ ] **Step 4: Implement**

`src/api/types.ts`:
```ts
// Shapes observed on the live site (docs/API.md). Only fields this tool reads are listed.

export interface Shipment {
  ShipmentId: number;
  DOW: string;
  Date: string; // dd/MM/yyyy
  Time: { From: string; To: string };
  IsClosedShipment: boolean;
  IsExceeds: boolean;
  IsSelfPickUp: boolean;
}

export interface OrderSummary {
  Id: number;
  Date: string;
  Total: number;
  Order_Status: number;
  Order_Status_Desc: string;
  IsDraftOrder: boolean;
  ShippingTypeDesc: string;
  Shipment: Shipment | null;
}

export interface CartLine {
  Quantity: number;
  ItemQuantityType: number; // 1 = unit, 2 = kg
}

export interface Item {
  Id: number;
  BarKod: string;
  Name: string;
  IsInStock: boolean;
  Price_NET: number;
  Cart: CartLine | null;
}

export interface Category {
  Id: number;
  Name: string;
  Items: Item[] | null;
}

export interface CartSummary {
  Price_NET_TOTAL: number;
  Price_Shipping: number;
  Price_Savings: number;
  Price_Order_Total: number;
  Minimum_Cart_Price_NET: number;
}

export interface ShipmentDay {
  DOW: string;
  Date: string;
  Shipments: Shipment[];
}

export interface DeliveryAddress {
  Id: number;
  Name: string;
  IsDefault: boolean;
  ShipmentsByDate: ShipmentDay[];
}

export interface NextDeliveries {
  Addresses: DeliveryAddress[];
}

export interface UserInfoResults {
  UserInfo: unknown | null;
  CartItemsCount: number;
}
```

`src/client.ts`:
```ts
import { AuthRequired, ForbiddenOperation, UpstreamError } from "./errors.js";

export const SITE_ORIGIN = "https://shop.hazi-hinam.co.il";
export const API_BASE = `${SITE_ORIGIN}/proxy/api/`;

const DEVICE_INFO = JSON.stringify({ DEVICE_TYPE: 4, UDID: "", MANUFACTURER: "", MODEL: "", VERSION: "" });
// Verified live with this exact value; the site sits behind Cloudflare.
const USER_AGENT = "Mozilla/5.0";

// Payment is out of scope for now: order/post takes card details and places the order; user/cc and
// GetIFrameURL are card management. Lifting this is a deliberate, separately planned change.
const FORBIDDEN_PATHS = [/^order\/post\b/i, /^user\/cc\b/i, /^user\/GetIFrameURL\b/i];

interface Envelope<T> {
  IsOK: boolean;
  Results: T;
  ErrorResponse: { ErrorCode?: number | string; ErrorDescription?: string } | null;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class HaziHinamClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly token: string, options: ClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  // The site's ApiService wraps every POST/PUT body this way; a bare body is answered with HTTP 500.
  post<T>(path: string, payload: unknown = {}): Promise<T> {
    return this.request<T>("POST", path, { Object: payload });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, rawPath: string, body?: unknown, query: Record<string, string | number> = {}): Promise<T> {
    const path = rawPath.replace(/^\/+/, "");
    if (FORBIDDEN_PATHS.some(pattern => pattern.test(path))) throw new ForbiddenOperation(path);

    const url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      DEVICE_INFO,
      "User-Agent": USER_AGENT,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(`${method} ${path} did not complete: ${(error as Error).message}`);
    }

    if (response.status === 401) throw new AuthRequired();
    const text = await response.text();
    if (!response.ok) throw new UpstreamError(`${method} ${path} failed with HTTP ${response.status}`, response.status);

    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new UpstreamError(`${method} ${path} returned a non-JSON response`, response.status);
    }
    if (!envelope.IsOK) {
      throw new UpstreamError(`${method} ${path} was rejected: ${envelope.ErrorResponse?.ErrorDescription ?? "no reason given"}`, response.status);
    }
    return envelope.Results;
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src test
git commit -m "feat: API client with site headers, body wrapping and payment guard"
```

---

### Task 3: Orders, cart and account API

**Files:**
- Create: `src/api/items.ts`, `src/api/orders.ts`, `src/api/cart.ts`, `src/api/account.ts`
- Test: `test/api.test.ts`

**Interfaces:**
- Consumes: `HaziHinamClient` (Task 2), types from `src/api/types.ts`.
- Produces:
  - `flattenCategories(categories: Category[] | null | undefined): Item[]` (deduped by `Id`, first wins)
  - `listOrders(c, limit?: number): Promise<OrderSummary[]>`
  - `getOrderItems(c, orderId: number): Promise<Item[]>`
  - `copyOrderToCart(c, orderId: number): Promise<void>`
  - `getCart(c): Promise<Item[]>`, `getCartSummary(c): Promise<CartSummary>`
  - `setItemQuantity(c, line: { itemId: number; quantity: number; type: number; recalculate?: boolean }): Promise<void>`
  - `clearCart(c): Promise<void>`
  - `getUserInfo(c): Promise<UserInfoResults>`

- [ ] **Step 1: Write the failing test**

`test/api.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getUserInfo } from "../src/api/account.js";
import { clearCart, getCart, getCartSummary, setItemQuantity } from "../src/api/cart.js";
import { flattenCategories } from "../src/api/items.js";
import { copyOrderToCart, getOrderItems, listOrders } from "../src/api/orders.js";
import { HaziHinamClient } from "../src/client.js";
import { fakeFetch, item } from "./helpers.js";

const setup = (routes: Record<string, unknown>) => {
  const f = fakeFetch(routes);
  return { c: new HaziHinamClient("t", { fetch: f.fetch }), calls: f.calls };
};

describe("flattenCategories", () => {
  it("flattens, skips null item lists, and dedupes by Id", () => {
    const items = flattenCategories([
      { Id: 1, Name: "a", Items: [item(1), item(2)] },
      { Id: 2, Name: "b", Items: null },
      { Id: 3, Name: "c", Items: [item(2), item(3)] },
    ]);
    expect(items.map(i => i.Id)).toEqual([1, 2, 3]);
    expect(flattenCategories(null)).toEqual([]);
  });
});

describe("orders", () => {
  it("lists orders newest first and applies the limit", async () => {
    const orders = [{ Id: 3 }, { Id: 2 }, { Id: 1 }];
    const { c } = setup({ "GET order/history": { Orders: orders } });
    expect((await listOrders(c, 2)).map(o => o.Id)).toEqual([3, 2]);
    expect(await listOrders(c)).toHaveLength(3);
  });

  it("reads an order's items from its categories", async () => {
    const { c, calls } = setup({
      "GET item/getItemsByOrder/42": { OrderItems: { Categories: [{ Id: 1, Name: "x", Items: [item(7)] }] } },
    });
    expect((await getOrderItems(c, 42)).map(i => i.Id)).toEqual([7]);
    expect(calls[0].path).toBe("item/getItemsByOrder/42");
  });

  it("copies an order into the cart with an empty wrapped body", async () => {
    const { c, calls } = setup({ "POST order/addOrderItemsToCart/42": null });
    await copyOrderToCart(c, 42);
    expect(calls[0].body).toEqual({ Object: {} });
  });
});

describe("cart", () => {
  it("reads cart items and summary", async () => {
    const summary = { Price_NET_TOTAL: 100, Price_Shipping: 35.9, Price_Savings: 0, Price_Order_Total: 135.9, Minimum_Cart_Price_NET: 499.9 };
    const { c } = setup({
      "GET item/getItemsInCart": { CartItemsCount: 1, CartItems: { Items: null, Categories: [{ Id: 1, Name: "x", Items: [item(5)] }] } },
      "GET order/cartSummary": { CartSummary: summary },
    });
    expect((await getCart(c)).map(i => i.Id)).toEqual([5]);
    expect(await getCartSummary(c)).toEqual(summary);
  });

  it("sets an absolute quantity", async () => {
    const { c, calls } = setup({ "POST item/addItemToCart": null });
    await setItemQuantity(c, { itemId: 9, quantity: 1.5, type: 2 });
    await setItemQuantity(c, { itemId: 10, quantity: 2, type: 1, recalculate: true });
    expect(calls[0].body).toEqual({ Object: { ItemId: 9, Quantity: 1.5, Type: 2, IsCalculateCart: false } });
    expect(calls[1].body.Object.IsCalculateCart).toBe(true);
  });

  it("clears the cart with DELETE", async () => {
    const { c, calls } = setup({ "DELETE item/removeItemsInCart": null });
    await clearCart(c);
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("account", () => {
  it("reads user info", async () => {
    const { c } = setup({ "GET user/info": { UserInfo: { a: 1 }, CartItemsCount: 3 } });
    expect(await getUserInfo(c)).toMatchObject({ CartItemsCount: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts`
Expected: FAIL, cannot resolve `../src/api/account.js`.

- [ ] **Step 3: Implement**

`src/api/items.ts`:
```ts
import type { Category, Item } from "./types.js";

// The cart response lists each item both flat and per category; categories are the complete view.
export function flattenCategories(categories: Category[] | null | undefined): Item[] {
  const byId = new Map<number, Item>();
  for (const category of categories ?? []) {
    for (const item of category.Items ?? []) {
      if (!byId.has(item.Id)) byId.set(item.Id, item);
    }
  }
  return [...byId.values()];
}
```

`src/api/orders.ts`:
```ts
import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { Category, Item, OrderSummary } from "./types.js";

export async function listOrders(c: HaziHinamClient, limit?: number): Promise<OrderSummary[]> {
  const { Orders } = await c.get<{ Orders: OrderSummary[] }>("order/history");
  return limit === undefined ? Orders : Orders.slice(0, limit);
}

export async function getOrderItems(c: HaziHinamClient, orderId: number): Promise<Item[]> {
  const { OrderItems } = await c.get<{ OrderItems: { Categories: Category[] | null } }>(`item/getItemsByOrder/${orderId}`);
  return flattenCategories(OrderItems.Categories);
}

// The site's own "reorder": copies every product line, but at default amounts, not the original ones.
export async function copyOrderToCart(c: HaziHinamClient, orderId: number): Promise<void> {
  await c.post(`order/addOrderItemsToCart/${orderId}`);
}
```

`src/api/cart.ts`:
```ts
import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { CartSummary, Category, Item } from "./types.js";

export async function getCart(c: HaziHinamClient): Promise<Item[]> {
  const { CartItems } = await c.get<{ CartItems: { Categories: Category[] | null } }>("item/getItemsInCart");
  return flattenCategories(CartItems.Categories);
}

export async function getCartSummary(c: HaziHinamClient): Promise<CartSummary> {
  return (await c.get<{ CartSummary: CartSummary }>("order/cartSummary")).CartSummary;
}

export interface CartLineInput {
  itemId: number;
  quantity: number;
  type: number;
  recalculate?: boolean;
}

// Sets the line to exactly `quantity` (0 removes it); the site's +/- buttons use the same call.
export async function setItemQuantity(c: HaziHinamClient, line: CartLineInput): Promise<void> {
  await c.post("item/addItemToCart", {
    ItemId: line.itemId,
    Quantity: line.quantity,
    Type: line.type,
    IsCalculateCart: line.recalculate ?? false,
  });
}

export async function clearCart(c: HaziHinamClient): Promise<void> {
  await c.delete("item/removeItemsInCart");
}
```

`src/api/account.ts`:
```ts
import type { HaziHinamClient } from "../client.js";
import type { UserInfoResults } from "./types.js";

export function getUserInfo(c: HaziHinamClient): Promise<UserInfoResults> {
  return c.get<UserInfoResults>("user/info");
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: orders, cart and account API calls"
```

---

### Task 4: Dates and delivery slots

**Files:**
- Create: `src/dates.ts`, `src/api/delivery.ts`
- Test: `test/dates.test.ts`, `test/delivery.test.ts`

**Interfaces:**
- Consumes: `HaziHinamClient`, `NextDeliveries`, `Shipment` types, `HaziHinamError`.
- Produces:
  - `parseSiteDate(date: string): string` (`"30/09/2026"` → `"2026-09-30"`)
  - `todayInIsrael(now: Date): string`
  - `resolveDay(input: string, now: Date): string[]`: an ISO date or `dd/MM/yyyy` gives one date; a weekday name (English or Hebrew, optionally prefixed "next"/"this"/"יום") gives the **next two** occurrences after today, because "next Thursday" is ambiguous.
  - `interface Slot { shipmentId: number; date: string; dayName: string; from: string; to: string; available: boolean }`
  - `interface AddressSlots { addressId: number; name: string; isDefault: boolean; slots: Slot[] }`
  - `listDeliverySlots(c): Promise<AddressSlots[]>`
  - `filterSlotsByDates(addresses: AddressSlots[], dates: string[]): AddressSlots[]`

- [ ] **Step 1: Write the failing tests**

`test/dates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseSiteDate, resolveDay, todayInIsrael } from "../src/dates.js";

// Tuesday 29/09/2026, 22:00 in Israel
const now = new Date("2026-09-29T19:00:00Z");

describe("dates", () => {
  it("parses the site's dd/MM/yyyy dates", () => {
    expect(parseSiteDate("01/10/2026")).toBe("2026-10-01");
  });

  it("uses Israel's calendar day", () => {
    expect(todayInIsrael(new Date("2026-09-29T22:30:00Z"))).toBe("2026-09-30");
  });

  it.each(["thursday", "Thursday", "next thursday", "thu", "חמישי", "יום חמישי"])("resolves %s to the next two Thursdays", input => {
    expect(resolveDay(input, now)).toEqual(["2026-10-01", "2026-10-08"]);
  });

  it("never resolves a weekday to today", () => {
    expect(resolveDay("tuesday", now)).toEqual(["2026-10-06", "2026-10-13"]);
  });

  it("passes explicit dates through", () => {
    expect(resolveDay("2026-10-08", now)).toEqual(["2026-10-08"]);
    expect(resolveDay("8/10/2026", now)).toEqual(["2026-10-08"]);
  });

  it("rejects unknown input", () => {
    expect(() => resolveDay("someday", now)).toThrow(/Unrecognized day/);
  });
});
```

`test/delivery.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { filterSlotsByDates, listDeliverySlots } from "../src/api/delivery.js";
import { HaziHinamClient } from "../src/client.js";
import { fakeFetch } from "./helpers.js";

const shipment = (id: number, date: string, overrides = {}) => ({
  ShipmentId: id, DOW: "חמישי", Date: date, Time: { From: "19:00", To: "21:00" },
  IsClosedShipment: false, IsExceeds: false, IsSelfPickUp: false, ...overrides,
});

const deliveries = {
  Addresses: [{
    Id: 7, Name: "Home", IsDefault: true,
    ShipmentsByDate: [
      { DOW: "חמישי", Date: "01/10/2026", Shipments: [shipment(1, "01/10/2026", { IsClosedShipment: true })] },
      { DOW: "שישי", Date: "02/10/2026", Shipments: [shipment(3, "02/10/2026", { IsExceeds: true })] },
      { DOW: "חמישי", Date: "08/10/2026", Shipments: [shipment(2, "08/10/2026")] },
    ],
  }],
  Stores: [],
};

describe("delivery slots", () => {
  it("normalizes slots and marks closed or full ones unavailable", async () => {
    const f = fakeFetch({ "GET delivery/getNextDeliveries": deliveries });
    const [home] = await listDeliverySlots(new HaziHinamClient("t", { fetch: f.fetch }));
    expect(home).toMatchObject({ addressId: 7, name: "Home", isDefault: true });
    expect(home.slots).toEqual([
      { shipmentId: 1, date: "2026-10-01", dayName: "חמישי", from: "19:00", to: "21:00", available: false },
      { shipmentId: 3, date: "2026-10-02", dayName: "שישי", from: "19:00", to: "21:00", available: false },
      { shipmentId: 2, date: "2026-10-08", dayName: "חמישי", from: "19:00", to: "21:00", available: true },
    ]);
  });

  it("filters slots to the requested dates", async () => {
    const f = fakeFetch({ "GET delivery/getNextDeliveries": deliveries });
    const all = await listDeliverySlots(new HaziHinamClient("t", { fetch: f.fetch }));
    const [home] = filterSlotsByDates(all, ["2026-10-08"]);
    expect(home.slots.map(s => s.shipmentId)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dates.test.ts test/delivery.test.ts`
Expected: FAIL, cannot resolve `../src/dates.js`.

- [ ] **Step 3: Implement**

`src/dates.ts`:
```ts
import { HaziHinamError } from "./errors.js";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, "ראשון": 0,
  monday: 1, mon: 1, "שני": 1,
  tuesday: 2, tue: 2, "שלישי": 2,
  wednesday: 3, wed: 3, "רביעי": 3,
  thursday: 4, thu: 4, "חמישי": 4,
  friday: 5, fri: 5, "שישי": 5,
  saturday: 6, sat: 6, "שבת": 6,
};

export function parseSiteDate(date: string): string {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new HaziHinamError("BAD_DATE", `Unexpected date format from the site: "${date}"`);
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function todayInIsrael(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A weekday returns the next two occurrences: "next Thursday" said on a Tuesday can mean either one,
// so the caller shows both and lets the user choose.
export function resolveDay(input: string, now: Date): string[] {
  const text = input.trim().toLowerCase().replace(/^(next|this|יום)\s+/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return [text];
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) return [parseSiteDate(text)];

  const weekday = WEEKDAYS[text];
  if (weekday === undefined) {
    throw new HaziHinamError("BAD_DATE", `Unrecognized day "${input}". Use a weekday name or a date like 2026-10-08.`);
  }
  const today = todayInIsrael(now);
  const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const first = addDays(today, (weekday - todayWeekday + 7) % 7 || 7);
  return [first, addDays(first, 7)];
}
```

`src/api/delivery.ts`:
```ts
import type { HaziHinamClient } from "../client.js";
import { parseSiteDate } from "../dates.js";
import type { NextDeliveries } from "./types.js";

export interface Slot {
  shipmentId: number;
  date: string;
  dayName: string;
  from: string;
  to: string;
  available: boolean;
}

export interface AddressSlots {
  addressId: number;
  name: string;
  isDefault: boolean;
  slots: Slot[];
}

export async function listDeliverySlots(c: HaziHinamClient): Promise<AddressSlots[]> {
  const { Addresses } = await c.get<NextDeliveries>("delivery/getNextDeliveries");
  return Addresses.map(address => ({
    addressId: address.Id,
    name: address.Name,
    isDefault: address.IsDefault,
    slots: address.ShipmentsByDate.flatMap(day =>
      day.Shipments.map(s => ({
        shipmentId: s.ShipmentId,
        date: parseSiteDate(s.Date),
        dayName: s.DOW,
        from: s.Time.From,
        to: s.Time.To,
        available: !s.IsClosedShipment && !s.IsExceeds,
      })),
    ),
  }));
}

export function filterSlotsByDates(addresses: AddressSlots[], dates: string[]): AddressSlots[] {
  const wanted = new Set(dates);
  return addresses.map(a => ({ ...a, slots: a.slots.filter(s => wanted.has(s.date)) }));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: delivery slots and weekday resolution"
```

---

### Task 5: Usual order: snapshot and replay

**Files:**
- Create: `src/usual-order.ts`
- Test: `test/usual-order.test.ts`

**Interfaces:**
- Consumes: `getCart`, `getCartSummary`, `setItemQuantity`, `clearCart` (Task 3), `Store` (Task 1), `AuthRequired`, `HaziHinamError`.
- Produces:
  - `USUAL_ORDER_FILE = "usual-order.json"`
  - `interface UsualItem { itemId: number; barcode: string; name: string; quantity: number; type: number }`
  - `interface UsualOrder { savedAt: string; items: UsualItem[] }`
  - `snapshotCart(c, store, now: Date): Promise<UsualOrder>`
  - `loadUsualOrder(store): Promise<UsualOrder>` (throws `HaziHinamError("NO_USUAL_ORDER")` if absent)
  - `interface MissingItem { item: UsualItem; reason: "out_of_stock" | "not_in_cart" | "rejected"; detail?: string }`
  - `interface ReplayReport { added: UsualItem[]; missing: MissingItem[]; summary: CartSummary }`
  - `replayUsualOrder(c, store): Promise<ReplayReport>`

Compatibility: the file the user already has at `~/.config/hazi-hinam/usual-order.json` carries extra fields (`category`, `unit`, `priceNow`, `source`, `cartTotalAtSave`). They are ignored; `itemId`, `barcode`, `name`, `quantity`, `type` and `savedAt` match this shape.

- [ ] **Step 1: Write the failing test**

`test/usual-order.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HaziHinamClient } from "../src/client.js";
import { loadUsualOrder, replayUsualOrder, snapshotCart, USUAL_ORDER_FILE } from "../src/usual-order.js";
import { fakeFetch, item, tempStore } from "./helpers.js";

const summary = { Price_NET_TOTAL: 50, Price_Shipping: 35.9, Price_Savings: 0, Price_Order_Total: 85.9, Minimum_Cart_Price_NET: 499.9 };
const cartOf = (...items: ReturnType<typeof item>[]) => ({ CartItems: { Categories: [{ Id: 1, Name: "c", Items: items }] } });

describe("snapshotCart", () => {
  it("saves every cart line with its amount and unit type", async () => {
    const store = await tempStore();
    const f = fakeFetch({
      "GET item/getItemsInCart": cartOf(
        item(1, { Cart: { Quantity: 2, ItemQuantityType: 1 } }),
        item(2, { Cart: { Quantity: 0.5, ItemQuantityType: 2 } }),
        item(3, { Cart: { Quantity: 0, ItemQuantityType: 1 } }),
      ),
    });
    const saved = await snapshotCart(new HaziHinamClient("t", { fetch: f.fetch }), store, new Date("2026-01-01T00:00:00Z"));
    expect(saved.items).toEqual([
      { itemId: 1, barcode: "72900000001", name: "Item 1", quantity: 2, type: 1 },
      { itemId: 2, barcode: "72900000002", name: "Item 2", quantity: 0.5, type: 2 },
    ]);
    expect(await store.readJson(USUAL_ORDER_FILE)).toEqual(saved);
  });

  it("refuses to save an empty cart", async () => {
    const f = fakeFetch({ "GET item/getItemsInCart": cartOf() });
    await expect(snapshotCart(new HaziHinamClient("t", { fetch: f.fetch }), await tempStore(), new Date())).rejects.toMatchObject({ code: "EMPTY_CART" });
  });
});

describe("replayUsualOrder", () => {
  it("empties the cart, sets each amount, and reports what did not make it", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, {
      savedAt: "2026-01-01T00:00:00.000Z",
      items: [
        { itemId: 1, barcode: "b1", name: "Milk", quantity: 3, type: 1 },
        { itemId: 2, barcode: "b2", name: "Tomatoes", quantity: 1.5, type: 2 },
        { itemId: 3, barcode: "b3", name: "Gone", quantity: 1, type: 1 },
      ],
    });
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": (call: { body: any }) =>
        call.body.Object.ItemId === 3
          ? { json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "Item not available" } } }
          : { json: { IsOK: true, Results: null, ErrorResponse: null } },
      "GET item/getItemsInCart": cartOf(
        item(1, { Cart: { Quantity: 3, ItemQuantityType: 1 } }),
        item(2, { IsInStock: false, Cart: null }),
      ),
      "GET order/cartSummary": { CartSummary: summary },
    });

    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);

    expect(f.calls[0].method).toBe("DELETE");
    const sets = f.calls.filter(c => c.path === "item/addItemToCart").map(c => c.body.Object);
    expect(sets).toEqual([
      { ItemId: 1, Quantity: 3, Type: 1, IsCalculateCart: false },
      { ItemId: 2, Quantity: 1.5, Type: 2, IsCalculateCart: false },
      { ItemId: 3, Quantity: 1, Type: 1, IsCalculateCart: true },
    ]);
    expect(report.added.map(i => i.itemId)).toEqual([1]);
    expect(report.missing).toEqual([
      { item: expect.objectContaining({ itemId: 2 }), reason: "out_of_stock" },
      { item: expect.objectContaining({ itemId: 3 }), reason: "rejected", detail: expect.stringContaining("Item not available") },
    ]);
    expect(report.summary).toEqual(summary);
  });

  it("stops on AuthRequired instead of reporting every item as rejected", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, { savedAt: "x", items: [{ itemId: 1, barcode: "b", name: "n", quantity: 1, type: 1 }] });
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": () => ({ status: 401, text: "" }),
    });
    await expect(replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("explains how to create the usual order when none is saved", async () => {
    await expect(loadUsualOrder(await tempStore())).rejects.toMatchObject({ code: "NO_USUAL_ORDER" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/usual-order.test.ts`
Expected: FAIL, cannot resolve `../src/usual-order.js`.

- [ ] **Step 3: Implement**

`src/usual-order.ts`:
```ts
import { clearCart, getCart, getCartSummary, setItemQuantity } from "./api/cart.js";
import type { CartSummary } from "./api/types.js";
import type { HaziHinamClient } from "./client.js";
import { AuthRequired, HaziHinamError } from "./errors.js";
import type { Store } from "./store.js";

// Kept locally because the site's shopping lists store which products, never how many.
export const USUAL_ORDER_FILE = "usual-order.json";

export interface UsualItem {
  itemId: number;
  barcode: string;
  name: string;
  quantity: number;
  type: number;
}

export interface UsualOrder {
  savedAt: string;
  items: UsualItem[];
}

export interface MissingItem {
  item: UsualItem;
  reason: "out_of_stock" | "not_in_cart" | "rejected";
  detail?: string;
}

export interface ReplayReport {
  added: UsualItem[];
  missing: MissingItem[];
  summary: CartSummary;
}

export async function snapshotCart(c: HaziHinamClient, store: Store, now: Date): Promise<UsualOrder> {
  const items = (await getCart(c))
    .filter(i => i.Cart && i.Cart.Quantity > 0)
    .map(i => ({ itemId: i.Id, barcode: i.BarKod, name: i.Name, quantity: i.Cart!.Quantity, type: i.Cart!.ItemQuantityType }));
  if (items.length === 0) {
    throw new HaziHinamError("EMPTY_CART", "The cart is empty. Fill it on the website with your usual amounts, then save again.");
  }
  const usual: UsualOrder = { savedAt: now.toISOString(), items };
  await store.writeJson(USUAL_ORDER_FILE, usual);
  return usual;
}

export async function loadUsualOrder(store: Store): Promise<UsualOrder> {
  const usual = await store.readJson<UsualOrder>(USUAL_ORDER_FILE);
  if (!usual?.items?.length) {
    throw new HaziHinamError("NO_USUAL_ORDER", "No usual order saved yet. Fill the cart on the website with your usual amounts, then run save_usual_order.");
  }
  return usual;
}

export async function replayUsualOrder(c: HaziHinamClient, store: Store): Promise<ReplayReport> {
  const usual = await loadUsualOrder(store);
  await clearCart(c);

  const rejected = new Map<number, string>();
  for (const [index, line] of usual.items.entries()) {
    try {
      await setItemQuantity(c, {
        itemId: line.itemId,
        quantity: line.quantity,
        type: line.type,
        recalculate: index === usual.items.length - 1,
      });
    } catch (error) {
      if (error instanceof AuthRequired) throw error;
      rejected.set(line.itemId, (error as Error).message);
    }
  }

  const cart = new Map((await getCart(c)).map(i => [i.Id, i]));
  const added: UsualItem[] = [];
  const missing: MissingItem[] = [];
  for (const line of usual.items) {
    const inCart = cart.get(line.itemId);
    if (rejected.has(line.itemId)) missing.push({ item: line, reason: "rejected", detail: rejected.get(line.itemId) });
    else if (inCart?.Cart && inCart.Cart.Quantity > 0) added.push(line);
    else if (inCart && !inCart.IsInStock) missing.push({ item: line, reason: "out_of_stock" });
    else missing.push({ item: line, reason: "not_in_cart" });
  }
  return { added, missing, summary: await getCartSummary(c) };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: save the cart as a usual order and replay it with exact amounts"
```

---

### Task 6: Operation registry, context, account/orders/cart operations

**Files:**
- Create: `src/context.ts`, `src/operations/define.ts`, `src/operations/account.ts`, `src/operations/orders.ts`, `src/operations/cart.ts`, `src/operations/index.ts`
- Test: `test/operations.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - `interface Context { store: Store; now(): Date; clientFor(token: string): HaziHinamClient; client(): Promise<HaziHinamClient> }`
  - `createContext(options?: { store?: Store; fetch?: typeof fetch; now?: () => Date }): Context`
  - `interface Operation<S extends z.ZodRawShape = z.ZodRawShape> { name: string; description: string; input: S; readOnly: boolean; destructive?: boolean; run(ctx: Context, args: z.infer<z.ZodObject<S>>): Promise<unknown> }`
  - `defineOperation<S>(op: Operation<S>): Operation`
  - `operations: Operation[]` in `src/operations/index.ts`; Task 7 appends delivery and usual-order operations.
  - Operation names (snake_case; the CLI uses kebab-case): `status`, `list_orders`, `get_order_items`, `copy_order_to_cart`, `get_cart`, `set_cart_item`, `clear_cart`

Numeric inputs use `z.coerce.number()` so the same schema accepts MCP numbers and CLI strings.

- [ ] **Step 1: Write the failing test**

`test/operations.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createContext } from "../src/context.js";
import { operations } from "../src/operations/index.js";
import { fakeFetch, item, tempStore } from "./helpers.js";

const now = new Date("2026-09-29T19:00:00Z");
const op = (name: string) => {
  const found = operations.find(o => o.name === name);
  if (!found) throw new Error(`no operation ${name}`);
  return found;
};
const run = (name: string, ctx: ReturnType<typeof createContext>, args: Record<string, unknown> = {}) =>
  op(name).run(ctx, z.object(op(name).input).parse(args));

async function signedIn(routes: Record<string, unknown>) {
  const store = await tempStore();
  await store.saveSession("tok", 172800, now);
  const f = fakeFetch(routes);
  return { ctx: createContext({ store, fetch: f.fetch, now: () => now }), calls: f.calls, store };
}

describe("registry", () => {
  it("has unique snake_case names and a description for each operation", () => {
    const names = operations.map(o => o.name);
    expect(new Set(names).size).toBe(names.length);
    for (const o of operations) {
      expect(o.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(o.description.length).toBeGreaterThan(20);
    }
  });
});

describe("status", () => {
  it("reports signed out without any network call", async () => {
    const f = fakeFetch({});
    const ctx = createContext({ store: await tempStore(), fetch: f.fetch, now: () => now });
    expect(await run("status", ctx)).toMatchObject({ signedIn: false });
    expect(f.calls).toHaveLength(0);
  });

  it("reports the login expiry and cart size when signed in", async () => {
    const { ctx } = await signedIn({ "GET user/info": { UserInfo: {}, CartItemsCount: 4 } });
    expect(await run("status", ctx)).toEqual({ signedIn: true, expiresAt: "2026-10-01T19:00:00.000Z", cartItems: 4 });
  });
});

describe("orders and cart", () => {
  it("fails with AUTH_REQUIRED when there is no session", async () => {
    const ctx = createContext({ store: await tempStore(), fetch: fakeFetch({}).fetch, now: () => now });
    await expect(run("list_orders", ctx)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("summarizes recent orders", async () => {
    const { ctx } = await signedIn({
      "GET order/history": {
        Orders: [{
          Id: 11, Date: "20/09/2026", Total: 100, Order_Status: 5, Order_Status_Desc: "done", IsDraftOrder: false, ShippingTypeDesc: "delivery",
          Shipment: { ShipmentId: 1, DOW: "רביעי", Date: "30/09/2026", Time: { From: "19:00", To: "21:00" }, IsClosedShipment: false, IsExceeds: false, IsSelfPickUp: false },
        }],
      },
    });
    expect(await run("list_orders", ctx, { limit: "1" })).toEqual([
      { orderId: 11, orderedOn: "2026-09-20", total: 100, status: "done", delivery: { date: "2026-09-30", from: "19:00", to: "21:00" } },
    ]);
  });

  it("shows the cart with amounts and totals", async () => {
    const summary = { Price_NET_TOTAL: 20, Price_Shipping: 35.9, Price_Savings: 0, Price_Order_Total: 55.9, Minimum_Cart_Price_NET: 499.9 };
    const { ctx } = await signedIn({
      "GET item/getItemsInCart": { CartItems: { Categories: [{ Id: 1, Name: "c", Items: [item(1, { Cart: { Quantity: 2, ItemQuantityType: 1 } })] }] } },
      "GET order/cartSummary": { CartSummary: summary },
    });
    expect(await run("get_cart", ctx)).toEqual({
      items: [{ itemId: 1, name: "Item 1", quantity: 2, unit: "unit", inStock: true }],
      total: { products: 20, delivery: 35.9, savings: 0, total: 55.9, minimumForDelivery: 499.9 },
    });
  });

  it("set_cart_item sends an absolute amount", async () => {
    const { ctx, calls } = await signedIn({ "POST item/addItemToCart": null });
    await run("set_cart_item", ctx, { itemId: "5", quantity: "1.5", unit: "kg" });
    expect(calls[0].body).toEqual({ Object: { ItemId: 5, Quantity: 1.5, Type: 2, IsCalculateCart: true } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operations.test.ts`
Expected: FAIL, cannot resolve `../src/context.js`.

- [ ] **Step 3: Implement**

`src/context.ts`:
```ts
import { HaziHinamClient } from "./client.js";
import { configDir } from "./config.js";
import { AuthRequired } from "./errors.js";
import { Store } from "./store.js";

export interface Context {
  store: Store;
  now(): Date;
  clientFor(token: string): HaziHinamClient;
  client(): Promise<HaziHinamClient>;
}

export function createContext(options: { store?: Store; fetch?: typeof fetch; now?: () => Date } = {}): Context {
  const store = options.store ?? new Store(configDir());
  const now = options.now ?? (() => new Date());
  const clientFor = (token: string) => new HaziHinamClient(token, { fetch: options.fetch });
  return {
    store,
    now,
    clientFor,
    async client() {
      const session = await store.loadSession(now());
      if (!session) throw new AuthRequired();
      return clientFor(session.accessToken);
    },
  };
}
```

`src/operations/define.ts`:
```ts
import type { z } from "zod";
import type { Context } from "../context.js";

export interface Operation<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: S;
  readOnly: boolean;
  destructive?: boolean;
  run(ctx: Context, args: z.infer<z.ZodObject<S>>): Promise<unknown>;
}

export function defineOperation<S extends z.ZodRawShape>(op: Operation<S>): Operation {
  return op as unknown as Operation;
}

export const unitName = (type: number) => (type === 2 ? "kg" : "unit");
export const unitType = (unit: "unit" | "kg") => (unit === "kg" ? 2 : 1);
```

`src/operations/account.ts`:
```ts
import { getUserInfo } from "../api/account.js";
import { defineOperation } from "./define.js";

export const status = defineOperation({
  name: "status",
  description: "Check whether the user is signed in to Hazi Hinam, when the 48-hour login expires, and how many items are in the cart.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const session = await ctx.store.loadSession(ctx.now());
    if (!session) return { signedIn: false, hint: "Ask the user to run `hazi-hinam login` in a terminal." };
    const info = await getUserInfo(ctx.clientFor(session.accessToken));
    return { signedIn: info.UserInfo !== null, expiresAt: session.expiresAt, cartItems: info.CartItemsCount };
  },
});
```

`src/operations/orders.ts`:
```ts
import { z } from "zod";
import { copyOrderToCart, getOrderItems, listOrders } from "../api/orders.js";
import { parseSiteDate } from "../dates.js";
import { defineOperation } from "./define.js";

export const listOrdersOp = defineOperation({
  name: "list_orders",
  description: "List the user's past Hazi Hinam orders, newest first, with order date, total and delivery slot.",
  input: { limit: z.coerce.number().int().min(1).max(100).default(5) },
  readOnly: true,
  async run(ctx, { limit }) {
    const orders = await listOrders(await ctx.client(), limit);
    return orders.map(o => ({
      orderId: o.Id,
      orderedOn: parseSiteDate(o.Date),
      total: o.Total,
      status: o.Order_Status_Desc,
      delivery: o.Shipment ? { date: parseSiteDate(o.Shipment.Date), from: o.Shipment.Time.From, to: o.Shipment.Time.To } : null,
    }));
  },
});

export const getOrderItemsOp = defineOperation({
  name: "get_order_items",
  description: "List the products in one past order (names and ids; the site does not return the original amounts).",
  input: { orderId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { orderId }) {
    const items = await getOrderItems(await ctx.client(), orderId);
    return items.map(i => ({ itemId: i.Id, barcode: i.BarKod, name: i.Name, inStock: i.IsInStock }));
  },
});

export const copyOrderToCartOp = defineOperation({
  name: "copy_order_to_cart",
  description: "Add every product from a past order to the cart using the site's own reorder. Amounts are reset to the site's defaults (1 unit / minimum weight), so prefer prepare_usual_order when exact amounts matter.",
  input: { orderId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { orderId }) {
    await copyOrderToCart(await ctx.client(), orderId);
    return { copied: orderId, note: "Amounts are the site's defaults. Review them in the cart." };
  },
});
```

`src/operations/cart.ts`:
```ts
import { z } from "zod";
import { clearCart, getCart, getCartSummary, setItemQuantity } from "../api/cart.js";
import type { CartSummary } from "../api/types.js";
import { defineOperation, unitName, unitType } from "./define.js";

export const describeTotal = (s: CartSummary) => ({
  products: s.Price_NET_TOTAL,
  delivery: s.Price_Shipping,
  savings: s.Price_Savings,
  total: s.Price_Order_Total,
  minimumForDelivery: s.Minimum_Cart_Price_NET,
});

export const getCartOp = defineOperation({
  name: "get_cart",
  description: "Show what is in the user's Hazi Hinam cart right now, with amounts and the total including delivery.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const client = await ctx.client();
    const [items, summary] = await Promise.all([getCart(client), getCartSummary(client)]);
    return {
      items: items.map(i => ({
        itemId: i.Id,
        name: i.Name,
        quantity: i.Cart?.Quantity ?? 0,
        unit: unitName(i.Cart?.ItemQuantityType ?? 1),
        inStock: i.IsInStock,
      })),
      total: describeTotal(summary),
    };
  },
});

export const setCartItemOp = defineOperation({
  name: "set_cart_item",
  description: "Set the amount of one product in the cart (replaces the current amount; 0 removes it). Unit is 'unit' or 'kg'.",
  input: {
    itemId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().min(0).max(100),
    unit: z.enum(["unit", "kg"]).default("unit"),
  },
  readOnly: false,
  async run(ctx, { itemId, quantity, unit }) {
    await setItemQuantity(await ctx.client(), { itemId, quantity, type: unitType(unit), recalculate: true });
    return { itemId, quantity, unit };
  },
});

export const clearCartOp = defineOperation({
  name: "clear_cart",
  description: "Remove everything from the user's Hazi Hinam cart. Confirm with the user first.",
  input: {},
  readOnly: false,
  destructive: true,
  async run(ctx) {
    await clearCart(await ctx.client());
    return { cleared: true };
  },
});
```

`src/operations/index.ts`:
```ts
import { status } from "./account.js";
import { clearCartOp, getCartOp, setCartItemOp } from "./cart.js";
import type { Operation } from "./define.js";
import { copyOrderToCartOp, getOrderItemsOp, listOrdersOp } from "./orders.js";

export type { Operation } from "./define.js";

// The single list the CLI and the MCP server are generated from. A new capability is one entry here.
export const operations: Operation[] = [
  status,
  listOrdersOp,
  getOrderItemsOp,
  copyOrderToCartOp,
  getCartOp,
  setCartItemOp,
  clearCartOp,
];
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: operation registry with account, order and cart operations"
```

---

### Task 7: Delivery and usual-order operations

**Files:**
- Create: `src/operations/delivery.ts`, `src/operations/usual-order.ts`
- Modify: `src/operations/index.ts` (append four operations)
- Test: `test/operations-reorder.test.ts`

**Interfaces:**
- Consumes: `listDeliverySlots`, `filterSlotsByDates`, `resolveDay` (Task 4); `snapshotCart`, `loadUsualOrder`, `replayUsualOrder` (Task 5); `describeTotal`, `unitName` (Task 6); `SITE_ORIGIN` (Task 2).
- Produces operations: `list_delivery_slots { day?: string }`, `save_usual_order {}`, `show_usual_order {}`, `prepare_usual_order { day?: string }`.
  - `prepare_usual_order` returns `{ cart: { itemsAdded, missing, total }, delivery: { dates, addresses } | null, nextStep }` and **never places the order**.

- [ ] **Step 1: Write the failing test**

`test/operations-reorder.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createContext } from "../src/context.js";
import { operations } from "../src/operations/index.js";
import { USUAL_ORDER_FILE } from "../src/usual-order.js";
import { fakeFetch, item, tempStore } from "./helpers.js";

const now = new Date("2026-09-29T19:00:00Z");
const run = (name: string, ctx: ReturnType<typeof createContext>, args: Record<string, unknown> = {}) => {
  const op = operations.find(o => o.name === name)!;
  return op.run(ctx, z.object(op.input).parse(args));
};

const summary = { Price_NET_TOTAL: 30, Price_Shipping: 35.9, Price_Savings: 0, Price_Order_Total: 65.9, Minimum_Cart_Price_NET: 499.9 };
const slot = (id: number, date: string, closed = false) => ({
  ShipmentId: id, DOW: "חמישי", Date: date, Time: { From: "19:00", To: "21:00" }, IsClosedShipment: closed, IsExceeds: false, IsSelfPickUp: false,
});
const deliveries = {
  Addresses: [{
    Id: 7, Name: "Home", IsDefault: true,
    ShipmentsByDate: [
      { DOW: "חמישי", Date: "01/10/2026", Shipments: [slot(1, "01/10/2026", true)] },
      { DOW: "שישי", Date: "02/10/2026", Shipments: [slot(5, "02/10/2026")] },
      { DOW: "חמישי", Date: "08/10/2026", Shipments: [slot(2, "08/10/2026")] },
    ],
  }],
};

async function signedIn(routes: Record<string, unknown>) {
  const store = await tempStore();
  await store.saveSession("tok", 172800, now);
  const f = fakeFetch(routes);
  return { ctx: createContext({ store, fetch: f.fetch, now: () => now }), calls: f.calls, store };
}

describe("list_delivery_slots", () => {
  it("shows both upcoming Thursdays for 'thursday'", async () => {
    const { ctx } = await signedIn({ "GET delivery/getNextDeliveries": deliveries });
    const result = (await run("list_delivery_slots", ctx, { day: "thursday" })) as any;
    expect(result.dates).toEqual(["2026-10-01", "2026-10-08"]);
    expect(result.addresses[0].slots.map((s: any) => [s.date, s.available])).toEqual([
      ["2026-10-01", false],
      ["2026-10-08", true],
    ]);
  });
});

describe("usual order operations", () => {
  it("save_usual_order snapshots the cart", async () => {
    const { ctx, store } = await signedIn({
      "GET item/getItemsInCart": { CartItems: { Categories: [{ Id: 1, Name: "c", Items: [item(1, { Cart: { Quantity: 2, ItemQuantityType: 1 } })] }] } },
    });
    expect(await run("save_usual_order", ctx)).toMatchObject({ saved: 1 });
    expect(await store.readJson(USUAL_ORDER_FILE)).toMatchObject({ items: [{ itemId: 1, quantity: 2 }] });
  });

  it("prepare_usual_order fills the cart, finds slots, and hands off to the website", async () => {
    const { ctx, calls, store } = await signedIn({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": null,
      "GET item/getItemsInCart": { CartItems: { Categories: [{ Id: 1, Name: "c", Items: [item(1, { Cart: { Quantity: 2, ItemQuantityType: 1 } })] }] } },
      "GET order/cartSummary": { CartSummary: summary },
      "GET delivery/getNextDeliveries": deliveries,
    });
    await store.writeJson(USUAL_ORDER_FILE, { savedAt: "x", items: [{ itemId: 1, barcode: "b", name: "Milk", quantity: 2, type: 1 }] });

    const result = (await run("prepare_usual_order", ctx, { day: "thursday" })) as any;

    expect(result.cart).toEqual({ itemsAdded: 1, missing: [], total: expect.objectContaining({ total: 65.9 }) });
    expect(result.delivery.dates).toEqual(["2026-10-01", "2026-10-08"]);
    expect(result.nextStep).toMatch(/shop\.hazi-hinam\.co\.il/);
    expect(calls.some(c => c.path.startsWith("order/post"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/operations-reorder.test.ts`
Expected: FAIL, `operations.find(...)` is undefined for `list_delivery_slots`.

- [ ] **Step 3: Implement**

`src/operations/delivery.ts`:
```ts
import { z } from "zod";
import { filterSlotsByDates, listDeliverySlots } from "../api/delivery.js";
import type { Context } from "../context.js";
import { resolveDay } from "../dates.js";
import { defineOperation } from "./define.js";

export async function slotsForDay(ctx: Context, day: string | undefined) {
  const addresses = await listDeliverySlots(await ctx.client());
  if (!day) return { dates: null, addresses };
  const dates = resolveDay(day, ctx.now());
  return { dates, addresses: filterSlotsByDates(addresses, dates) };
}

export const listDeliverySlotsOp = defineOperation({
  name: "list_delivery_slots",
  description: "List delivery time slots for each of the user's addresses (about 12 days ahead). `day` accepts a weekday (English or Hebrew) or a date; a weekday returns the next two occurrences so the user can choose.",
  input: { day: z.string().max(40).optional() },
  readOnly: true,
  run: (ctx, { day }) => slotsForDay(ctx, day),
});
```

`src/operations/usual-order.ts`:
```ts
import { z } from "zod";
import { SITE_ORIGIN } from "../client.js";
import { loadUsualOrder, replayUsualOrder, snapshotCart } from "../usual-order.js";
import { describeTotal } from "./cart.js";
import { defineOperation, unitName } from "./define.js";
import { slotsForDay } from "./delivery.js";

export const saveUsualOrderOp = defineOperation({
  name: "save_usual_order",
  description: "Save the current cart (products and exact amounts) as the user's usual order, stored only on this computer.",
  input: {},
  readOnly: false,
  async run(ctx) {
    const usual = await snapshotCart(await ctx.client(), ctx.store, ctx.now());
    return { saved: usual.items.length, savedAt: usual.savedAt };
  },
});

export const showUsualOrderOp = defineOperation({
  name: "show_usual_order",
  description: "Show the user's saved usual order (products and amounts). Reads only the local file.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const usual = await loadUsualOrder(ctx.store);
    return {
      savedAt: usual.savedAt,
      items: usual.items.map(i => ({ itemId: i.itemId, name: i.name, quantity: i.quantity, unit: unitName(i.type) })),
    };
  },
});

export const prepareUsualOrderOp = defineOperation({
  name: "prepare_usual_order",
  description: "Replace the cart with the user's usual order at the saved amounts, then list delivery slots for `day`. Clears the current cart first, so confirm with the user if it has other items. Does not place or pay for the order: the user finishes on the website.",
  input: { day: z.string().max(40).optional() },
  readOnly: false,
  destructive: true,
  async run(ctx, { day }) {
    const report = await replayUsualOrder(await ctx.client(), ctx.store);
    const delivery = day ? await slotsForDay(ctx, day) : null;
    return {
      cart: {
        itemsAdded: report.added.length,
        missing: report.missing.map(m => ({ name: m.item.name, reason: m.reason, ...(m.detail ? { detail: m.detail } : {}) })),
        total: describeTotal(report.summary),
      },
      delivery,
      nextStep: `Open ${SITE_ORIGIN}/, choose the delivery slot, and pay there. This tool never places or pays for orders.`,
    };
  },
});
```

Modify `src/operations/index.ts`, full new content:
```ts
import { status } from "./account.js";
import { clearCartOp, getCartOp, setCartItemOp } from "./cart.js";
import type { Operation } from "./define.js";
import { listDeliverySlotsOp } from "./delivery.js";
import { copyOrderToCartOp, getOrderItemsOp, listOrdersOp } from "./orders.js";
import { prepareUsualOrderOp, saveUsualOrderOp, showUsualOrderOp } from "./usual-order.js";

export type { Operation } from "./define.js";

// The single list the CLI and the MCP server are generated from. A new capability is one entry here.
export const operations: Operation[] = [
  status,
  listOrdersOp,
  getOrderItemsOp,
  copyOrderToCartOp,
  getCartOp,
  setCartItemOp,
  clearCartOp,
  listDeliverySlotsOp,
  saveUsualOrderOp,
  showUsualOrderOp,
  prepareUsualOrderOp,
];
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: delivery slot and usual-order operations"
```

---

### Task 8: CLI with token login

**Files:**
- Create: `src/cli.ts`, `src/bin.ts`, `src/index.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `operations`, `Context`, `formatError`, `AuthRequired`, `getUserInfo`, `HaziHinamError`.
- Produces:
  - `interface Io { stdout(text: string): void; stderr(text: string): void; readLine(prompt: string): Promise<string> }`
  - `main(argv: string[], io: Io, ctx: Context): Promise<number>`. Exit codes: 0 ok, 1 error, 2 usage, 3 `AUTH_REQUIRED`.
  - `verifyAndSaveToken(ctx: Context, token: string): Promise<Session>`, reused by browser login in Task 10
  - Commands: `help`, `login [--browser]`, `logout`, `mcp`, and every operation in kebab-case with `--flag value` arguments.

The `mcp` command imports `./mcp.js` lazily, which Task 9 creates. Until then `hazi-hinam mcp` fails at runtime; no test in this task calls it.

- [ ] **Step 1: Write the failing test**

`test/cli.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { main, type Io } from "../src/cli.js";
import { createContext } from "../src/context.js";
import { fakeFetch, tempStore } from "./helpers.js";

const now = new Date("2026-09-29T19:00:00Z");

function makeIo(lines: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: t => void out.push(t),
    stderr: t => void err.push(t),
    readLine: async () => lines.shift() ?? "",
  };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

describe("cli", () => {
  it("prints help listing every command", async () => {
    const { io, out } = makeIo();
    const ctx = createContext({ store: await tempStore(), fetch: fakeFetch({}).fetch, now: () => now });
    expect(await main(["help"], io, ctx)).toBe(0);
    for (const cmd of ["login", "logout", "mcp", "list-orders", "prepare-usual-order"]) expect(out()).toContain(cmd);
  });

  it("runs an operation with flags and prints JSON", async () => {
    const store = await tempStore();
    await store.saveSession("tok", 172800, now);
    const f = fakeFetch({ "GET order/history": { Orders: [] } });
    const { io, out } = makeIo();
    expect(await main(["list-orders", "--limit", "2"], io, createContext({ store, fetch: f.fetch, now: () => now }))).toBe(0);
    expect(JSON.parse(out())).toEqual([]);
  });

  it("exits 3 with a login hint when signed out", async () => {
    const { io, err } = makeIo();
    const ctx = createContext({ store: await tempStore(), fetch: fakeFetch({}).fetch, now: () => now });
    expect(await main(["get-cart"], io, ctx)).toBe(3);
    expect(err()).toMatch(/AUTH_REQUIRED.*hazi-hinam login/);
  });

  it("exits 2 for an unknown command and 1 for bad arguments", async () => {
    const store = await tempStore();
    await store.saveSession("tok", 172800, now);
    const ctx = createContext({ store, fetch: fakeFetch({}).fetch, now: () => now });
    expect(await main(["fly"], makeIo().io, ctx)).toBe(2);
    const { io, err } = makeIo();
    expect(await main(["get-order-items", "--orderId", "abc"], io, ctx)).toBe(1);
    expect(err()).toMatch(/BAD_ARGS/);
  });

  it("login verifies a pasted token before saving it", async () => {
    const store = await tempStore();
    const f = fakeFetch({ "GET user/info": { UserInfo: {}, CartItemsCount: 0 } });
    const { io, out } = makeIo(["  tok123  "]);
    expect(await main(["login"], io, createContext({ store, fetch: f.fetch, now: () => now }))).toBe(0);
    expect(f.calls[0].headers.get("authorization")).toBe("Bearer tok123");
    expect(await store.loadSession(now)).toMatchObject({ accessToken: "tok123", expiresAt: "2026-10-01T19:00:00.000Z" });
    expect(out()).toMatch(/Signed in/);
  });

  it("login rejects a token the site does not recognize", async () => {
    const store = await tempStore();
    const f = fakeFetch({ "GET user/info": { UserInfo: null, CartItemsCount: 0 } });
    expect(await main(["login"], makeIo(["bad"]).io, createContext({ store, fetch: f.fetch, now: () => now }))).toBe(3);
    expect(await store.loadSession(now)).toBeUndefined();
  });

  it("logout removes the session", async () => {
    const store = await tempStore();
    await store.saveSession("tok", 172800, now);
    expect(await main(["logout"], makeIo().io, createContext({ store, now: () => now }))).toBe(0);
    expect(await store.loadSession(now)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL, cannot resolve `../src/cli.js`.

- [ ] **Step 3: Implement**

`src/cli.ts`:
```ts
import { z } from "zod";
import { getUserInfo } from "./api/account.js";
import type { Context } from "./context.js";
import { AuthRequired, formatError, HaziHinamError } from "./errors.js";
import { operations } from "./operations/index.js";
import type { Session } from "./store.js";

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readLine(prompt: string): Promise<string>;
}

const LOGIN_LIFETIME_SECONDS = 172800;
const commandName = (operationName: string) => operationName.replaceAll("_", "-");

function helpText(): string {
  const width = Math.max(...operations.map(o => commandName(o.name).length), 16);
  const lines = operations.map(o => `  ${commandName(o.name).padEnd(width)}  ${o.description}`);
  return [
    "Usage: hazi-hinam <command> [--flag value ...]",
    "",
    "Session:",
    `  ${"login".padEnd(width)}  Paste the access token from your own browser login (or --browser to capture it)`,
    `  ${"logout".padEnd(width)}  Forget the saved login`,
    `  ${"mcp".padEnd(width)}  Run the MCP server on stdio`,
    "",
    "Commands:",
    ...lines,
    "",
    "Output is JSON. Exit codes: 0 ok, 1 error, 2 usage, 3 sign-in required.",
    "",
  ].join("\n");
}

function parseFlags(args: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new HaziHinamError("BAD_ARGS", `Unexpected argument "${arg}"`);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return flags;
}

export async function verifyAndSaveToken(ctx: Context, token: string): Promise<Session> {
  const info = await getUserInfo(ctx.clientFor(token));
  if (info.UserInfo === null) throw new AuthRequired("The site did not accept that token. Log in again on the website and copy a fresh one.");
  return ctx.store.saveSession(token, LOGIN_LIFETIME_SECONDS, ctx.now());
}

async function login(flags: Record<string, string | true>, io: Io, ctx: Context): Promise<number> {
  let token: string;
  if (flags.browser) {
    const { captureTokenFromBrowser } = await import("./browser-login.js");
    token = await captureTokenFromBrowser(io);
  } else {
    io.stderr(
      "Log in at https://shop.hazi-hinam.co.il in your browser. Then open DevTools → Network,\n" +
        "select the request named \"Login\", open Response, and copy the access_token value.\n",
    );
    token = (await io.readLine("access_token: ")).trim();
  }
  if (!token) throw new HaziHinamError("BAD_ARGS", "No token entered.");
  const session = await verifyAndSaveToken(ctx, token);
  io.stdout(`Signed in. The login is valid until ${session.expiresAt}.\n`);
  return 0;
}

export async function main(argv: string[], io: Io, ctx: Context): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!command || command === "help" || command === "--help") {
      io.stdout(helpText());
      return 0;
    }
    if (command === "login") return await login(parseFlags(rest), io, ctx);
    if (command === "logout") {
      await ctx.store.clearSession();
      io.stdout("Signed out.\n");
      return 0;
    }
    if (command === "mcp") {
      const { runMcpServer } = await import("./mcp.js");
      await runMcpServer(ctx);
      return 0;
    }
    const operation = operations.find(o => commandName(o.name) === command);
    if (!operation) {
      io.stderr(`Unknown command "${command}". Run \`hazi-hinam help\`.\n`);
      return 2;
    }
    const args = z.object(operation.input).parse(parseFlags(rest));
    const result = await operation.run(ctx, args);
    io.stdout(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (error) {
    io.stderr(formatError(error) + "\n");
    return error instanceof AuthRequired ? 3 : 1;
  }
}
```

`src/bin.ts`:
```ts
#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { main } from "./cli.js";
import { createContext } from "./context.js";

const io = {
  stdout: (text: string) => void process.stdout.write(text),
  stderr: (text: string) => void process.stderr.write(text),
  async readLine(prompt: string) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  },
};

const code = await main(process.argv.slice(2), io, createContext());
// `mcp` keeps running on stdio; every other command exits with its status.
if (process.argv[2] !== "mcp") process.exitCode = code;
```

`src/index.ts`:
```ts
export { HaziHinamClient, SITE_ORIGIN } from "./client.js";
export { createContext, type Context } from "./context.js";
export * from "./errors.js";
export { operations, type Operation } from "./operations/index.js";
export { Store, type Session } from "./store.js";
export { replayUsualOrder, snapshotCart, type ReplayReport, type UsualOrder } from "./usual-order.js";
```

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

`npm run build` will fail until Task 9 adds `src/mcp.ts` and Task 10 adds `src/browser-login.ts`, because of the two lazy imports. Build after Task 10.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: CLI generated from the operation registry, with token login"
```

---

### Task 9: MCP server

**Files:**
- Create: `src/mcp.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `operations`, `Context`, `formatError`.
- Produces: `createServer(ctx: Context): McpServer`, `runMcpServer(ctx: Context): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`test/mcp.test.ts`:
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createContext } from "../src/context.js";
import { createServer } from "../src/mcp.js";
import { operations } from "../src/operations/index.js";
import { fakeFetch, tempStore } from "./helpers.js";

const now = new Date("2026-09-29T19:00:00Z");

async function connect(ctx: ReturnType<typeof createContext>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(ctx).connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

describe("mcp server", () => {
  it("exposes every operation as a tool with safety annotations", async () => {
    const client = await connect(createContext({ store: await tempStore(), now: () => now }));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(operations.map(o => o.name).sort());
    const prepare = tools.find(t => t.name === "prepare_usual_order")!;
    expect(prepare.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.find(t => t.name === "list_orders")!.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("returns operation results as JSON text", async () => {
    const store = await tempStore();
    await store.saveSession("tok", 172800, now);
    const f = fakeFetch({ "GET order/history": { Orders: [] } });
    const client = await connect(createContext({ store, fetch: f.fetch, now: () => now }));
    const result = await client.callTool({ name: "list_orders", arguments: { limit: 3 } });
    expect(JSON.parse((result.content as any)[0].text)).toEqual([]);
  });

  it("returns errors as isError results the model can read", async () => {
    const client = await connect(createContext({ store: await tempStore(), fetch: fakeFetch({}).fetch, now: () => now }));
    const result = await client.callTool({ name: "get_cart", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toMatch(/AUTH_REQUIRED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL, cannot resolve `../src/mcp.js`.

- [ ] **Step 3: Implement**

`src/mcp.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Context } from "./context.js";
import { formatError } from "./errors.js";
import { operations } from "./operations/index.js";

const VERSION = "0.1.0";

const INSTRUCTIONS = [
  "Tools for the user's own Hazi Hinam (Israeli supermarket) online account.",
  "To reorder: call prepare_usual_order with the day the user asked for. It replaces the cart with the saved usual order at exact amounts and lists delivery slots.",
  "A weekday resolves to the next two occurrences; ask the user which date and slot they want.",
  "Report the total, any missing items, and the available slots.",
  "You cannot place or pay for orders. The user finishes on the website.",
  "If a tool returns AUTH_REQUIRED, ask the user to run `hazi-hinam login` in a terminal.",
  "If NO_USUAL_ORDER, ask the user to fill the cart on the website with their usual amounts, then call save_usual_order.",
].join(" ");

export function createServer(ctx: Context): McpServer {
  const server = new McpServer({ name: "hazi-hinam", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const operation of operations) {
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema: operation.input,
        annotations: {
          readOnlyHint: operation.readOnly,
          destructiveHint: operation.destructive ?? false,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await operation.run(ctx, args as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text" as const, text: formatError(error) }] };
        }
      },
    );
  }
  return server;
}

export async function runMcpServer(ctx: Context): Promise<void> {
  await createServer(ctx).connect(new StdioServerTransport());
}
```

If `registerTool`'s callback type rejects `(args: Record<string, unknown>)` under the installed SDK version, drop the parameter annotation and keep `args as never`. The SDK already validates the input against `operation.input` before calling the handler.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: MCP server generated from the operation registry"
```

---

### Task 10: Browser login (user solves the CAPTCHA; the tool captures the token)

**Files:**
- Create: `src/browser-login.ts`
- Modify: `package.json` (add `playwright-core` to `optionalDependencies`)
- Test: `test/browser-login.test.ts`

**Interfaces:**
- Consumes: `Io` (Task 8), `SITE_ORIGIN`, `HaziHinamError`.
- Produces: `extractToken(body: unknown): string`, `captureTokenFromBrowser(io: Io, timeoutMs?: number): Promise<string>`.

This opens the user's installed Chrome, visibly. The **user** types the password and solves the CAPTCHA. The tool only waits for the site's own `POST /proxy/Login` response and reads `access_token` from it. It never fills fields, clicks, or touches the CAPTCHA.

- [ ] **Step 1: Install and write the failing test**

Run: `npm install --save-optional playwright-core`

`test/browser-login.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { extractToken } from "../src/browser-login.js";

describe("extractToken", () => {
  it("reads access_token from the site's login response", () => {
    expect(extractToken({ access_token: "abc", expires_in: 172800, error: null })).toBe("abc");
  });

  it.each([null, {}, { access_token: "" }, { access_token: null, error: "invalid_grant" }])("rejects %j", body => {
    expect(() => extractToken(body)).toThrow(/did not contain an access token/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/browser-login.test.ts`
Expected: FAIL, cannot resolve `../src/browser-login.js`.

- [ ] **Step 3: Implement**

`src/browser-login.ts`:
```ts
import type { Io } from "./cli.js";
import { SITE_ORIGIN } from "./client.js";
import { HaziHinamError } from "./errors.js";

export function extractToken(body: unknown): string {
  const token = (body as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new HaziHinamError("LOGIN_FAILED", "The site's login response did not contain an access token. Check the username and password and try again.");
  }
  return token;
}

export async function captureTokenFromBrowser(io: Io, timeoutMs = 5 * 60_000): Promise<string> {
  let playwright: typeof import("playwright-core");
  try {
    playwright = await import("playwright-core");
  } catch {
    throw new HaziHinamError("BROWSER_UNAVAILABLE", "Browser login needs playwright-core (npm install playwright-core). Or run `hazi-hinam login` and paste the token.");
  }

  const browser = await playwright.chromium.launch({ channel: "chrome", headless: false });
  try {
    const page = await browser.newPage();
    io.stderr("A Chrome window opened. Log in to Hazi Hinam there yourself, including the CAPTCHA. It closes by itself afterwards.\n");
    const loginResponse = page.waitForResponse(
      r => new URL(r.url()).pathname === "/proxy/Login" && r.request().method() === "POST",
      { timeout: timeoutMs },
    );
    await page.goto(SITE_ORIGIN);
    return extractToken(await (await loginResponse).json());
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all PASS; `dist/bin.js` exists.

- [ ] **Step 5: Manual check (user present)**

Run: `node dist/bin.js login --browser`
Expected: Chrome opens on the store. The user logs in themselves, the window closes, and the CLI prints `Signed in. The login is valid until …`. Then `node dist/bin.js status` prints `"signedIn": true`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src test
git commit -m "feat: browser login that captures the token after the user signs in"
```

---

### Task 11: Documentation and live read-only smoke check

**Files:**
- Modify: `README.md`
- Create: `docs/ADDING-COMMANDS.md`

**Interfaces:**
- Consumes: the finished CLI and MCP server.

- [ ] **Step 1: Write `docs/ADDING-COMMANDS.md`**

````markdown
# Adding a command

Every capability is one operation. The CLI command and the MCP tool are generated from it.

1. Find the endpoint in `docs/API.md`. If it is new, capture it from the site's bundle or live traffic first and
   add it there. Never add `order/post`, `user/cc` or `user/GetIFrameURL`; the client refuses them.
2. If the call is reusable, add a typed function under `src/api/` (see `src/api/cart.ts`). POST bodies are passed
   unwrapped; the client adds `{"Object": ...}`.
3. Add the operation in the matching `src/operations/*.ts` file:

   ```ts
   export const searchItemsOp = defineOperation({
     name: "search_items",
     description: "Search the store's catalog by name. Returns item ids usable with set_cart_item.",
     input: { query: z.string().min(1).max(100) },
     readOnly: true,
     async run(ctx, { query }) {
       return searchItems(await ctx.client(), query);
     },
   });
   ```

4. Append it to `operations` in `src/operations/index.ts`.
5. Test it with `fakeFetch` (see `test/operations.test.ts`). Fixtures are made up; never paste real responses.

Rules: numeric inputs use `z.coerce.number()` so CLI strings work. Set `readOnly: false` for anything that changes
the cart or account, and `destructive: true` for anything that removes data the user may want.
````

- [ ] **Step 2: Rewrite `README.md`**

````markdown
# hazi-hinam

Unofficial MCP server and CLI for the [Hazi Hinam](https://shop.hazi-hinam.co.il/) online store, so AI assistants
can use the store through its own API instead of clicking through the website.

Unofficial and unaffiliated with Hazi Hinam.

## What it does

- Saves your "usual order" (products and exact amounts) from your cart, then refills the cart with it on request.
- Finds delivery slots for a day ("thursday", "חמישי", or a date).
- Lists past orders, shows and edits the cart.
- **Stops before payment.** You pick the slot and pay on the website.

## Install

```sh
git clone https://github.com/erakauf1/hazi-hinam && cd hazi-hinam
npm install && npm run build
```

## Sign in

The store's login has a CAPTCHA, so you always sign in yourself. The login lasts 48 hours.

```sh
node dist/bin.js login --browser   # opens Chrome; you log in; the token is captured
node dist/bin.js login             # or paste access_token from DevTools → Network → Login → Response
node dist/bin.js status
```

## Use

```sh
node dist/bin.js help
node dist/bin.js save-usual-order                 # after filling the cart on the site once
node dist/bin.js prepare-usual-order --day thursday
```

## MCP

```sh
claude mcp add hazi-hinam -- node /absolute/path/to/hazi-hinam/dist/bin.js mcp
```

Then ask: "Prepare my usual Hazi Hinam order for Thursday."

## Your data

The login token and your usual order live in `~/.config/hazi-hinam/` (owner-only permissions), never in this
repository. Override with `HAZI_HINAM_CONFIG_DIR`.

## Development

`npm test`, `npm run typecheck`. Adding a command: [docs/ADDING-COMMANDS.md](docs/ADDING-COMMANDS.md).
API research: [docs/API.md](docs/API.md).
````

- [ ] **Step 3: Live read-only smoke check (user present and signed in)**

Run each; none of them change the cart or the account:
```bash
node dist/bin.js status
node dist/bin.js list-orders --limit 2
node dist/bin.js list-delivery-slots --day thursday
node dist/bin.js show-usual-order
node dist/bin.js get-cart
```
Expected: all exit 0 with JSON. `show-usual-order` reads the file already saved on 2026-09-29.

Run `prepare-usual-order` **only after the user explicitly agrees**, because it replaces the cart.

- [ ] **Step 4: Check that nothing personal is committed**

Run: `git grep -nE '[0-9A-F]{64}|access_token"\s*:\s*"[^"]+' -- . ':!docs/superpowers' || echo clean`
Expected: `clean`.

- [ ] **Step 5: Commit and push**

```bash
git add README.md docs/ADDING-COMMANDS.md
git commit -m "docs: usage, MCP setup, and guide for adding commands"
git push
```

---

## Later enhancements (separate plans)

These are known endpoints that are not in this plan. Each becomes one or more operations via `docs/ADDING-COMMANDS.md`:
- Catalog search: `POST item/getItemsBySearch` (body shape to capture), `GET item/getItemByBarkod/{barcode}`.
- Favorites and site shopping lists (`item/getItemsFav`, `shoppinglist/*`).
- Promotions: `item/getItemsPromoted`, `item/getItemsInMivza/{id}`.
- Changing the slot of an existing, still-editable order: `POST order/ChangeDraftOrderShipping/?Id=` `{ AddressId, StoreId, ShipmentId }`, gated on `IsOrderShippingChangeAllowed`.
- Barcode fallback when a saved `itemId` is retired: `getItemByBarkod` during replay.
- Publishing: npm package name, `server.json` for the MCP registry, CI.

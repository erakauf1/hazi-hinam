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

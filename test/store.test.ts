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

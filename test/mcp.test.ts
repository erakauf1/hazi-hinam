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
    for (const name of ["clear_cart", "set_item_remark", "clear_item_remark", "answer_substitutions"])
      expect(tools.find(t => t.name === name)!.annotations, name).toMatchObject({ destructiveHint: true });
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

  it("describes the shopping tools in its instructions", async () => {
    const client = await connect(createContext({ store: await tempStore(), now: () => now }));
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/search_products/);
    expect(instructions).toMatch(/cannot place or pay/i);
  });
});

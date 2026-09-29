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

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

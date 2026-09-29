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
      { ItemId: 2, Quantity: 1.5, Type: 2, IsCalculateCart: true },
    ]);
    expect(report.added.map(i => i.itemId)).toEqual([1]);
    expect(report.missing).toEqual([
      { item: expect.objectContaining({ itemId: 2 }), reason: "out_of_stock" },
      { item: expect.objectContaining({ itemId: 3 }), reason: "rejected", detail: expect.stringContaining("Item not available") },
    ]);
    expect(report.summary).toEqual(summary);
  });

  it("re-sends the last accepted line with recalculation when the final line is rejected", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, {
      savedAt: "x",
      items: [
        { itemId: 1, barcode: "b1", name: "A", quantity: 2, type: 1 },
        { itemId: 2, barcode: "b2", name: "B", quantity: 1, type: 1 },
      ],
    });
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": (call: { body: any }) =>
        call.body.Object.ItemId === 2
          ? { json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "nope" } } }
          : { json: { IsOK: true, Results: null, ErrorResponse: null } },
      "GET item/getItemsInCart": cartOf(item(1, { Cart: { Quantity: 2, ItemQuantityType: 1 } })),
      "GET order/cartSummary": { CartSummary: summary },
    });
    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    const sets = f.calls.filter(c => c.path === "item/addItemToCart").map(c => c.body.Object);
    expect(sets.at(-1)).toEqual({ ItemId: 1, Quantity: 2, Type: 1, IsCalculateCart: true });
    expect(report.missing).toEqual([{ item: expect.objectContaining({ itemId: 2 }), reason: "rejected", detail: expect.stringContaining("nope") }]);
  });

  it("does not send a recalculation when every line was rejected", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, { savedAt: "x", items: [{ itemId: 1, barcode: "b", name: "n", quantity: 1, type: 1 }] });
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": () => ({ json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "no" } } }),
      "GET item/getItemsInCart": cartOf(),
      "GET order/cartSummary": { CartSummary: summary },
    });
    await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    expect(f.calls.filter(c => c.path === "item/addItemToCart")).toHaveLength(1);
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

describe("replayUsualOrder barcode fallback", () => {
  const usual = {
    savedAt: "2026-09-01T00:00:00.000Z",
    items: [
      { itemId: 1, barcode: "7290000000001", name: "Bread", quantity: 1, type: 1 },
      { itemId: 2, barcode: "7290000000002", name: "Milk", quantity: 3, type: 1 },
    ],
  };
  const rejectMilk = (call: { body: any }) =>
    call.body.Object.ItemId === 2
      ? { json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "retired" } } }
      : { json: { IsOK: true, Results: null, ErrorResponse: null } };

  it("sets the product's new id when the saved id is rejected", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, usual);
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": rejectMilk,
      "GET item/getItemByBarkod/7290000000002": { Item: item(22, { BarKod: "7290000000002" }) },
      "GET item/getItemsInCart": cartOf(
        item(1, { Cart: { Quantity: 1, ItemQuantityType: 1 } }),
        item(22, { Cart: { Quantity: 3, ItemQuantityType: 1 } }),
      ),
      "GET order/cartSummary": { CartSummary: summary },
    });
    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    expect(report.remapped).toEqual([{ item: usual.items[1], newItemId: 22 }]);
    expect(report.added.map(i => i.itemId)).toEqual([1, 2]);
    expect(report.missing).toEqual([]);
    const adds = f.calls.filter(c => c.path === "item/addItemToCart").map(c => c.body.Object);
    expect(adds.at(-1)).toEqual({ ItemId: 22, Quantity: 3, Type: 1, IsCalculateCart: true });
    expect((await store.readJson<typeof usual>(USUAL_ORDER_FILE))!.items[1].itemId).toBe(2);
  });

  it("keeps the line as rejected when the barcode finds nothing new", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, usual);
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": rejectMilk,
      "GET item/getItemByBarkod/7290000000002": { Item: null },
      "GET item/getItemsInCart": cartOf(item(1, { Cart: { Quantity: 1, ItemQuantityType: 1 } })),
      "GET order/cartSummary": { CartSummary: summary },
    });
    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    expect(report.remapped).toEqual([]);
    expect(report.missing).toMatchObject([{ item: usual.items[1], reason: "rejected" }]);
  });

  it("keeps the line as rejected when the barcode lookup itself fails", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, usual);
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": rejectMilk,
      "GET item/getItemsInCart": cartOf(item(1, { Cart: { Quantity: 1, ItemQuantityType: 1 } })),
      "GET order/cartSummary": { CartSummary: summary },
    });
    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    expect(report.remapped).toEqual([]);
    expect(report.missing).toMatchObject([{ reason: "rejected" }]);
  });

  it("stops on AuthRequired during the barcode lookup", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, usual);
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": rejectMilk,
      "GET item/getItemByBarkod/7290000000002": () => ({ status: 401, text: "" }),
    });
    await expect(replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

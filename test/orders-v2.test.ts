import { describe, expect, it } from "vitest";
import { describeItem } from "../src/operations/format.js";
import { item, runOp, signedIn } from "./helpers.js";

const order = (overrides: Record<string, unknown> = {}) => ({
  Id: 11, Date: "20/09/2026", Total: 100, Order_Status: 1, Order_Status_Desc: "received", IsDraftOrder: true,
  ShippingTypeDesc: "delivery", Shipment: null, Order_Draft_Id: 77, Order_Draft_Due_Date: "01/10/2026 12:00",
  IsOrderShippingChangeAllowed: true, ...overrides,
});

describe("list_orders editable info", () => {
  it("adds editable details only when the slot can still change", async () => {
    const { ctx } = await signedIn({ "GET order/history": { Orders: [order(), order({ Id: 12, IsOrderShippingChangeAllowed: false })] } });
    const [open, closed] = (await runOp(ctx, "list_orders", { limit: "2" })) as any[];
    expect(open.editable).toEqual({ canChangeDeliverySlot: true, changeableUntil: "01/10/2026 12:00" });
    expect(closed.editable).toBeUndefined();
  });
});

describe("change_order_delivery_slot", () => {
  it("moves a delivery order to another slot", async () => {
    const { ctx, calls } = await signedIn({ "GET order/history": { Orders: [order()] }, "POST order/ChangeDraftOrderShipping/": null });
    expect(await runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", addressId: "4" }))
      .toEqual({ orderId: 11, shipmentId: 5, addressId: 4 });
    const post = calls[1];
    expect(post.url.searchParams.get("Id")).toBe("77");
    expect(post.body).toEqual({ Object: { AddressId: 4, StoreId: null, ShipmentId: 5 } });
  });

  it("moves a pickup order with storeId", async () => {
    const { ctx, calls } = await signedIn({ "GET order/history": { Orders: [order()] }, "POST order/ChangeDraftOrderShipping/": null });
    await runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", storeId: "70" });
    expect(calls[1].body).toEqual({ Object: { AddressId: null, StoreId: 70, ShipmentId: 5 } });
  });

  it("refuses orders that can no longer change, unknown orders, and ambiguous targets", async () => {
    const { ctx, calls } = await signedIn({ "GET order/history": { Orders: [order({ IsOrderShippingChangeAllowed: false })] } });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", addressId: "4" })).rejects.toMatchObject({ code: "NOT_CHANGEABLE" });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "99", shipmentId: "5", addressId: "4" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", addressId: "4", storeId: "70" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
  });
});

const suggestions = { SuggestedItems: [{ Original: { Item: item(1) }, Alternative: { Item: item(2) } }, { Original: { Item: item(3) }, Alternative: { Item: item(4) } }] };

describe("substitutions", () => {
  it("lists suggested substitutes", async () => {
    const { ctx } = await signedIn({ "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": suggestions });
    expect(await runOp(ctx, "get_substitutions", { orderId: "abc-1" })).toEqual({
      pending: true,
      suggestions: [
        { original: describeItem(item(1)), alternative: describeItem(item(2)) },
        { original: describeItem(item(3)), alternative: describeItem(item(4)) },
      ],
    });
  });

  it("reports nothing pending", async () => {
    const { ctx } = await signedIn({ "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": null });
    expect(await runOp(ctx, "get_substitutions", { orderId: "abc-1" })).toEqual({ pending: false, suggestions: [] });
  });

  it("answers every pair, approving only the listed originals", async () => {
    const { ctx, calls } = await signedIn({
      "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": suggestions,
      "POST SSCS/SetOrderAlternativeItems": null,
    });
    expect(await runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "3" })).toEqual({ approved: [3], rejected: [1] });
    expect(calls[1].url.searchParams.get("Id")).toBe("abc-1");
    expect(calls[1].body).toEqual({ AlternativeItems: [
      { Original_Id: 1, Alternative_Id: 2, IsApproved: false },
      { Original_Id: 3, Alternative_Id: 4, IsApproved: true },
    ] });
  });

  it("accepts 'all' and 'none', and rejects ids that were not suggested", async () => {
    const { ctx, calls } = await signedIn({
      "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": suggestions,
      "POST SSCS/SetOrderAlternativeItems": null,
    });
    expect(await runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "all" })).toEqual({ approved: [1, 3], rejected: [] });
    expect(await runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "none" })).toEqual({ approved: [], rejected: [1, 3] });
    await expect(runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "9" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls.filter(c => c.method === "POST")).toHaveLength(2);
  });

  it("reports NOTHING_PENDING when answering with no suggestions", async () => {
    const { ctx } = await signedIn({ "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": null });
    await expect(runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "all" })).rejects.toMatchObject({ code: "NOTHING_PENDING" });
  });
});

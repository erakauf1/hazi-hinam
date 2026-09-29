import { z } from "zod";
import { changeOrderShipping, copyOrderToCart, getOrderItems, listOrders } from "../api/orders.js";
import { answerSubstitutes, getSuggestedSubstitutes } from "../api/substitutions.js";
import { parseSiteDate } from "../dates.js";
import { HaziHinamError } from "../errors.js";
import { defineOperation } from "./define.js";
import { describeItem } from "./format.js";

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
      editable: o.IsOrderShippingChangeAllowed
        ? { canChangeDeliverySlot: true, changeableUntil: o.Order_Draft_Due_Date ?? null }
        : undefined,
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

export const changeOrderDeliverySlotOp = defineOperation({
  name: "change_order_delivery_slot",
  description: "Move an already placed order to another delivery or pickup slot, while the site still allows it (see list_orders' editable). Give shipmentId from list_delivery_slots and exactly one of addressId (delivery) or storeId (pickup). Confirm with the user first.",
  input: {
    orderId: z.coerce.number().int().positive(),
    shipmentId: z.coerce.number().int().positive(),
    addressId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
  },
  readOnly: false,
  async run(ctx, { orderId, shipmentId, addressId, storeId }) {
    if ((addressId === undefined) === (storeId === undefined)) {
      throw new HaziHinamError("BAD_INPUT", "Give exactly one of addressId (delivery) and storeId (pickup).");
    }
    const client = await ctx.client();
    const order = (await listOrders(client)).find(o => o.Id === orderId);
    if (!order) throw new HaziHinamError("NOT_FOUND", `Order ${orderId} is not in the order history.`);
    if (!order.IsOrderShippingChangeAllowed || !order.Order_Draft_Id) {
      throw new HaziHinamError("NOT_CHANGEABLE", `Order ${orderId} can no longer change its delivery slot.`);
    }
    await changeOrderShipping(client, order.Order_Draft_Id, { shipmentId, addressId: addressId ?? null, storeId: storeId ?? null });
    return { orderId, shipmentId, ...(addressId !== undefined ? { addressId } : { storeId }) };
  },
});

const substitutionId = z.string().regex(/^[\w-]{1,64}$/);

export const getSubstitutionsOp = defineOperation({
  name: "get_substitutions",
  description: "Show the substitutes the store proposes for missing products in an order (the id from the store's substitution SMS link, usually the order id).",
  input: { orderId: substitutionId },
  readOnly: true,
  async run(ctx, { orderId }) {
    const pairs = await getSuggestedSubstitutes(await ctx.client(), orderId);
    return {
      pending: pairs.length > 0,
      suggestions: pairs.map(p => ({ original: describeItem(p.Original.Item), alternative: describeItem(p.Alternative.Item) })),
    };
  },
});

export const answerSubstitutionsOp = defineOperation({
  name: "answer_substitutions",
  description: "Answer the store's substitute proposals for an order. approve is 'all', 'none', or comma-separated original itemIds to accept; every other proposal is declined. Confirm the choices with the user first.",
  input: { orderId: substitutionId, approve: z.string().regex(/^(all|none|\d+(,\d+)*)$/) },
  readOnly: false,
  async run(ctx, { orderId, approve }) {
    const client = await ctx.client();
    const pairs = await getSuggestedSubstitutes(client, orderId);
    if (!pairs.length) throw new HaziHinamError("NOTHING_PENDING", "There are no substitute proposals to answer for this order.");
    const originals = pairs.map(p => p.Original.Item.Id);
    const chosen = approve === "all" ? new Set(originals) : approve === "none" ? new Set<number>() : new Set(approve.split(",").map(Number));
    const unknown = [...chosen].filter(id => !originals.includes(id));
    if (unknown.length) throw new HaziHinamError("BAD_INPUT", `Item ${unknown.join(", ")} has no substitute proposal.`);
    await answerSubstitutes(client, orderId, pairs.map(p => ({
      Original_Id: p.Original.Item.Id,
      Alternative_Id: p.Alternative.Item.Id,
      IsApproved: chosen.has(p.Original.Item.Id),
    })));
    return { approved: originals.filter(id => chosen.has(id)), rejected: originals.filter(id => !chosen.has(id)) };
  },
});

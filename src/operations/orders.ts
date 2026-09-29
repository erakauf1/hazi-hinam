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

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

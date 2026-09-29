import { z } from "zod";
import { SITE_ORIGIN } from "../client.js";
import { resolveDay } from "../dates.js";
import { loadUsualOrder, replayUsualOrder, snapshotCart } from "../usual-order.js";
import { describeTotal } from "./cart.js";
import { defineOperation, unitName } from "./define.js";
import { slotsForDates } from "./delivery.js";

export const saveUsualOrderOp = defineOperation({
  name: "save_usual_order",
  description: "Save the current cart (products and exact amounts) as the user's usual order, stored only on this computer.",
  input: {},
  readOnly: false,
  async run(ctx) {
    const usual = await snapshotCart(await ctx.client(), ctx.store, ctx.now());
    return { saved: usual.items.length, savedAt: usual.savedAt };
  },
});

export const showUsualOrderOp = defineOperation({
  name: "show_usual_order",
  description: "Show the user's saved usual order (products and amounts). Reads only the local file.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const usual = await loadUsualOrder(ctx.store);
    return {
      savedAt: usual.savedAt,
      items: usual.items.map(i => ({ itemId: i.itemId, name: i.name, quantity: i.quantity, unit: unitName(i.type) })),
    };
  },
});

export const prepareUsualOrderOp = defineOperation({
  name: "prepare_usual_order",
  description: "Replace the cart with the user's usual order at the saved amounts, then list delivery slots for `day`. Clears the current cart first, so confirm with the user if it has other items. Does not place or pay for the order: the user finishes on the website.",
  input: { day: z.string().max(40).optional() },
  readOnly: false,
  destructive: true,
  async run(ctx, { day }) {
    const dates = day ? resolveDay(day, ctx.now()) : null;
    const report = await replayUsualOrder(await ctx.client(), ctx.store);
    const delivery = dates ? await slotsForDates(ctx, dates) : null;
    return {
      cart: {
        itemsAdded: report.added.length,
        missing: report.missing.map(m => ({ name: m.item.name, reason: m.reason, ...(m.detail ? { detail: m.detail } : {}) })),
        total: describeTotal(report.summary),
      },
      delivery,
      nextStep: `Open ${SITE_ORIGIN}/, choose the delivery slot, and pay there. This tool never places or pays for orders.`,
    };
  },
});

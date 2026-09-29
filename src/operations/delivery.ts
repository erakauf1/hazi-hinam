import { z } from "zod";
import { filterSlotsByDates, listDeliverySlots } from "../api/delivery.js";
import type { Context } from "../context.js";
import { resolveDay } from "../dates.js";
import { defineOperation } from "./define.js";

export async function slotsForDates(ctx: Context, dates: string[] | null) {
  const addresses = await listDeliverySlots(await ctx.client());
  return dates ? { dates, addresses: filterSlotsByDates(addresses, dates) } : { dates: null, addresses };
}

export const slotsForDay = (ctx: Context, day: string | undefined) =>
  slotsForDates(ctx, day ? resolveDay(day, ctx.now()) : null);

export const listDeliverySlotsOp = defineOperation({
  name: "list_delivery_slots",
  description: "List delivery time slots for each of the user's addresses (about 12 days ahead). `day` accepts a weekday (English or Hebrew) or a date; a weekday returns the next two occurrences so the user can choose.",
  input: { day: z.string().max(40).optional() },
  readOnly: true,
  run: (ctx, { day }) => slotsForDay(ctx, day),
});

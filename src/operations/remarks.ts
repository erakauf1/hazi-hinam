import { z } from "zod";
import { deleteItemRemarks, getItemRemarks, type ItemRemarks, saveItemRemarks } from "../api/remarks.js";
import { HaziHinamError } from "../errors.js";
import { defineOperation } from "./define.js";

const choiceOf = (r: ItemRemarks) =>
  r.MultiSelectRemarks?.length ? { choice: "multiple" as const, options: r.MultiSelectRemarks }
  : r.SingleSelectRemarks?.length ? { choice: "single" as const, options: r.SingleSelectRemarks }
  : { choice: "none" as const, options: [] };

export const getItemRemarkOptionsOp = defineOperation({
  name: "get_item_remark_options",
  description: "Show which picking instructions a product accepts (e.g. ripeness, slicing, free text) and what is selected now.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { itemId }) {
    const r = await getItemRemarks(await ctx.client(), itemId);
    const { choice, options } = choiceOf(r);
    return {
      itemId,
      freeText: { allowed: r.IsFreeRemark, current: r.FreeRemarkText },
      choice,
      options: options.map(o => ({ optionId: o.Id, name: o.Name, selected: o.IsSelected })),
    };
  },
});

export const setItemRemarkOp = defineOperation({
  name: "set_item_remark",
  description: "Set picking instructions for a product in the cart: optionIds (comma-separated, from get_item_remark_options) and/or free text. Replaces the product's current remark.",
  input: {
    itemId: z.coerce.number().int().positive(),
    optionIds: z.string().regex(/^\d+(,\d+)*$/).optional(),
    text: z.string().trim().min(1).max(200).optional(),
  },
  readOnly: false,
  destructive: true,
  async run(ctx, { itemId, optionIds, text }) {
    const client = await ctx.client();
    const r = await getItemRemarks(client, itemId);
    const { choice, options } = choiceOf(r);
    const ids = optionIds ? optionIds.split(",").map(Number) : [];
    if (!ids.length && !text) throw new HaziHinamError("BAD_INPUT", "Give optionIds, text, or both.");
    if (text && !r.IsFreeRemark) throw new HaziHinamError("BAD_INPUT", "This product does not accept free-text remarks.");
    const offered = new Set(options.map(o => o.Id));
    const unknown = ids.filter(id => !offered.has(id));
    if (unknown.length) throw new HaziHinamError("BAD_INPUT", `Option ${unknown.join(", ")} is not offered for this product.`);
    if (choice === "single" && ids.length > 1) throw new HaziHinamError("BAD_INPUT", "This product accepts only one option.");
    await saveItemRemarks(client, {
      itemId,
      text: text ?? null,
      multiIds: choice === "multiple" ? ids : [],
      singleId: choice === "single" && ids.length ? ids[0] : null,
    });
    return { itemId, optionIds: ids, text: text ?? null };
  },
});

export const clearItemRemarkOp = defineOperation({
  name: "clear_item_remark",
  description: "Remove the picking instructions from a product in the cart.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: false,
  destructive: true,
  async run(ctx, { itemId }) {
    await deleteItemRemarks(await ctx.client(), itemId);
    return { itemId, cleared: true };
  },
});

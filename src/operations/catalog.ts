import { z } from "zod";
import { getItem, getItemByBarcode, getProductDetails, searchItems, suggestSearchPhrases } from "../api/catalog.js";
import { HaziHinamError } from "../errors.js";
import { defineOperation } from "./define.js";
import { describeItem } from "./format.js";

export const searchProductsOp = defineOperation({
  name: "search_products",
  description: "Search the Hazi Hinam catalog (Hebrew or English). Returns products with price, size, stock, promotion and whether they are already in the cart, plus suggested categories.",
  input: {
    query: z.string().trim().min(1).max(100),
    page: z.coerce.number().int().min(1).max(50).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  },
  readOnly: true,
  async run(ctx, { query, page, pageSize }) {
    const result = await searchItems(await ctx.client(), query, page, pageSize);
    return {
      items: (result.Items ?? []).map(describeItem),
      suggestedCategories: (result.SuggestedSearchCategories ?? []).map(s => ({
        subCategoryId: s.SubCategoryId,
        name: s.SubCategoryName,
        category: s.CatalogName,
      })),
    };
  },
});

export const suggestSearchPhrasesOp = defineOperation({
  name: "suggest_search_phrases",
  description: "Autocomplete: search phrases the site suggests for the start of a word. Useful before search_products when the product name is uncertain.",
  input: { query: z.string().trim().min(1).max(100) },
  readOnly: true,
  run: async (ctx, { query }) => suggestSearchPhrases(await ctx.client(), query),
});

export const getProductOp = defineOperation({
  name: "get_product",
  description: "Get one product by itemId or by barcode (give exactly one), with price, size, stock, promotion and category.",
  input: {
    itemId: z.coerce.number().int().positive().optional(),
    barcode: z.string().regex(/^\d{4,14}$/).optional(),
  },
  readOnly: true,
  async run(ctx, { itemId, barcode }) {
    if ((itemId === undefined) === (barcode === undefined)) {
      throw new HaziHinamError("BAD_INPUT", "Give exactly one of itemId and barcode.");
    }
    const client = await ctx.client();
    const found = itemId !== undefined ? await getItem(client, itemId) : await getItemByBarcode(client, barcode!);
    if (!found) throw new HaziHinamError("NOT_FOUND", `No product found for ${itemId ?? barcode}.`);
    return { ...describeItem(found), category: found.CategoryName ?? undefined, subCategory: found.SubCategoryName ?? undefined };
  },
});

export const getProductDetailsOp = defineOperation({
  name: "get_product_details",
  description: "Ingredients, nutrition per 100 g, allergens/kosher attributes, manufacturer and country of origin for one product. Use for dietary questions.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { itemId }) {
    const d = await getProductDetails(await ctx.client(), itemId);
    return {
      itemId: d.ItemId,
      description: d.ShortDescription || undefined,
      ingredients: d.IngredientSequenceandName || undefined,
      manufacturer: d.ManufacturerName || undefined,
      countryOfOrigin: d.CountryofOrigin || undefined,
      warnings: d.UsageAndSafetyWarnings || undefined,
      attributes: (d.TypeCodes ?? []).map(t => ({ name: t.Description, value: t.Value })),
      nutritionPer100g: (d.NutritionalValues_For100Gr ?? []).map(n => ({
        name: n.NutritionalValueDescription,
        amount: `${n.Quantity} ${n.UnitTypeDescription}`.trim(),
      })),
    };
  },
});

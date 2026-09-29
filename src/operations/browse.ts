import { z } from "zod";
import { type CatalogNode, getCatalog, getPromotedItems, getPromotionItems, getSubCategoryItems } from "../api/catalog.js";
import { defineOperation } from "./define.js";
import { describeItem } from "./format.js";

const subCategories = (node: CatalogNode) => (node.SubCategories ?? []).map(s => ({ subCategoryId: s.Id, name: s.Name }));

export const listCategoriesOp = defineOperation({
  name: "list_categories",
  description: "List the store's categories and their sub-categories (with ids for list_category_products), plus the current seasonal campaign.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const catalog = await getCatalog(await ctx.client());
    return {
      campaign: catalog.Campaign ? { name: catalog.Campaign.Name, subCategories: subCategories(catalog.Campaign) } : null,
      categories: (catalog.Categories ?? []).map(c => ({ categoryId: c.Id, name: c.Name, subCategories: subCategories(c) })),
    };
  },
});

export const listCategoryProductsOp = defineOperation({
  name: "list_category_products",
  description: "List the products in one sub-category (ids come from list_categories or search_products' suggestedCategories).",
  input: { subCategoryId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { subCategoryId }) {
    const { name, items } = await getSubCategoryItems(await ctx.client(), subCategoryId);
    return { subCategory: name, items: items.map(describeItem) };
  },
});

export const listPromotedProductsOp = defineOperation({
  name: "list_promoted_products",
  description: "List the products the store is currently promoting (deals and featured products).",
  input: {},
  readOnly: true,
  run: async ctx => (await getPromotedItems(await ctx.client())).map(describeItem),
});

export const getPromotionProductsOp = defineOperation({
  name: "get_promotion_products",
  description: "List every product that takes part in one promotion (the promotionId shown on a product), e.g. to complete a 'buy 3' deal.",
  input: { promotionId: z.coerce.number().int().positive() },
  readOnly: true,
  run: async (ctx, { promotionId }) => (await getPromotionItems(await ctx.client(), promotionId)).map(describeItem),
});

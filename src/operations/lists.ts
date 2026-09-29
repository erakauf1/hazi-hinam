import { z } from "zod";
import {
  addFavorite, addShoppingListToCart, createShoppingList, getShoppingListItems, listFavorites, listShoppingLists, removeFavorite,
} from "../api/lists.js";
import { defineOperation, unitType } from "./define.js";
import { describeItem } from "./format.js";

export const listFavoritesOp = defineOperation({
  name: "list_favorites",
  description: "List the products the user marked as favorites on the site.",
  input: {},
  readOnly: true,
  run: async ctx => (await listFavorites(await ctx.client())).map(describeItem),
});

export const addFavoriteOp = defineOperation({
  name: "add_favorite",
  description: "Mark a product as a favorite on the user's account.",
  input: { itemId: z.coerce.number().int().positive(), unit: z.enum(["unit", "kg"]).default("unit") },
  readOnly: false,
  async run(ctx, { itemId, unit }) {
    await addFavorite(await ctx.client(), itemId, unitType(unit));
    return { itemId, favorite: true };
  },
});

export const removeFavoriteOp = defineOperation({
  name: "remove_favorite",
  description: "Remove a product from the user's favorites.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { itemId }) {
    await removeFavorite(await ctx.client(), itemId);
    return { itemId, favorite: false };
  },
});

export const listShoppingListsOp = defineOperation({
  name: "list_shopping_lists",
  description: "List the user's saved shopping lists on the site (names and item counts; the site stores products, not amounts).",
  input: {},
  readOnly: true,
  async run(ctx) {
    const result = await listShoppingLists(await ctx.client());
    return {
      favoritesCount: result.FavoritesCount,
      lists: (result.ShoppingList ?? []).map(l => ({ listId: l.Id, name: l.Name, itemCount: l.ItemsCount })),
    };
  },
});

export const getShoppingListOp = defineOperation({
  name: "get_shopping_list",
  description: "List the products in one saved shopping list.",
  input: { listId: z.coerce.number().int().positive() },
  readOnly: true,
  run: async (ctx, { listId }) => (await getShoppingListItems(await ctx.client(), listId)).map(describeItem),
});

export const createShoppingListOp = defineOperation({
  name: "create_shopping_list",
  description: "Create a new shopping list on the site, optionally filled with the products of a past order (fromOrderId). Lists store products, not amounts.",
  input: { name: z.string().trim().min(1).max(60), fromOrderId: z.coerce.number().int().positive().optional() },
  readOnly: false,
  async run(ctx, { name, fromOrderId }) {
    await createShoppingList(await ctx.client(), name, fromOrderId);
    return { created: true, name };
  },
});

export const addShoppingListToCartOp = defineOperation({
  name: "add_shopping_list_to_cart",
  description: "Add every product of a saved shopping list to the cart at the site's default amounts (1 unit / minimum weight). Prefer prepare_usual_order when exact amounts matter.",
  input: { listId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { listId }) {
    await addShoppingListToCart(await ctx.client(), listId);
    return { listId, note: "Added at the site's default amounts. Review them in the cart." };
  },
});

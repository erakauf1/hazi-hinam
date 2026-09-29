import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { Category, Item } from "./types.js";

export async function listFavorites(c: HaziHinamClient): Promise<Item[]> {
  const { FavoriteItems } = await c.get<{ FavoriteItems: { Categories: Category[] | null } | null }>("item/getItemsFav", { SortBy: -1 });
  return flattenCategories(FavoriteItems?.Categories);
}

export async function addFavorite(c: HaziHinamClient, itemId: number, type: number): Promise<void> {
  await c.post("item/addItemToFavorites", { ItemId: itemId, Quantity: 0, Type: type });
}

export async function removeFavorite(c: HaziHinamClient, itemId: number): Promise<void> {
  await c.delete(`item/RemoveItemFromFavorites/${itemId}`);
}

export interface ShoppingListSummary {
  Id: number;
  Name: string;
  ItemsCount: number;
}

export function listShoppingLists(c: HaziHinamClient) {
  return c.get<{ FavoritesCount: number; ShoppingList: ShoppingListSummary[] | null }>("shoppinglist/get");
}

export async function getShoppingListItems(c: HaziHinamClient, listId: number): Promise<Item[]> {
  const { ShoppingListItems } = await c.get<{ ShoppingListItems: { Categories: Category[] | null } | null }>(
    `item/getItemsByShoppingList/${listId}`,
  );
  return flattenCategories(ShoppingListItems?.Categories);
}

export async function createShoppingList(c: HaziHinamClient, name: string, fromOrderId?: number): Promise<void> {
  await c.post("shoppinglist/post", { Name: name, OrderId: fromOrderId ?? null, Order_Draft_Id: null });
}

// Unwrapped, like the site's own call. Products arrive at the site's default amounts.
export async function addShoppingListToCart(c: HaziHinamClient, listId: number): Promise<void> {
  await c.post(`item/addShoppingListItemsToCart/${listId}`, {}, { wrap: false });
}

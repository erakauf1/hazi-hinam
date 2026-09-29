import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { CartSummary, Category, Item } from "./types.js";

export async function getCart(c: HaziHinamClient): Promise<Item[]> {
  const { CartItems } = await c.get<{ CartItems: { Categories: Category[] | null } }>("item/getItemsInCart");
  return flattenCategories(CartItems.Categories);
}

export async function getCartSummary(c: HaziHinamClient): Promise<CartSummary> {
  return (await c.get<{ CartSummary: CartSummary }>("order/cartSummary")).CartSummary;
}

export interface CartLineInput {
  itemId: number;
  quantity: number;
  type: number;
  recalculate?: boolean;
}

// Sets the line to exactly `quantity` (0 removes it); the site's +/- buttons use the same call.
export async function setItemQuantity(c: HaziHinamClient, line: CartLineInput): Promise<void> {
  await c.post("item/addItemToCart", {
    ItemId: line.itemId,
    Quantity: line.quantity,
    Type: line.type,
    IsCalculateCart: line.recalculate ?? false,
  });
}

export async function clearCart(c: HaziHinamClient): Promise<void> {
  await c.delete("item/removeItemsInCart");
}

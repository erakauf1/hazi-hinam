import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { Category, Item, OrderSummary } from "./types.js";

export async function listOrders(c: HaziHinamClient, limit?: number): Promise<OrderSummary[]> {
  const { Orders } = await c.get<{ Orders: OrderSummary[] }>("order/history");
  return limit === undefined ? Orders : Orders.slice(0, limit);
}

export async function getOrderItems(c: HaziHinamClient, orderId: number): Promise<Item[]> {
  const { OrderItems } = await c.get<{ OrderItems: { Categories: Category[] | null } }>(`item/getItemsByOrder/${orderId}`);
  return flattenCategories(OrderItems.Categories);
}

// The site's own "reorder": copies every product line, but at default amounts, not the original ones.
export async function copyOrderToCart(c: HaziHinamClient, orderId: number): Promise<void> {
  await c.post(`order/addOrderItemsToCart/${orderId}`);
}

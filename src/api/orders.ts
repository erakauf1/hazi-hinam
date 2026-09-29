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

export interface ShippingTarget {
  shipmentId: number;
  addressId: number | null;
  storeId: number | null;
}

// Moves a placed order to another slot. The site keys this by the order's draft id, not its order id.
export async function changeOrderShipping(c: HaziHinamClient, draftId: number, target: ShippingTarget): Promise<void> {
  await c.post(
    "order/ChangeDraftOrderShipping/",
    { AddressId: target.addressId, StoreId: target.storeId, ShipmentId: target.shipmentId },
    { query: { Id: draftId } },
  );
}

import { getItemByBarcode } from "./api/catalog.js";
import { clearCart, getCart, getCartSummary, setItemQuantity } from "./api/cart.js";
import type { CartSummary } from "./api/types.js";
import type { HaziHinamClient } from "./client.js";
import { AuthRequired, HaziHinamError } from "./errors.js";
import type { Store } from "./store.js";

// Kept locally because the site's shopping lists store which products, never how many.
export const USUAL_ORDER_FILE = "usual-order.json";

export interface UsualItem {
  itemId: number;
  barcode: string;
  name: string;
  quantity: number;
  type: number;
}

export interface UsualOrder {
  savedAt: string;
  items: UsualItem[];
}

export interface MissingItem {
  item: UsualItem;
  reason: "out_of_stock" | "not_in_cart" | "rejected";
  detail?: string;
}

export interface ReplayReport {
  added: UsualItem[];
  missing: MissingItem[];
  remapped: { item: UsualItem; newItemId: number }[];
  summary: CartSummary;
}

export async function snapshotCart(c: HaziHinamClient, store: Store, now: Date): Promise<UsualOrder> {
  const items = (await getCart(c))
    .filter(i => i.Cart && i.Cart.Quantity > 0)
    .map(i => ({ itemId: i.Id, barcode: i.BarKod, name: i.Name, quantity: i.Cart!.Quantity, type: i.Cart!.ItemQuantityType }));
  if (items.length === 0) {
    throw new HaziHinamError("EMPTY_CART", "The cart is empty. Fill it on the website with your usual amounts, then save again.");
  }
  const usual: UsualOrder = { savedAt: now.toISOString(), items };
  await store.writeJson(USUAL_ORDER_FILE, usual);
  return usual;
}

export async function loadUsualOrder(store: Store): Promise<UsualOrder> {
  const usual = await store.readJson<UsualOrder>(USUAL_ORDER_FILE);
  if (!usual?.items?.length) {
    throw new HaziHinamError("NO_USUAL_ORDER", "No usual order saved yet. Fill the cart on the website with your usual amounts, then run save_usual_order.");
  }
  return usual;
}

export async function replayUsualOrder(c: HaziHinamClient, store: Store): Promise<ReplayReport> {
  const usual = await loadUsualOrder(store);
  await clearCart(c);

  const rejected = new Map<number, string>();
  const effectiveId = new Map<number, number>();
  const remapped: { item: UsualItem; newItemId: number }[] = [];
  let lastAccepted: { itemId: number; line: UsualItem } | undefined;
  const set = (itemId: number, line: UsualItem, recalculate: boolean) =>
    setItemQuantity(c, { itemId, quantity: line.quantity, type: line.type, recalculate });

  for (const [index, line] of usual.items.entries()) {
    const recalculate = index === usual.items.length - 1;
    try {
      await set(line.itemId, line, recalculate);
      lastAccepted = { itemId: line.itemId, line };
    } catch (error) {
      if (error instanceof AuthRequired) throw error;
      // A retired product id can come back under a new id with the same barcode.
      const replacement = await getItemByBarcode(c, line.barcode).catch(e => {
        if (e instanceof AuthRequired) throw e;
        return null;
      });
      if (replacement && replacement.Id !== line.itemId) {
        try {
          await set(replacement.Id, line, recalculate);
          effectiveId.set(line.itemId, replacement.Id);
          remapped.push({ item: line, newItemId: replacement.Id });
          lastAccepted = { itemId: replacement.Id, line };
          continue;
        } catch (retryError) {
          if (retryError instanceof AuthRequired) throw retryError;
        }
      }
      rejected.set(line.itemId, (error as Error).message);
    }
  }

  // The recalculation flag rides on the final line; if that line failed, carry it on a line that worked.
  if (lastAccepted && rejected.has(usual.items[usual.items.length - 1].itemId)) {
    await set(lastAccepted.itemId, lastAccepted.line, true);
  }

  const cart = new Map((await getCart(c)).map(i => [i.Id, i]));
  const added: UsualItem[] = [];
  const missing: MissingItem[] = [];
  for (const line of usual.items) {
    const inCart = cart.get(effectiveId.get(line.itemId) ?? line.itemId);
    if (rejected.has(line.itemId)) missing.push({ item: line, reason: "rejected", detail: rejected.get(line.itemId) });
    else if (inCart?.Cart && inCart.Cart.Quantity > 0) added.push(line);
    else if (inCart && !inCart.IsInStock) missing.push({ item: line, reason: "out_of_stock" });
    else missing.push({ item: line, reason: "not_in_cart" });
  }
  return { added, missing, remapped, summary: await getCartSummary(c) };
}

import { describe, expect, it } from "vitest";
import { getUserInfo } from "../src/api/account.js";
import { clearCart, getCart, getCartSummary, setItemQuantity } from "../src/api/cart.js";
import { flattenCategories } from "../src/api/items.js";
import { copyOrderToCart, getOrderItems, listOrders } from "../src/api/orders.js";
import { HaziHinamClient } from "../src/client.js";
import { fakeFetch, item } from "./helpers.js";

const setup = (routes: Record<string, unknown>) => {
  const f = fakeFetch(routes);
  return { c: new HaziHinamClient("t", { fetch: f.fetch }), calls: f.calls };
};

describe("flattenCategories", () => {
  it("flattens, skips null item lists, and dedupes by Id", () => {
    const items = flattenCategories([
      { Id: 1, Name: "a", Items: [item(1), item(2)] },
      { Id: 2, Name: "b", Items: null },
      { Id: 3, Name: "c", Items: [item(2), item(3)] },
    ]);
    expect(items.map(i => i.Id)).toEqual([1, 2, 3]);
    expect(flattenCategories(null)).toEqual([]);
  });
});

describe("orders", () => {
  it("lists orders newest first and applies the limit", async () => {
    const orders = [{ Id: 3 }, { Id: 2 }, { Id: 1 }];
    const { c } = setup({ "GET order/history": { Orders: orders } });
    expect((await listOrders(c, 2)).map(o => o.Id)).toEqual([3, 2]);
    expect(await listOrders(c)).toHaveLength(3);
  });

  it("reads an order's items from its categories", async () => {
    const { c, calls } = setup({
      "GET item/getItemsByOrder/42": { OrderItems: { Categories: [{ Id: 1, Name: "x", Items: [item(7)] }] } },
    });
    expect((await getOrderItems(c, 42)).map(i => i.Id)).toEqual([7]);
    expect(calls[0].path).toBe("item/getItemsByOrder/42");
  });

  it("copies an order into the cart with an empty wrapped body", async () => {
    const { c, calls } = setup({ "POST order/addOrderItemsToCart/42": null });
    await copyOrderToCart(c, 42);
    expect(calls[0].body).toEqual({ Object: {} });
  });
});

describe("cart", () => {
  it("reads cart items and summary", async () => {
    const summary = { Price_NET_TOTAL: 100, Price_Shipping: 35.9, Price_Savings: 0, Price_Order_Total: 135.9, Minimum_Cart_Price_NET: 499.9 };
    const { c } = setup({
      "GET item/getItemsInCart": { CartItemsCount: 1, CartItems: { Items: null, Categories: [{ Id: 1, Name: "x", Items: [item(5)] }] } },
      "GET order/cartSummary": { CartSummary: summary },
    });
    expect((await getCart(c)).map(i => i.Id)).toEqual([5]);
    expect(await getCartSummary(c)).toEqual(summary);
  });

  it("sets an absolute quantity", async () => {
    const { c, calls } = setup({ "POST item/addItemToCart": null });
    await setItemQuantity(c, { itemId: 9, quantity: 1.5, type: 2 });
    await setItemQuantity(c, { itemId: 10, quantity: 2, type: 1, recalculate: true });
    expect(calls[0].body).toEqual({ Object: { ItemId: 9, Quantity: 1.5, Type: 2, IsCalculateCart: false } });
    expect(calls[1].body.Object.IsCalculateCart).toBe(true);
  });

  it("clears the cart with DELETE", async () => {
    const { c, calls } = setup({ "DELETE item/removeItemsInCart": null });
    await clearCart(c);
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("account", () => {
  it("reads user info", async () => {
    const { c } = setup({ "GET user/info": { UserInfo: { a: 1 }, CartItemsCount: 3 } });
    expect(await getUserInfo(c)).toMatchObject({ CartItemsCount: 3 });
  });
});

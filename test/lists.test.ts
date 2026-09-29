import { describe, expect, it } from "vitest";
import { describeItem } from "../src/operations/format.js";
import { item, runOp, signedIn } from "./helpers.js";

describe("favorites", () => {
  it("lists favorites across categories", async () => {
    const { ctx, calls } = await signedIn({
      "GET item/getItemsFav": { FavoriteItems: { Categories: [{ Id: 1, Name: "a", Items: [item(1)] }, { Id: 2, Name: "b", Items: [item(2), item(1)] }] } },
    });
    expect(await runOp(ctx, "list_favorites")).toEqual([describeItem(item(1)), describeItem(item(2))]);
    expect(calls[0].url.searchParams.get("SortBy")).toBe("-1");
  });

  it("adds a favorite with the site's body", async () => {
    const { ctx, calls } = await signedIn({ "POST item/addItemToFavorites": null });
    expect(await runOp(ctx, "add_favorite", { itemId: "5", unit: "kg" })).toEqual({ itemId: 5, favorite: true });
    expect(calls[0].body).toEqual({ Object: { ItemId: 5, Quantity: 0, Type: 2 } });
  });

  it("removes a favorite", async () => {
    const { ctx, calls } = await signedIn({ "DELETE item/RemoveItemFromFavorites/5": null });
    expect(await runOp(ctx, "remove_favorite", { itemId: "5" })).toEqual({ itemId: 5, favorite: false });
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("shopping lists", () => {
  it("lists saved lists", async () => {
    const { ctx } = await signedIn({
      "GET shoppinglist/get": { IsFavorites: true, FavoritesCount: 3, ShoppingList: [{ Id: 8, Name: "Weekly", ItemsCount: 12 }] },
    });
    expect(await runOp(ctx, "list_shopping_lists")).toEqual({ favoritesCount: 3, lists: [{ listId: 8, name: "Weekly", itemCount: 12 }] });
  });

  it("shows the products in one list", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsByShoppingList/8": { ShoppingListItems: { Categories: [{ Id: 1, Name: "a", Items: [item(3)] }] } } });
    expect(await runOp(ctx, "get_shopping_list", { listId: "8" })).toEqual([describeItem(item(3))]);
  });

  it("creates a list, optionally seeded from an order", async () => {
    const { ctx, calls } = await signedIn({ "POST shoppinglist/post": null });
    expect(await runOp(ctx, "create_shopping_list", { name: "From order", fromOrderId: "11" })).toEqual({ created: true, name: "From order" });
    expect(calls[0].body).toEqual({ Object: { Name: "From order", OrderId: 11, Order_Draft_Id: null } });
    await runOp(ctx, "create_shopping_list", { name: "Empty" });
    expect(calls[1].body).toEqual({ Object: { Name: "Empty", OrderId: null, Order_Draft_Id: null } });
  });

  it("adds a whole list to the cart with an unwrapped empty body", async () => {
    const { ctx, calls } = await signedIn({ "POST item/addShoppingListItemsToCart/8": null });
    expect(await runOp(ctx, "add_shopping_list_to_cart", { listId: "8" })).toMatchObject({ listId: 8 });
    expect(calls[0].body).toEqual({});
  });
});

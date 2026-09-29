import { describe, expect, it } from "vitest";
import { describeItem } from "../src/operations/format.js";
import { item, runOp, signedIn } from "./helpers.js";

describe("list_categories", () => {
  it("returns the category tree and the current campaign", async () => {
    const { ctx } = await signedIn({
      "GET Catalog/get": {
        Campaign: { Id: 1, Name: "Holiday", SubCategories: [{ Id: 11, Name: "Gifts" }] },
        Categories: [{ Id: 2, Name: "Dairy", SubCategories: [{ Id: 21, Name: "Milk" }, { Id: 22, Name: "Cheese" }] }, { Id: 3, Name: "Bakery", SubCategories: null }],
      },
    });
    expect(await runOp(ctx, "list_categories")).toEqual({
      campaign: { name: "Holiday", subCategories: [{ subCategoryId: 11, name: "Gifts" }] },
      categories: [
        { categoryId: 2, name: "Dairy", subCategories: [{ subCategoryId: 21, name: "Milk" }, { subCategoryId: 22, name: "Cheese" }] },
        { categoryId: 3, name: "Bakery", subCategories: [] },
      ],
    });
  });
});

describe("list_category_products", () => {
  it("lists a sub-category with the site's default sort", async () => {
    const { ctx, calls } = await signedIn({
      "GET item/getItemsBySubCategory": { Category: { Id: 2, Name: null, SubCategory: { Id: 21, Name: "Milk", Items: [item(1), item(2)] } } },
    });
    expect(await runOp(ctx, "list_category_products", { subCategoryId: "21" })).toEqual({
      subCategory: "Milk",
      items: [describeItem(item(1)), describeItem(item(2))],
    });
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ Id: "21", SortBy: "-1", IsDescending: "false" });
  });
});

describe("list_promoted_products", () => {
  it("lists promoted products", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsPromoted": { PromotedItems: { Items: [item(4)] } } });
    expect(await runOp(ctx, "list_promoted_products")).toEqual([describeItem(item(4))]);
  });
});

describe("get_promotion_products", () => {
  it.each([
    ["a plain list", [item(7)]],
    ["an Items wrapper", { Items: [item(7)] }],
    ["a Categories wrapper", { Categories: [{ Id: 1, Name: "c", Items: [item(7)] }] }],
  ])("reads MivzaItems given as %s", async (_label, mivzaItems) => {
    const { ctx } = await signedIn({ "GET item/getItemsInMivza/9": { MivzaItems: mivzaItems } });
    expect(await runOp(ctx, "get_promotion_products", { promotionId: "9" })).toEqual([describeItem(item(7))]);
  });

  it("returns an empty list when the promotion has no items", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsInMivza/9": { MivzaItems: null } });
    expect(await runOp(ctx, "get_promotion_products", { promotionId: "9" })).toEqual([]);
  });
});

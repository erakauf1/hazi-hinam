import { describe, expect, it } from "vitest";
import { describeItem } from "../src/operations/format.js";
import { item, runOp, signedIn } from "./helpers.js";

const milk = item(5, {
  Name: "Milk 3%",
  ManufacturerName: "Tnuva",
  UnitSizeDesc: "1 liter",
  Price_NET: 6.9,
  Price_Regular: 7.9,
  PricePerUnitDesc: "6.90 per liter",
  ItemQuantityTypes: { ConversionRate: 1, Types: [{ Type: 1, Interval: 1, ItemUnitTypeDesc: "unit", MaxQuantity: 50 }] },
  Mivza: { MivzaId: 9, MivzaDesc: "2 for 12", MivzaText: "" },
  Cart: { Quantity: 2, ItemQuantityType: 1 },
  IsFavorites: true,
});

describe("describeItem", () => {
  it("keeps the fields an assistant needs", () => {
    expect(describeItem(milk)).toEqual({
      itemId: 5, barcode: "72900000005", name: "Milk 3%", brand: "Tnuva", size: "1 liter",
      price: 6.9, regularPrice: 7.9, pricePerUnit: "6.90 per liter", inStock: true, units: ["unit"],
      promotion: { promotionId: 9, text: "2 for 12" }, inCart: { quantity: 2, unit: "unit" }, favorite: true,
    });
  });

  it("drops empty extras and defaults units to 'unit'", () => {
    expect(describeItem(item(6))).toEqual({ itemId: 6, barcode: "72900000006", name: "Item 6", price: 10, inStock: true, units: ["unit"] });
  });
});

describe("search_products", () => {
  it("sends the unwrapped search body and summarizes results", async () => {
    const { ctx, calls } = await signedIn({
      "POST item/getItemsBySearch": {
        Items: [milk],
        SuggestedSearchCategories: [{ SuggestedSearchCategoryName: "x", SubCategoryId: 40, SubCategoryName: "Milk", CatalogId: 4, CatalogName: "Dairy" }],
      },
    });
    const result = await runOp(ctx, "search_products", { query: "milk", pageSize: "10" });
    expect(calls[0].body).toEqual({ Paging: { Page: 1, PageSize: 10 }, Object: { SearchPhrase: "milk", SearchPhrases: [], ItemGroupping: false } });
    expect(result).toEqual({
      items: [describeItem(milk)],
      suggestedCategories: [{ subCategoryId: 40, name: "Milk", category: "Dairy" }],
    });
  });

  it("returns an empty list when nothing matches", async () => {
    const { ctx } = await signedIn({ "POST item/getItemsBySearch": { Items: null, SuggestedSearchCategories: null } });
    expect(await runOp(ctx, "search_products", { query: "zzz" })).toEqual({ items: [], suggestedCategories: [] });
  });
});

describe("suggest_search_phrases", () => {
  it("returns plain phrases", async () => {
    const { ctx, calls } = await signedIn({
      "GET item/GetSuggestedSearchPhrases": { SuggestedSearchPhrases: [{ Phrase: "milk 3%", HighlightPhrase: "<b>milk</b> 3%" }] },
    });
    expect(await runOp(ctx, "suggest_search_phrases", { query: "mil" })).toEqual(["milk 3%"]);
    expect(calls[0].url.searchParams.get("searchPhrase")).toBe("mil");
  });
});

describe("get_product", () => {
  it("looks up by id", async () => {
    const { ctx } = await signedIn({ "GET item/5": { Item: { ...milk, CategoryName: "Dairy", SubCategoryName: "Milk" } } });
    expect(await runOp(ctx, "get_product", { itemId: "5" })).toEqual({ ...describeItem(milk), category: "Dairy", subCategory: "Milk" });
  });

  it("looks up by barcode", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemByBarkod/7290000000005": { Item: milk } });
    expect(await runOp(ctx, "get_product", { barcode: "7290000000005" })).toMatchObject({ itemId: 5 });
    expect(calls).toHaveLength(1);
  });

  it("needs exactly one of itemId and barcode", async () => {
    const { ctx, calls } = await signedIn({});
    await expect(runOp(ctx, "get_product", {})).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "get_product", { itemId: "5", barcode: "7290000000005" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("reports NOT_FOUND for an unknown barcode", async () => {
    const { ctx } = await signedIn({ "GET item/getItemByBarkod/123456": { Item: null } });
    await expect(runOp(ctx, "get_product", { barcode: "123456" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("get_product_details", () => {
  it("condenses the GS1 record", async () => {
    const { ctx } = await signedIn({
      "GET item/GetItemGS1Details/5": {
        ItemId: 5, Barcode: 7290000000005, IngredientSequenceandName: "milk", ShortDescription: "Fresh milk",
        Remarks: "", ManufacturerName: "Tnuva", ManufacturerAddress: "x", UsageAndSafetyWarnings: "keep cold",
        CountryofOrigin: "Israel",
        TypeCodes: [{ TypeCode: "A", Description: "Kosher", Value: "yes" }],
        NutritionalValues_For100Gr: [{ NutritionalCode: 1, MidaCode: 1, MidaValue: "", NutritionalValue: "", NutritionalValueDescription: "Energy", Quantity: "60", UnitType: "", UnitTypeDescription: "kcal" }],
      },
    });
    expect(await runOp(ctx, "get_product_details", { itemId: "5" })).toEqual({
      itemId: 5, description: "Fresh milk", ingredients: "milk", manufacturer: "Tnuva", countryOfOrigin: "Israel",
      warnings: "keep cold", attributes: [{ name: "Kosher", value: "yes" }], nutritionPer100g: [{ name: "Energy", amount: "60 kcal" }],
    });
  });
});

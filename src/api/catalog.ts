import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { Category, Item } from "./types.js";

export interface SuggestedCategory {
  SubCategoryId: number;
  SubCategoryName: string;
  CatalogName: string;
}

export interface SearchResult {
  Items: Item[] | null;
  SuggestedSearchCategories: SuggestedCategory[] | null;
}

// Unwrapped: paging sits beside Object at the top level, as the site's own app sends it.
export function searchItems(c: HaziHinamClient, phrase: string, page = 1, pageSize = 20): Promise<SearchResult> {
  return c.post<SearchResult>(
    "item/getItemsBySearch",
    { Paging: { Page: page, PageSize: pageSize }, Object: { SearchPhrase: phrase, SearchPhrases: [], ItemGroupping: false } },
    { wrap: false },
  );
}

export async function suggestSearchPhrases(c: HaziHinamClient, phrase: string): Promise<string[]> {
  const { SuggestedSearchPhrases } = await c.get<{ SuggestedSearchPhrases: { Phrase: string }[] | null }>(
    "item/GetSuggestedSearchPhrases",
    { searchPhrase: phrase },
  );
  return (SuggestedSearchPhrases ?? []).map(p => p.Phrase);
}

export async function getItem(c: HaziHinamClient, itemId: number): Promise<Item | null> {
  return (await c.get<{ Item: Item | null }>(`item/${itemId}`)).Item ?? null;
}

export async function getItemByBarcode(c: HaziHinamClient, barcode: string): Promise<Item | null> {
  return (await c.get<{ Item: Item | null }>(`item/getItemByBarkod/${encodeURIComponent(barcode)}`)).Item ?? null;
}

export interface ProductDetails {
  ItemId: number;
  ShortDescription: string | null;
  IngredientSequenceandName: string | null;
  ManufacturerName: string | null;
  CountryofOrigin: string | null;
  UsageAndSafetyWarnings: string | null;
  TypeCodes: { Description: string; Value: string }[] | null;
  NutritionalValues_For100Gr: { NutritionalValueDescription: string; Quantity: string; UnitTypeDescription: string }[] | null;
}

export function getProductDetails(c: HaziHinamClient, itemId: number): Promise<ProductDetails> {
  return c.get<ProductDetails>(`item/GetItemGS1Details/${itemId}`);
}

export interface CatalogNode {
  Id: number;
  Name: string;
  SubCategories: { Id: number; Name: string }[] | null;
}

export interface Catalog {
  Campaign: CatalogNode | null;
  Categories: CatalogNode[] | null;
}

export function getCatalog(c: HaziHinamClient): Promise<Catalog> {
  return c.get<Catalog>("Catalog/get");
}

export async function getSubCategoryItems(c: HaziHinamClient, subCategoryId: number): Promise<{ name: string; items: Item[] }> {
  const { Category } = await c.get<{ Category: { SubCategory: { Name: string; Items: Item[] | null } | null } | null }>(
    "item/getItemsBySubCategory",
    { Id: subCategoryId, SortBy: -1, IsDescending: "false" },
  );
  return { name: Category?.SubCategory?.Name ?? "", items: Category?.SubCategory?.Items ?? [] };
}

export async function getPromotedItems(c: HaziHinamClient): Promise<Item[]> {
  const { PromotedItems } = await c.get<{ PromotedItems: { Items: Item[] | null } | null }>("item/getItemsPromoted", { SortBy: -1 });
  return PromotedItems?.Items ?? [];
}

// Not probed live: the site's web app reads Results.MivzaItems without showing its shape, so accept the three
// shapes the rest of the API uses for item collections.
function itemsFrom(value: unknown): Item[] {
  if (Array.isArray(value)) return value as Item[];
  if (value && typeof value === "object") {
    const v = value as { Items?: Item[] | null; Categories?: Category[] | null };
    if (Array.isArray(v.Items)) return v.Items;
    if (Array.isArray(v.Categories)) return flattenCategories(v.Categories);
  }
  return [];
}

export async function getPromotionItems(c: HaziHinamClient, promotionId: number): Promise<Item[]> {
  return itemsFrom((await c.get<{ MivzaItems: unknown }>(`item/getItemsInMivza/${promotionId}`)).MivzaItems);
}

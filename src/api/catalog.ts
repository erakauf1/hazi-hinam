import type { HaziHinamClient } from "../client.js";
import type { Item } from "./types.js";

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

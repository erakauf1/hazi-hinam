# Hazi Hinam Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Hazi Hinam MCP/CLI from "reorder my usual basket" to a near-complete shopping assistant: search and product details, browsing and promotions, favorites and shopping lists, addresses and stores, per-item remarks, changing the delivery slot of a placed order, answering substitution requests, and a barcode fallback when a saved product id is retired.

**Architecture:** Every capability is one `defineOperation` entry in `src/operations/*.ts`, registered in `src/operations/index.ts`; the CLI and MCP server are generated from that list and need no changes. Site calls live in `src/api/*.ts` as small typed functions over `HaziHinamClient`. One shared formatter (`describeItem`) turns the site's large product record into a compact, stable shape for assistants.

**Tech Stack:** TypeScript 7 (ESM/NodeNext, `strict`), zod 3.25, vitest, `@modelcontextprotocol/sdk`, Node ≥ 22.

**Sources:** `docs/API-SURVEY.md` (endpoint list, live response shapes), `docs/API.md` (conventions). Request shapes for endpoints that were not probed live come from the site's own web-app bundle and are quoted in each task.

## Global Constraints

- Node `>=22`, `"type": "module"`, TypeScript `strict: true`, relative imports end in `.js`.
- API base: `https://shop.hazi-hinam.co.il/proxy/api/`. Every request sends `Authorization: Bearer <token>`, `Accept: application/json`, `User-Agent: Mozilla/5.0`, and `DEVICE_INFO: {"DEVICE_TYPE":4,"UDID":"","MANUFACTURER":"","MODEL":"","VERSION":""}`.
- **POST/PUT bodies are wrapped as `{"Object": <payload>}`** unless a task explicitly says **unwrapped** (`wrap: false`). An empty payload is `{"Object":{}}`. The site's own app sends PUT bodies wrapped even when empty.
- Responses are `{ IsOK, Results, ErrorResponse }`; callers only ever see `Results`.
- **Payment is out of scope for this version.** Do not call `order/post`, `user/cc`, or `user/GetIFrameURL`; the client refuses these paths before any network I/O. Editing the *items* of a placed order is also out of scope, because the site commits item edits through checkout (`order/post`). Changing only the delivery slot of a placed order (`order/ChangeDraftOrderShipping`) is in scope.
- **Never solve, bypass, or automate the login CAPTCHA.** The user logs in themselves.
- Personal data (token, usual order) lives only in the config dir; never commit real tokens, order IDs, totals, names, addresses, or the usual order. Test fixtures use made-up values.
- Operation names are snake_case (`^[a-z]+(_[a-z]+)*$`); inputs that are numbers use `z.coerce.number()` so the CLI's string flags work; list-valued inputs are comma-separated strings (the CLI has no array flags).
- `readOnly: true` only for operations with no side effects. `destructive: true` for operations that remove or replace user data that cannot simply be re-added (clearing, replacing).
- Addresses returned to assistants never include coordinates, Google place data, or free-text notes.
- The site's API names contain typos that must be kept exactly: `getItemByBarkod`, `ItemGroupping`, `OpenningTimeFrame`, `getItemsRemarks`.

## File Structure

| File | Responsibility |
|---|---|
| `src/client.ts` (modify) | `post(path, payload, { wrap, query })`, new `put()` |
| `src/api/types.ts` (modify) | Optional catalog fields on `Item`; editable-order fields on `OrderSummary` |
| `src/api/catalog.ts` (create) | Search, suggestions, product by id/barcode, GS1 details, catalog tree, sub-category, promoted, promotion items |
| `src/api/lists.ts` (create) | Favorites and shopping lists |
| `src/api/places.ts` (create) | Addresses, default address, pickup stores, branches |
| `src/api/remarks.ts` (create) | Per-item remarks |
| `src/api/substitutions.ts` (create) | SSCS suggested substitutes and answers |
| `src/api/orders.ts` (modify) | `changeOrderShipping` |
| `src/operations/format.ts` (create) | `describeItem` |
| `src/operations/{catalog,browse,lists,places,remarks}.ts` (create) | New operations |
| `src/operations/orders.ts` (modify) | Editable info in `list_orders`; `change_order_delivery_slot`; substitution operations |
| `src/usual-order.ts` (modify) | Barcode fallback during replay |
| `src/operations/usual-order.ts` (modify) | Report remapped items |
| `src/operations/index.ts` (modify) | Register every new operation |
| `src/mcp.ts` (modify) | Instructions mention the new capabilities |
| `test/helpers.ts` (modify) | `signedIn()` and `runOp()` shared test helpers |
| `README.md`, `docs/API-SURVEY.md` (modify) | Command table; MCP column `next` → `v2` for built endpoints |

---

### Task 1: Client options and shared test helpers

**Files:**
- Modify: `src/client.ts` (the `post` method; add `put`)
- Modify: `test/helpers.ts` (append two helpers)
- Test: `test/client.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: existing `HaziHinamClient`, `createContext`, `operations`, `fakeFetch`, `tempStore`.
- Produces:
  - `interface PostOptions { wrap?: boolean; query?: Record<string, string | number> }` (exported from `src/client.ts`)
  - `HaziHinamClient.post<T>(path: string, payload?: unknown, options?: PostOptions): Promise<T>` — `wrap` defaults to `true`
  - `HaziHinamClient.put<T>(path: string, payload?: unknown): Promise<T>` — always wrapped
  - test helpers: `NOW: Date`, `signedIn(routes, now?) → Promise<{ ctx, calls, store }>`, `runOp(ctx, name, args?) → Promise<unknown>`

- [ ] **Step 1: Write the failing tests**

Append to `test/client.test.ts`:

```ts
describe("HaziHinamClient POST options and PUT", () => {
  it("sends an unwrapped body when wrap is false", async () => {
    const f = fakeFetch({ "POST item/getItemsBySearch": { Items: [] } });
    const body = { Paging: { Page: 1, PageSize: 20 }, Object: { SearchPhrase: "milk" } };
    await new HaziHinamClient("t", { fetch: f.fetch }).post("item/getItemsBySearch", body, { wrap: false });
    expect(f.calls[0].body).toEqual(body);
  });

  it("adds query parameters to a POST", async () => {
    const f = fakeFetch({ "POST order/ChangeDraftOrderShipping/": null });
    await new HaziHinamClient("t", { fetch: f.fetch }).post("order/ChangeDraftOrderShipping/", { ShipmentId: 3 }, { query: { Id: 77 } });
    expect(f.calls[0].url.searchParams.get("Id")).toBe("77");
    expect(f.calls[0].body).toEqual({ Object: { ShipmentId: 3 } });
  });

  it("wraps PUT bodies, including an empty one", async () => {
    const f = fakeFetch({ "PUT address/setDefault/4": null });
    await new HaziHinamClient("t", { fetch: f.fetch }).put("address/setDefault/4");
    expect(f.calls[0].method).toBe("PUT");
    expect(f.calls[0].body).toEqual({ Object: {} });
  });

  it("still refuses payment paths for unwrapped POST and PUT", async () => {
    const f = fakeFetch({});
    const c = new HaziHinamClient("t", { fetch: f.fetch });
    await expect(c.post("order/post", {}, { wrap: false })).rejects.toBeInstanceOf(ForbiddenOperation);
    await expect(c.put("user/cc")).rejects.toBeInstanceOf(ForbiddenOperation);
    expect(f.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/client.test.ts`
Expected: FAIL — the unwrapped body arrives wrapped, the query is missing, and `c.put is not a function`.

- [ ] **Step 3: Implement**

In `src/client.ts`, add after `ClientOptions`:

```ts
export interface PostOptions {
  wrap?: boolean;
  query?: Record<string, string | number>;
}
```

Replace the `post` method and its comment, and add `put` after it:

```ts
  // The site's ApiService wraps POST/PUT bodies as {Object}; a bare body where it expects a wrapped one is answered
  // with HTTP 500. A few calls opt out (search, list-to-cart, substitutions) and send their own top-level body.
  post<T>(path: string, payload: unknown = {}, options: PostOptions = {}): Promise<T> {
    const body = options.wrap === false ? payload : { Object: payload };
    return this.request<T>("POST", path, body, options.query);
  }

  put<T>(path: string, payload: unknown = {}): Promise<T> {
    return this.request<T>("PUT", path, { Object: payload });
  }
```

`request` already accepts `query` as its fourth parameter with a default of `{}`, so passing `undefined` is fine.

Append to `test/helpers.ts` (add the imports at the top of the file with the others):

```ts
import { z } from "zod";
import { createContext } from "../src/context.js";
import { operations } from "../src/operations/index.js";

export const NOW = new Date("2026-09-29T19:00:00Z");

export async function signedIn(routes: Record<string, unknown>, now: Date = NOW) {
  const store = await tempStore();
  await store.saveSession("tok", 172800, now);
  const f = fakeFetch(routes);
  return { ctx: createContext({ store, fetch: f.fetch, now: () => now }), calls: f.calls, store };
}

export function runOp(ctx: ReturnType<typeof createContext>, name: string, args: Record<string, unknown> = {}) {
  const op = operations.find(o => o.name === name);
  if (!op) throw new Error(`no operation ${name}`);
  return op.run(ctx, z.object(op.input).parse(args));
}
```

Existing test files keep their own local copies of these helpers; do not refactor them.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (88 existing + 4 new); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts test/client.test.ts test/helpers.ts
git commit -m "feat: unwrapped POST, POST query parameters and PUT in the client"
```

---

### Task 2: Product formatter, search and product details

**Files:**
- Modify: `src/api/types.ts` (optional fields on `Item`; new `Promotion`, `UnitOption`)
- Create: `src/api/catalog.ts`, `src/operations/format.ts`, `src/operations/catalog.ts`
- Modify: `src/operations/index.ts` (register four operations after `status`)
- Test: `test/catalog.test.ts`

**Interfaces:**
- Consumes: `HaziHinamClient.post(..., { wrap: false })` (Task 1), `signedIn`, `runOp`, `item` (test helpers), `unitName` (`src/operations/define.ts`), `HaziHinamError`.
- Produces:
  - `describeItem(i: Item): ItemView` in `src/operations/format.ts` (used by Tasks 3, 4, 7)
  - `searchItems(c, phrase, page?, pageSize?)`, `suggestSearchPhrases(c, phrase)`, `getItem(c, itemId)`, `getItemByBarcode(c, barcode)`, `getProductDetails(c, itemId)` in `src/api/catalog.ts` (`getItemByBarcode` is used by Task 8)
  - Operations: `search_products`, `suggest_search_phrases`, `get_product`, `get_product_details`

Live shapes (docs/API-SURVEY.md, Catalog):
- `POST item/getItemsBySearch` — **unwrapped** body `{Paging:{Page,PageSize},Object:{SearchPhrase,SearchPhrases:[],ItemGroupping:false}}` → `{ Items: Item[], Categories, SearchPhrases, SuggestedSearchCategories: [{SuggestedSearchCategoryName, SubCategoryId, SubCategoryName, CatalogId, CatalogName}] }`
- `GET item/GetSuggestedSearchPhrases?searchPhrase=` → `{ SuggestedSearchPhrases: [{Phrase, HighlightPhrase}] }`
- `GET item/{id}` and `GET item/getItemByBarkod/{barcode}` → `{ Item }`
- `GET item/GetItemGS1Details/{id}` → `{ ItemId, Barcode, IngredientSequenceandName, ShortDescription, Remarks, ManufacturerName, ManufacturerAddress, UsageAndSafetyWarnings, CountryofOrigin, TypeCodes: [{TypeCode, Description, Value}], NutritionalValues_For100Gr: [{NutritionalValueDescription, Quantity, UnitTypeDescription, …}], … }`

- [ ] **Step 1: Write the failing tests**

`test/catalog.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/catalog.test.ts`
Expected: FAIL — `Cannot find module '../src/operations/format.js'`.

- [ ] **Step 3: Implement**

In `src/api/types.ts`, add above `Item` and replace `Item`:

```ts
export interface Promotion {
  MivzaId: number;
  MivzaDesc: string;
  MivzaText: string;
}

export interface UnitOption {
  Type: number; // 1 = unit, 2 = kg
  Interval: number;
  ItemUnitTypeDesc: string;
  MaxQuantity: number;
}

// Catalog fields are optional: the cart and order endpoints return the same record, and tests build minimal ones.
export interface Item {
  Id: number;
  BarKod: string;
  Name: string;
  IsInStock: boolean;
  Price_NET: number;
  Cart: CartLine | null;
  ManufacturerName?: string | null;
  CategoryName?: string | null;
  SubCategoryName?: string | null;
  UnitSizeDesc?: string | null;
  PricePerUnitDesc?: string | null;
  Price_Regular?: number | null;
  IsFavorites?: boolean;
  IsRemarks?: boolean;
  Mivza?: Promotion | null;
  ItemQuantityTypes?: { ConversionRate: number; Types: UnitOption[] | null } | null;
}
```

`src/api/catalog.ts`:

```ts
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
```

`src/operations/format.ts`:

```ts
import type { Item } from "../api/types.js";
import { unitName } from "./define.js";

const text = (value: string | null | undefined) => (value ? value : undefined);

export function describeItem(i: Item) {
  const units = (i.ItemQuantityTypes?.Types ?? []).map(t => unitName(t.Type));
  return {
    itemId: i.Id,
    barcode: i.BarKod,
    name: i.Name,
    brand: text(i.ManufacturerName),
    size: text(i.UnitSizeDesc),
    price: i.Price_NET,
    regularPrice: i.Price_Regular != null && i.Price_Regular !== i.Price_NET ? i.Price_Regular : undefined,
    pricePerUnit: text(i.PricePerUnitDesc),
    inStock: i.IsInStock,
    units: units.length ? units : ["unit"],
    promotion: i.Mivza ? { promotionId: i.Mivza.MivzaId, text: i.Mivza.MivzaDesc } : undefined,
    inCart: i.Cart && i.Cart.Quantity > 0 ? { quantity: i.Cart.Quantity, unit: unitName(i.Cart.ItemQuantityType) } : undefined,
    favorite: i.IsFavorites ? true : undefined,
  };
}

export type ItemView = ReturnType<typeof describeItem>;
```

`src/operations/catalog.ts`:

```ts
import { z } from "zod";
import { getItem, getItemByBarcode, getProductDetails, searchItems, suggestSearchPhrases } from "../api/catalog.js";
import { HaziHinamError } from "../errors.js";
import { defineOperation } from "./define.js";
import { describeItem } from "./format.js";

export const searchProductsOp = defineOperation({
  name: "search_products",
  description: "Search the Hazi Hinam catalog (Hebrew or English). Returns products with price, size, stock, promotion and whether they are already in the cart, plus suggested categories.",
  input: {
    query: z.string().trim().min(1).max(100),
    page: z.coerce.number().int().min(1).max(50).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  },
  readOnly: true,
  async run(ctx, { query, page, pageSize }) {
    const result = await searchItems(await ctx.client(), query, page, pageSize);
    return {
      items: (result.Items ?? []).map(describeItem),
      suggestedCategories: (result.SuggestedSearchCategories ?? []).map(s => ({
        subCategoryId: s.SubCategoryId,
        name: s.SubCategoryName,
        category: s.CatalogName,
      })),
    };
  },
});

export const suggestSearchPhrasesOp = defineOperation({
  name: "suggest_search_phrases",
  description: "Autocomplete: search phrases the site suggests for the start of a word. Useful before search_products when the product name is uncertain.",
  input: { query: z.string().trim().min(1).max(100) },
  readOnly: true,
  run: async (ctx, { query }) => suggestSearchPhrases(await ctx.client(), query),
});

export const getProductOp = defineOperation({
  name: "get_product",
  description: "Get one product by itemId or by barcode (give exactly one), with price, size, stock, promotion and category.",
  input: {
    itemId: z.coerce.number().int().positive().optional(),
    barcode: z.string().regex(/^\d{4,14}$/).optional(),
  },
  readOnly: true,
  async run(ctx, { itemId, barcode }) {
    if ((itemId === undefined) === (barcode === undefined)) {
      throw new HaziHinamError("BAD_INPUT", "Give exactly one of itemId and barcode.");
    }
    const client = await ctx.client();
    const found = itemId !== undefined ? await getItem(client, itemId) : await getItemByBarcode(client, barcode!);
    if (!found) throw new HaziHinamError("NOT_FOUND", `No product found for ${itemId ?? barcode}.`);
    return { ...describeItem(found), category: found.CategoryName ?? undefined, subCategory: found.SubCategoryName ?? undefined };
  },
});

export const getProductDetailsOp = defineOperation({
  name: "get_product_details",
  description: "Ingredients, nutrition per 100 g, allergens/kosher attributes, manufacturer and country of origin for one product. Use for dietary questions.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { itemId }) {
    const d = await getProductDetails(await ctx.client(), itemId);
    return {
      itemId: d.ItemId,
      description: d.ShortDescription || undefined,
      ingredients: d.IngredientSequenceandName || undefined,
      manufacturer: d.ManufacturerName || undefined,
      countryOfOrigin: d.CountryofOrigin || undefined,
      warnings: d.UsageAndSafetyWarnings || undefined,
      attributes: (d.TypeCodes ?? []).map(t => ({ name: t.Description, value: t.Value })),
      nutritionPer100g: (d.NutritionalValues_For100Gr ?? []).map(n => ({
        name: n.NutritionalValueDescription,
        amount: `${n.Quantity} ${n.UnitTypeDescription}`.trim(),
      })),
    };
  },
});
```

In `src/operations/index.ts`, import the four operations and insert them into `operations` right after `status`:

```ts
import { getProductDetailsOp, getProductOp, searchProductsOp, suggestSearchPhrasesOp } from "./catalog.js";
// …
export const operations: Operation[] = [
  status,
  searchProductsOp,
  suggestSearchPhrasesOp,
  getProductOp,
  getProductDetailsOp,
  listOrdersOp,
  // … the rest unchanged
];
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors. The existing MCP test that counts tools, if any, may need its expected count updated — update it to `operations.length`, not a literal.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/catalog.ts src/operations/format.ts src/operations/catalog.ts src/operations/index.ts test/catalog.test.ts
git commit -m "feat: product search, suggestions, product lookup and GS1 details"
```

---

### Task 3: Browsing categories and promotions

**Files:**
- Modify: `src/api/catalog.ts` (append)
- Create: `src/operations/browse.ts`
- Modify: `src/operations/index.ts` (register four operations after `get_product_details`)
- Test: `test/browse.test.ts`

**Interfaces:**
- Consumes: `describeItem` (Task 2), `flattenCategories` (`src/api/items.ts`), `signedIn`, `runOp`, `item`.
- Produces: `getCatalog`, `getSubCategoryItems`, `getPromotedItems`, `getPromotionItems` in `src/api/catalog.ts`; operations `list_categories`, `list_category_products`, `list_promoted_products`, `get_promotion_products`.

Live shapes:
- `GET Catalog/get` → `{ Campaign: {Id, Name, SubCategories:[{Id, Name, …}]} | null, Categories: [{Id, Name, SubCategories:[{Id, Name, …}]}] }`
- `GET item/getItemsBySubCategory?Id=&SortBy=-1&IsDescending=false` → `{ Category: { Id, Name, SubCategory: { Id, Name, Items: Item[] } }, Filters, Sorts }`
- `GET item/getItemsPromoted?SortBy=-1` → `{ PromotedItems: { Items: Item[] } }`
- `GET item/getItemsInMivza/{id}` — **not probed live**. The site's web app reads `Results.MivzaItems`. Accept a list of items, `{ Items }`, or `{ Categories }`.

- [ ] **Step 1: Write the failing tests**

`test/browse.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/browse.test.ts`
Expected: FAIL — `no operation list_categories`.

- [ ] **Step 3: Implement**

Append to `src/api/catalog.ts` (add `Category` to the type import and import `flattenCategories` from `./items.js`):

```ts
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
```

`src/operations/browse.ts`:

```ts
import { z } from "zod";
import { type CatalogNode, getCatalog, getPromotedItems, getPromotionItems, getSubCategoryItems } from "../api/catalog.js";
import { defineOperation } from "./define.js";
import { describeItem } from "./format.js";

const subCategories = (node: CatalogNode) => (node.SubCategories ?? []).map(s => ({ subCategoryId: s.Id, name: s.Name }));

export const listCategoriesOp = defineOperation({
  name: "list_categories",
  description: "List the store's categories and their sub-categories (with ids for list_category_products), plus the current seasonal campaign.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const catalog = await getCatalog(await ctx.client());
    return {
      campaign: catalog.Campaign ? { name: catalog.Campaign.Name, subCategories: subCategories(catalog.Campaign) } : null,
      categories: (catalog.Categories ?? []).map(c => ({ categoryId: c.Id, name: c.Name, subCategories: subCategories(c) })),
    };
  },
});

export const listCategoryProductsOp = defineOperation({
  name: "list_category_products",
  description: "List the products in one sub-category (ids come from list_categories or search_products' suggestedCategories).",
  input: { subCategoryId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { subCategoryId }) {
    const { name, items } = await getSubCategoryItems(await ctx.client(), subCategoryId);
    return { subCategory: name, items: items.map(describeItem) };
  },
});

export const listPromotedProductsOp = defineOperation({
  name: "list_promoted_products",
  description: "List the products the store is currently promoting (deals and featured products).",
  input: {},
  readOnly: true,
  run: async ctx => (await getPromotedItems(await ctx.client())).map(describeItem),
});

export const getPromotionProductsOp = defineOperation({
  name: "get_promotion_products",
  description: "List every product that takes part in one promotion (the promotionId shown on a product), e.g. to complete a 'buy 3' deal.",
  input: { promotionId: z.coerce.number().int().positive() },
  readOnly: true,
  run: async (ctx, { promotionId }) => (await getPromotionItems(await ctx.client(), promotionId)).map(describeItem),
});
```

In `src/operations/index.ts`, import the four and insert them right after `getProductDetailsOp`:

```ts
import { getPromotionProductsOp, listCategoriesOp, listCategoryProductsOp, listPromotedProductsOp } from "./browse.js";
// … in operations, after getProductDetailsOp:
  listCategoriesOp,
  listCategoryProductsOp,
  listPromotedProductsOp,
  getPromotionProductsOp,
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/catalog.ts src/operations/browse.ts src/operations/index.ts test/browse.test.ts
git commit -m "feat: browse categories and promotions"
```

---

### Task 4: Favorites and shopping lists

**Files:**
- Create: `src/api/lists.ts`, `src/operations/lists.ts`
- Modify: `src/operations/index.ts` (register seven operations after `get_promotion_products`)
- Test: `test/lists.test.ts`

**Interfaces:**
- Consumes: `describeItem` (Task 2), `flattenCategories`, `unitType` (`src/operations/define.ts`), `HaziHinamClient.post(..., { wrap: false })` (Task 1), `signedIn`, `runOp`, `item`.
- Produces: operations `list_favorites`, `add_favorite`, `remove_favorite`, `list_shopping_lists`, `get_shopping_list`, `create_shopping_list`, `add_shopping_list_to_cart`.

Shapes (live unless noted):
- `GET item/getItemsFav?SortBy=-1` → `{ FavoriteItems: { Categories: [{Id, Name, Items, ItemsCount}] } }`
- `POST item/addItemToFavorites` — wrapped `{ItemId, Quantity, Type}`; the site sends `Quantity: 0` when no amount is chosen (bundle; not probed).
- `DELETE item/RemoveItemFromFavorites/{id}` (bundle; not probed).
- `GET shoppinglist/get` → `{ IsFavorites, FavoritesCount, ShoppingList: [{Id, Name, ItemsCount}] }`
- `GET item/getItemsByShoppingList/{id}` → `{ ShoppingListItems: { Categories: [...] } }`
- `POST shoppinglist/post` — wrapped `{Name, OrderId, Order_Draft_Id}` (bundle; not probed). Seeding from an order is optional.
- `POST item/addShoppingListItemsToCart/{id}` — **unwrapped** empty body `{}` (bundle; not probed). Adds every product at the site's default amount.

- [ ] **Step 1: Write the failing tests**

`test/lists.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lists.test.ts`
Expected: FAIL — `no operation list_favorites`.

- [ ] **Step 3: Implement**

`src/api/lists.ts`:

```ts
import type { HaziHinamClient } from "../client.js";
import { flattenCategories } from "./items.js";
import type { Category, Item } from "./types.js";

export async function listFavorites(c: HaziHinamClient): Promise<Item[]> {
  const { FavoriteItems } = await c.get<{ FavoriteItems: { Categories: Category[] | null } | null }>("item/getItemsFav", { SortBy: -1 });
  return flattenCategories(FavoriteItems?.Categories);
}

export async function addFavorite(c: HaziHinamClient, itemId: number, type: number): Promise<void> {
  await c.post("item/addItemToFavorites", { ItemId: itemId, Quantity: 0, Type: type });
}

export async function removeFavorite(c: HaziHinamClient, itemId: number): Promise<void> {
  await c.delete(`item/RemoveItemFromFavorites/${itemId}`);
}

export interface ShoppingListSummary {
  Id: number;
  Name: string;
  ItemsCount: number;
}

export function listShoppingLists(c: HaziHinamClient) {
  return c.get<{ FavoritesCount: number; ShoppingList: ShoppingListSummary[] | null }>("shoppinglist/get");
}

export async function getShoppingListItems(c: HaziHinamClient, listId: number): Promise<Item[]> {
  const { ShoppingListItems } = await c.get<{ ShoppingListItems: { Categories: Category[] | null } | null }>(
    `item/getItemsByShoppingList/${listId}`,
  );
  return flattenCategories(ShoppingListItems?.Categories);
}

export async function createShoppingList(c: HaziHinamClient, name: string, fromOrderId?: number): Promise<void> {
  await c.post("shoppinglist/post", { Name: name, OrderId: fromOrderId ?? null, Order_Draft_Id: null });
}

// Unwrapped, like the site's own call. Products arrive at the site's default amounts.
export async function addShoppingListToCart(c: HaziHinamClient, listId: number): Promise<void> {
  await c.post(`item/addShoppingListItemsToCart/${listId}`, {}, { wrap: false });
}
```

`src/operations/lists.ts`:

```ts
import { z } from "zod";
import {
  addFavorite, addShoppingListToCart, createShoppingList, getShoppingListItems, listFavorites, listShoppingLists, removeFavorite,
} from "../api/lists.js";
import { defineOperation, unitType } from "./define.js";
import { describeItem } from "./format.js";

export const listFavoritesOp = defineOperation({
  name: "list_favorites",
  description: "List the products the user marked as favorites on the site.",
  input: {},
  readOnly: true,
  run: async ctx => (await listFavorites(await ctx.client())).map(describeItem),
});

export const addFavoriteOp = defineOperation({
  name: "add_favorite",
  description: "Mark a product as a favorite on the user's account.",
  input: { itemId: z.coerce.number().int().positive(), unit: z.enum(["unit", "kg"]).default("unit") },
  readOnly: false,
  async run(ctx, { itemId, unit }) {
    await addFavorite(await ctx.client(), itemId, unitType(unit));
    return { itemId, favorite: true };
  },
});

export const removeFavoriteOp = defineOperation({
  name: "remove_favorite",
  description: "Remove a product from the user's favorites.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { itemId }) {
    await removeFavorite(await ctx.client(), itemId);
    return { itemId, favorite: false };
  },
});

export const listShoppingListsOp = defineOperation({
  name: "list_shopping_lists",
  description: "List the user's saved shopping lists on the site (names and item counts; the site stores products, not amounts).",
  input: {},
  readOnly: true,
  async run(ctx) {
    const result = await listShoppingLists(await ctx.client());
    return {
      favoritesCount: result.FavoritesCount,
      lists: (result.ShoppingList ?? []).map(l => ({ listId: l.Id, name: l.Name, itemCount: l.ItemsCount })),
    };
  },
});

export const getShoppingListOp = defineOperation({
  name: "get_shopping_list",
  description: "List the products in one saved shopping list.",
  input: { listId: z.coerce.number().int().positive() },
  readOnly: true,
  run: async (ctx, { listId }) => (await getShoppingListItems(await ctx.client(), listId)).map(describeItem),
});

export const createShoppingListOp = defineOperation({
  name: "create_shopping_list",
  description: "Create a new shopping list on the site, optionally filled with the products of a past order (fromOrderId). Lists store products, not amounts.",
  input: { name: z.string().trim().min(1).max(60), fromOrderId: z.coerce.number().int().positive().optional() },
  readOnly: false,
  async run(ctx, { name, fromOrderId }) {
    await createShoppingList(await ctx.client(), name, fromOrderId);
    return { created: true, name };
  },
});

export const addShoppingListToCartOp = defineOperation({
  name: "add_shopping_list_to_cart",
  description: "Add every product of a saved shopping list to the cart at the site's default amounts (1 unit / minimum weight). Prefer prepare_usual_order when exact amounts matter.",
  input: { listId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { listId }) {
    await addShoppingListToCart(await ctx.client(), listId);
    return { listId, note: "Added at the site's default amounts. Review them in the cart." };
  },
});
```

In `src/operations/index.ts`, import the seven and insert them right after `getPromotionProductsOp`:

```ts
import {
  addFavoriteOp, addShoppingListToCartOp, createShoppingListOp, getShoppingListOp, listFavoritesOp, listShoppingListsOp, removeFavoriteOp,
} from "./lists.js";
// … in operations, after getPromotionProductsOp:
  listFavoritesOp,
  addFavoriteOp,
  removeFavoriteOp,
  listShoppingListsOp,
  getShoppingListOp,
  createShoppingListOp,
  addShoppingListToCartOp,
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/lists.ts src/operations/lists.ts src/operations/index.ts test/lists.test.ts
git commit -m "feat: favorites and shopping lists"
```

---

### Task 5: Addresses and stores

**Files:**
- Create: `src/api/places.ts`, `src/operations/places.ts`
- Modify: `src/operations/index.ts` (register four operations after `list_delivery_slots`)
- Test: `test/places.test.ts`

**Interfaces:**
- Consumes: `HaziHinamClient.put` (Task 1), `signedIn`, `runOp`.
- Produces: operations `list_addresses`, `set_default_address`, `list_pickup_stores`, `list_branches`.

Shapes (live unless noted):
- `GET Address/get` → `{ Addresses: [{ Id, AddressDescription, City, Street, Number, Apartment, Floor, Entrance, IsDefault, IsSelfPickUp, AddressCoordinatesVerified, Latitude, Longitude, Google*, Notes, … }] }` — **only the listed output fields are passed on** (Global Constraints).
- `PUT address/setDefault/{id}` — wrapped empty body (bundle; not probed).
- `GET distribution/getStores` → `{ Stores: [{Id, Name}] }` — pickup points; the ids are the `storeId` used by `change_order_delivery_slot` (Task 7).
- `GET Branches` → `{ Branches: [{ Code, IsActive, Name, Address, Phone, IsSelfPickUp, Day_1 … Day_7: { DayDescription, IsActive, OpenningTimeFrame: { From: {Hour, Minute}, To: {Hour, Minute} } | null, Notes }, … }] }`

- [ ] **Step 1: Write the failing tests**

`test/places.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runOp, signedIn } from "./helpers.js";

const address = {
  Id: 4, AddressDescription: "Home", City: "Testville", Street: "Main", Number: "1", Apartment: "2", Floor: "3", Entrance: null,
  IsDefault: true, IsSelfPickUp: false, AddressCoordinatesVerified: true, Latitude: 32.1, Longitude: 34.8,
  GooglePlaceId: "g", Notes: "gate code 1234",
};

describe("addresses", () => {
  it("lists addresses without coordinates, Google data or notes", async () => {
    const { ctx } = await signedIn({ "GET Address/get": { Addresses: [address] } });
    const result = await runOp(ctx, "list_addresses");
    expect(result).toEqual([{
      addressId: 4, label: "Home", city: "Testville", street: "Main", number: "1", apartment: "2", floor: "3",
      isDefault: true, selfPickup: false, verified: true,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/32\.1|gate code|"g"/);
  });

  it("sets the default address with a wrapped empty PUT", async () => {
    const { ctx, calls } = await signedIn({ "PUT address/setDefault/4": null });
    expect(await runOp(ctx, "set_default_address", { addressId: "4" })).toEqual({ addressId: 4, isDefault: true });
    expect(calls[0].body).toEqual({ Object: {} });
  });
});

describe("stores", () => {
  it("lists pickup stores", async () => {
    const { ctx } = await signedIn({ "GET distribution/getStores": { Stores: [{ Id: 70, Name: "Center" }] } });
    expect(await runOp(ctx, "list_pickup_stores")).toEqual([{ storeId: 70, name: "Center" }]);
  });

  it("lists active branches with weekly hours", async () => {
    const day = (name: string, open: boolean) => ({
      DayDescription: name, IsActive: open, IsActiveByCurrentDateTime: false, Notes: "",
      OpenningTimeFrame: open ? { From: { Hour: 7, Minute: 0 }, To: { Hour: 22, Minute: 30 } } : null,
    });
    const branch = {
      Code: 1, IsActive: true, Name: "Center", Address: "1 Main St", Phone: "03-0000000", IsSelfPickUp: true,
      Day_1: day("Sun", true), Day_2: day("Mon", true), Day_3: day("Tue", true), Day_4: day("Wed", true),
      Day_5: day("Thu", true), Day_6: day("Fri", true), Day_7: day("Sat", false),
    };
    const { ctx } = await signedIn({ "GET Branches": { Branches: [branch, { ...branch, Code: 2, IsActive: false }] } });
    const result = (await runOp(ctx, "list_branches")) as any[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ branchId: 1, name: "Center", address: "1 Main St", phone: "03-0000000", pickup: true });
    expect(result[0].hours[0]).toEqual({ day: "Sun", open: "07:00", close: "22:30" });
    expect(result[0].hours[6]).toEqual({ day: "Sat", closed: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/places.test.ts`
Expected: FAIL — `no operation list_addresses`.

- [ ] **Step 3: Implement**

`src/api/places.ts`:

```ts
import type { HaziHinamClient } from "../client.js";

export interface Address {
  Id: number;
  AddressDescription: string | null;
  City: string | null;
  Street: string | null;
  Number: string | null;
  Apartment: string | null;
  Floor: string | null;
  IsDefault: boolean;
  IsSelfPickUp: boolean;
  AddressCoordinatesVerified: boolean;
}

export async function listAddresses(c: HaziHinamClient): Promise<Address[]> {
  return (await c.get<{ Addresses: Address[] | null }>("Address/get")).Addresses ?? [];
}

export async function setDefaultAddress(c: HaziHinamClient, addressId: number): Promise<void> {
  await c.put(`address/setDefault/${addressId}`);
}

export async function listPickupStores(c: HaziHinamClient): Promise<{ Id: number; Name: string }[]> {
  return (await c.get<{ Stores: { Id: number; Name: string }[] | null }>("distribution/getStores")).Stores ?? [];
}

interface Clock { Hour: number; Minute: number }

export interface BranchDay {
  DayDescription: string;
  IsActive: boolean;
  OpenningTimeFrame: { From: Clock; To: Clock } | null;
}

export interface Branch {
  Code: number;
  IsActive: boolean;
  Name: string;
  Address: string;
  Phone: string;
  IsSelfPickUp: boolean;
  Day_1: BranchDay; Day_2: BranchDay; Day_3: BranchDay; Day_4: BranchDay; Day_5: BranchDay; Day_6: BranchDay; Day_7: BranchDay;
}

export async function listBranches(c: HaziHinamClient): Promise<Branch[]> {
  return (await c.get<{ Branches: Branch[] | null }>("Branches")).Branches ?? [];
}
```

`src/operations/places.ts`:

```ts
import { z } from "zod";
import { type BranchDay, listAddresses, listBranches, listPickupStores, setDefaultAddress } from "../api/places.js";
import { defineOperation } from "./define.js";

const clock = (t: { Hour: number; Minute: number }) => `${String(t.Hour).padStart(2, "0")}:${String(t.Minute).padStart(2, "0")}`;
const hours = (d: BranchDay) =>
  d.IsActive && d.OpenningTimeFrame
    ? { day: d.DayDescription, open: clock(d.OpenningTimeFrame.From), close: clock(d.OpenningTimeFrame.To) }
    : { day: d.DayDescription, closed: true };

export const listAddressesOp = defineOperation({
  name: "list_addresses",
  description: "List the user's saved delivery addresses (ids are used by list_delivery_slots and change_order_delivery_slot).",
  input: {},
  readOnly: true,
  async run(ctx) {
    return (await listAddresses(await ctx.client())).map(a => ({
      addressId: a.Id,
      label: a.AddressDescription ?? undefined,
      city: a.City ?? undefined,
      street: a.Street ?? undefined,
      number: a.Number ?? undefined,
      apartment: a.Apartment ?? undefined,
      floor: a.Floor ?? undefined,
      isDefault: a.IsDefault,
      selfPickup: a.IsSelfPickUp,
      verified: a.AddressCoordinatesVerified,
    }));
  },
});

export const setDefaultAddressOp = defineOperation({
  name: "set_default_address",
  description: "Make one saved address the user's default delivery address.",
  input: { addressId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { addressId }) {
    await setDefaultAddress(await ctx.client(), addressId);
    return { addressId, isDefault: true };
  },
});

export const listPickupStoresOp = defineOperation({
  name: "list_pickup_stores",
  description: "List the stores where an order can be picked up (storeId is used by change_order_delivery_slot).",
  input: {},
  readOnly: true,
  run: async ctx => (await listPickupStores(await ctx.client())).map(s => ({ storeId: s.Id, name: s.Name })),
});

export const listBranchesOp = defineOperation({
  name: "list_branches",
  description: "List the chain's open branches with address, phone, whether pickup is available, and opening hours for each weekday.",
  input: {},
  readOnly: true,
  async run(ctx) {
    return (await listBranches(await ctx.client()))
      .filter(b => b.IsActive)
      .map(b => ({
        branchId: b.Code,
        name: b.Name,
        address: b.Address,
        phone: b.Phone,
        pickup: b.IsSelfPickUp,
        hours: [b.Day_1, b.Day_2, b.Day_3, b.Day_4, b.Day_5, b.Day_6, b.Day_7].map(hours),
      }));
  },
});
```

In `src/operations/index.ts`, import the four and insert them right after `listDeliverySlotsOp`:

```ts
import { listAddressesOp, listBranchesOp, listPickupStoresOp, setDefaultAddressOp } from "./places.js";
// … in operations, after listDeliverySlotsOp:
  listAddressesOp,
  setDefaultAddressOp,
  listPickupStoresOp,
  listBranchesOp,
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/places.ts src/operations/places.ts src/operations/index.ts test/places.test.ts
git commit -m "feat: addresses, pickup stores and branch hours"
```

---

### Task 6: Per-item remarks

**Files:**
- Create: `src/api/remarks.ts`, `src/operations/remarks.ts`
- Modify: `src/operations/index.ts` (register three operations after `clear_cart`)
- Test: `test/remarks.test.ts`

**Interfaces:**
- Consumes: `signedIn`, `runOp`, `HaziHinamError`.
- Produces: operations `get_item_remark_options`, `set_item_remark`, `clear_item_remark`.

Remarks are instructions for the picker on a cart line (e.g. ripeness, slicing, free text). Shapes:
- `GET item/getItemsRemarks/{id}` → `{ ItemRemarks: { IsFreeRemark, IsFixRemark, FreeRemarkText, MultiSelectRemarks: [{Id, Name, IsSelected}] | null, SingleSelectRemarks: [{Id, Name, IsSelected}] | null } }` (live; option fields from the site's bundle).
- `POST item/saveItemRemarks` — wrapped `{ItemId, OrderId, FreeRemarkText, MultiRemarkIds, SingleRemarkId}` (bundle; not probed). `OrderId` is `null` for the cart.
- `DELETE item/deleteItemRemarks/{id}` (bundle; not probed).

A product offers either multi-select options, single-select options, or neither; `set_item_remark` reads the options first so it can send the ids in the right field and reject ids the product does not offer.

- [ ] **Step 1: Write the failing tests**

`test/remarks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runOp, signedIn } from "./helpers.js";

const single = {
  ItemRemarks: {
    IsFreeRemark: true, IsFixRemark: true, FreeRemarkText: null, MultiSelectRemarks: null,
    SingleSelectRemarks: [{ Id: 1, Name: "Ripe", IsSelected: false }, { Id: 2, Name: "Green", IsSelected: true }],
  },
};
const multi = {
  ItemRemarks: {
    IsFreeRemark: false, IsFixRemark: true, FreeRemarkText: null, SingleSelectRemarks: null,
    MultiSelectRemarks: [{ Id: 5, Name: "Sliced", IsSelected: false }, { Id: 6, Name: "Skinless", IsSelected: false }],
  },
};

describe("get_item_remark_options", () => {
  it("describes the choices a product offers", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsRemarks/9": single });
    expect(await runOp(ctx, "get_item_remark_options", { itemId: "9" })).toEqual({
      itemId: 9, freeText: { allowed: true, current: null }, choice: "single",
      options: [{ optionId: 1, name: "Ripe", selected: false }, { optionId: 2, name: "Green", selected: true }],
    });
  });
});

describe("set_item_remark", () => {
  it("sends a single choice as SingleRemarkId", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemsRemarks/9": single, "POST item/saveItemRemarks": null });
    await runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "1", text: "not too soft" });
    expect(calls[1].body).toEqual({ Object: { ItemId: 9, OrderId: null, FreeRemarkText: "not too soft", MultiRemarkIds: [], SingleRemarkId: 1 } });
  });

  it("sends several choices as MultiRemarkIds", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemsRemarks/9": multi, "POST item/saveItemRemarks": null });
    await runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "5,6" });
    expect(calls[1].body).toEqual({ Object: { ItemId: 9, OrderId: null, FreeRemarkText: null, MultiRemarkIds: [5, 6], SingleRemarkId: null } });
  });

  it("rejects options the product does not offer, and two options for a single choice", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemsRemarks/9": single, "POST item/saveItemRemarks": null });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "7" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "1,2" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
  });

  it("rejects free text when the product does not accept it, and an empty remark", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsRemarks/9": multi });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9", text: "hello" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9" })).rejects.toMatchObject({ code: "BAD_INPUT" });
  });
});

describe("clear_item_remark", () => {
  it("deletes the remark", async () => {
    const { ctx, calls } = await signedIn({ "DELETE item/deleteItemRemarks/9": null });
    expect(await runOp(ctx, "clear_item_remark", { itemId: "9" })).toEqual({ itemId: 9, cleared: true });
    expect(calls[0].method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/remarks.test.ts`
Expected: FAIL — `no operation get_item_remark_options`.

- [ ] **Step 3: Implement**

`src/api/remarks.ts`:

```ts
import type { HaziHinamClient } from "../client.js";

export interface RemarkOption {
  Id: number;
  Name: string;
  IsSelected: boolean;
}

export interface ItemRemarks {
  IsFreeRemark: boolean;
  FreeRemarkText: string | null;
  MultiSelectRemarks: RemarkOption[] | null;
  SingleSelectRemarks: RemarkOption[] | null;
}

export async function getItemRemarks(c: HaziHinamClient, itemId: number): Promise<ItemRemarks> {
  return (await c.get<{ ItemRemarks: ItemRemarks }>(`item/getItemsRemarks/${itemId}`)).ItemRemarks;
}

export interface RemarkInput {
  itemId: number;
  text: string | null;
  multiIds: number[];
  singleId: number | null;
}

export async function saveItemRemarks(c: HaziHinamClient, r: RemarkInput): Promise<void> {
  await c.post("item/saveItemRemarks", {
    ItemId: r.itemId,
    OrderId: null,
    FreeRemarkText: r.text,
    MultiRemarkIds: r.multiIds,
    SingleRemarkId: r.singleId,
  });
}

export async function deleteItemRemarks(c: HaziHinamClient, itemId: number): Promise<void> {
  await c.delete(`item/deleteItemRemarks/${itemId}`);
}
```

`src/operations/remarks.ts`:

```ts
import { z } from "zod";
import { deleteItemRemarks, getItemRemarks, type ItemRemarks, saveItemRemarks } from "../api/remarks.js";
import { HaziHinamError } from "../errors.js";
import { defineOperation } from "./define.js";

const choiceOf = (r: ItemRemarks) =>
  r.MultiSelectRemarks?.length ? { choice: "multiple" as const, options: r.MultiSelectRemarks }
  : r.SingleSelectRemarks?.length ? { choice: "single" as const, options: r.SingleSelectRemarks }
  : { choice: "none" as const, options: [] };

export const getItemRemarkOptionsOp = defineOperation({
  name: "get_item_remark_options",
  description: "Show which picking instructions a product accepts (e.g. ripeness, slicing, free text) and what is selected now.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: true,
  async run(ctx, { itemId }) {
    const r = await getItemRemarks(await ctx.client(), itemId);
    const { choice, options } = choiceOf(r);
    return {
      itemId,
      freeText: { allowed: r.IsFreeRemark, current: r.FreeRemarkText },
      choice,
      options: options.map(o => ({ optionId: o.Id, name: o.Name, selected: o.IsSelected })),
    };
  },
});

export const setItemRemarkOp = defineOperation({
  name: "set_item_remark",
  description: "Set picking instructions for a product in the cart: optionIds (comma-separated, from get_item_remark_options) and/or free text. Replaces the product's current remark.",
  input: {
    itemId: z.coerce.number().int().positive(),
    optionIds: z.string().regex(/^\d+(,\d+)*$/).optional(),
    text: z.string().trim().min(1).max(200).optional(),
  },
  readOnly: false,
  async run(ctx, { itemId, optionIds, text }) {
    const client = await ctx.client();
    const r = await getItemRemarks(client, itemId);
    const { choice, options } = choiceOf(r);
    const ids = optionIds ? optionIds.split(",").map(Number) : [];
    if (!ids.length && !text) throw new HaziHinamError("BAD_INPUT", "Give optionIds, text, or both.");
    if (text && !r.IsFreeRemark) throw new HaziHinamError("BAD_INPUT", "This product does not accept free-text remarks.");
    const offered = new Set(options.map(o => o.Id));
    const unknown = ids.filter(id => !offered.has(id));
    if (unknown.length) throw new HaziHinamError("BAD_INPUT", `Option ${unknown.join(", ")} is not offered for this product.`);
    if (choice === "single" && ids.length > 1) throw new HaziHinamError("BAD_INPUT", "This product accepts only one option.");
    await saveItemRemarks(client, {
      itemId,
      text: text ?? null,
      multiIds: choice === "multiple" ? ids : [],
      singleId: choice === "single" && ids.length ? ids[0] : null,
    });
    return { itemId, optionIds: ids, text: text ?? null };
  },
});

export const clearItemRemarkOp = defineOperation({
  name: "clear_item_remark",
  description: "Remove the picking instructions from a product in the cart.",
  input: { itemId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { itemId }) {
    await deleteItemRemarks(await ctx.client(), itemId);
    return { itemId, cleared: true };
  },
});
```

In `src/operations/index.ts`, import the three and insert them right after `clearCartOp`:

```ts
import { clearItemRemarkOp, getItemRemarkOptionsOp, setItemRemarkOp } from "./remarks.js";
// … in operations, after clearCartOp:
  getItemRemarkOptionsOp,
  setItemRemarkOp,
  clearItemRemarkOp,
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/remarks.ts src/operations/remarks.ts src/operations/index.ts test/remarks.test.ts
git commit -m "feat: per-item picking remarks"
```

---

### Task 7: Placed orders — delivery slot changes and substitutions

**Files:**
- Modify: `src/api/types.ts` (`OrderSummary` fields), `src/api/orders.ts` (append `changeOrderShipping`)
- Create: `src/api/substitutions.ts`
- Modify: `src/operations/orders.ts` (`list_orders` output; three new operations)
- Modify: `src/operations/index.ts` (register three operations after `copy_order_to_cart`)
- Test: `test/orders-v2.test.ts`

**Interfaces:**
- Consumes: `listOrders` (`src/api/orders.ts`), `describeItem` (Task 2), `parseSiteDate`, `HaziHinamClient.post(..., { wrap, query })` (Task 1), `signedIn`, `runOp`, `item`.
- Produces: `list_orders` gains an `editable` object on orders whose slot can still change; operations `change_order_delivery_slot`, `get_substitutions`, `answer_substitutions`.

What the site does (from its bundle):
- An order whose `IsOrderShippingChangeAllowed` is true can move to another slot: `POST order/ChangeDraftOrderShipping/?Id=<Order_Draft_Id>`, wrapped body `{AddressId, StoreId, ShipmentId}`; delivery sets `AddressId` (and `StoreId: null`), pickup sets `StoreId` (and `AddressId: null`). Not probed live.
- Item edits of a placed order go through checkout and `order/post`, so they are **out of scope** (Global Constraints).
- `order/history` orders also carry `Order_Draft_Id: number | null`, `Order_Draft_Due_Date: string | null` (format not observed; pass through as-is), `IsOrderShippingChangeAllowed: boolean`.
- Substitutions (SSCS): `GET SSCS/GetOrderSuggestedAlternativeItems/{id}` → `Results: null` when there is nothing to answer, else `{ SuggestedItems: [{ Original: { Item }, Alternative: { Item } }] }`. The id comes from the store's substitution SMS link; for a finished order the live probe returned `IsOK: false`. Answer with `POST SSCS/SetOrderAlternativeItems?Id=<id>`, **unwrapped** body `{ AlternativeItems: [{ Original_Id, Alternative_Id, IsApproved }] }` covering every suggested pair.

- [ ] **Step 1: Write the failing tests**

`test/orders-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeItem } from "../src/operations/format.js";
import { item, runOp, signedIn } from "./helpers.js";

const order = (overrides: Record<string, unknown> = {}) => ({
  Id: 11, Date: "20/09/2026", Total: 100, Order_Status: 1, Order_Status_Desc: "received", IsDraftOrder: true,
  ShippingTypeDesc: "delivery", Shipment: null, Order_Draft_Id: 77, Order_Draft_Due_Date: "01/10/2026 12:00",
  IsOrderShippingChangeAllowed: true, ...overrides,
});

describe("list_orders editable info", () => {
  it("adds editable details only when the slot can still change", async () => {
    const { ctx } = await signedIn({ "GET order/history": { Orders: [order(), order({ Id: 12, IsOrderShippingChangeAllowed: false })] } });
    const [open, closed] = (await runOp(ctx, "list_orders", { limit: "2" })) as any[];
    expect(open.editable).toEqual({ canChangeDeliverySlot: true, changeableUntil: "01/10/2026 12:00" });
    expect(closed.editable).toBeUndefined();
  });
});

describe("change_order_delivery_slot", () => {
  it("moves a delivery order to another slot", async () => {
    const { ctx, calls } = await signedIn({ "GET order/history": { Orders: [order()] }, "POST order/ChangeDraftOrderShipping/": null });
    expect(await runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", addressId: "4" }))
      .toEqual({ orderId: 11, shipmentId: 5, addressId: 4 });
    const post = calls[1];
    expect(post.url.searchParams.get("Id")).toBe("77");
    expect(post.body).toEqual({ Object: { AddressId: 4, StoreId: null, ShipmentId: 5 } });
  });

  it("moves a pickup order with storeId", async () => {
    const { ctx, calls } = await signedIn({ "GET order/history": { Orders: [order()] }, "POST order/ChangeDraftOrderShipping/": null });
    await runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", storeId: "70" });
    expect(calls[1].body).toEqual({ Object: { AddressId: null, StoreId: 70, ShipmentId: 5 } });
  });

  it("refuses orders that can no longer change, unknown orders, and ambiguous targets", async () => {
    const { ctx, calls } = await signedIn({ "GET order/history": { Orders: [order({ IsOrderShippingChangeAllowed: false })] } });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", addressId: "4" })).rejects.toMatchObject({ code: "NOT_CHANGEABLE" });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "99", shipmentId: "5", addressId: "4" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "change_order_delivery_slot", { orderId: "11", shipmentId: "5", addressId: "4", storeId: "70" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
  });
});

const suggestions = { SuggestedItems: [{ Original: { Item: item(1) }, Alternative: { Item: item(2) } }, { Original: { Item: item(3) }, Alternative: { Item: item(4) } }] };

describe("substitutions", () => {
  it("lists suggested substitutes", async () => {
    const { ctx } = await signedIn({ "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": suggestions });
    expect(await runOp(ctx, "get_substitutions", { orderId: "abc-1" })).toEqual({
      pending: true,
      suggestions: [
        { original: describeItem(item(1)), alternative: describeItem(item(2)) },
        { original: describeItem(item(3)), alternative: describeItem(item(4)) },
      ],
    });
  });

  it("reports nothing pending", async () => {
    const { ctx } = await signedIn({ "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": null });
    expect(await runOp(ctx, "get_substitutions", { orderId: "abc-1" })).toEqual({ pending: false, suggestions: [] });
  });

  it("answers every pair, approving only the listed originals", async () => {
    const { ctx, calls } = await signedIn({
      "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": suggestions,
      "POST SSCS/SetOrderAlternativeItems": null,
    });
    expect(await runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "3" })).toEqual({ approved: [3], rejected: [1] });
    expect(calls[1].url.searchParams.get("Id")).toBe("abc-1");
    expect(calls[1].body).toEqual({ AlternativeItems: [
      { Original_Id: 1, Alternative_Id: 2, IsApproved: false },
      { Original_Id: 3, Alternative_Id: 4, IsApproved: true },
    ] });
  });

  it("accepts 'all' and 'none', and rejects ids that were not suggested", async () => {
    const { ctx, calls } = await signedIn({
      "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": suggestions,
      "POST SSCS/SetOrderAlternativeItems": null,
    });
    expect(await runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "all" })).toEqual({ approved: [1, 3], rejected: [] });
    expect(await runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "none" })).toEqual({ approved: [], rejected: [1, 3] });
    await expect(runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "9" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls.filter(c => c.method === "POST")).toHaveLength(2);
  });

  it("reports NOTHING_PENDING when answering with no suggestions", async () => {
    const { ctx } = await signedIn({ "GET SSCS/GetOrderSuggestedAlternativeItems/abc-1": null });
    await expect(runOp(ctx, "answer_substitutions", { orderId: "abc-1", approve: "all" })).rejects.toMatchObject({ code: "NOTHING_PENDING" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/orders-v2.test.ts`
Expected: FAIL — `editable` is undefined for the open order and `no operation change_order_delivery_slot`.

- [ ] **Step 3: Implement**

In `src/api/types.ts`, add to `OrderSummary`:

```ts
  Order_Draft_Id?: number | null;
  Order_Draft_Due_Date?: string | null;
  IsOrderShippingChangeAllowed?: boolean;
```

Append to `src/api/orders.ts`:

```ts
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
```

`src/api/substitutions.ts`:

```ts
import type { HaziHinamClient } from "../client.js";
import type { Item } from "./types.js";

export interface SuggestedPair {
  Original: { Item: Item };
  Alternative: { Item: Item };
}

export async function getSuggestedSubstitutes(c: HaziHinamClient, id: string): Promise<SuggestedPair[]> {
  const results = await c.get<{ SuggestedItems: SuggestedPair[] | null } | null>(`SSCS/GetOrderSuggestedAlternativeItems/${encodeURIComponent(id)}`);
  return results?.SuggestedItems ?? [];
}

export interface SubstituteAnswer {
  Original_Id: number;
  Alternative_Id: number;
  IsApproved: boolean;
}

// Unwrapped, like the site's own call.
export async function answerSubstitutes(c: HaziHinamClient, id: string, answers: SubstituteAnswer[]): Promise<void> {
  await c.post("SSCS/SetOrderAlternativeItems", { AlternativeItems: answers }, { wrap: false, query: { Id: id } });
}
```

In `src/operations/orders.ts`:

1. Add imports:

```ts
import { changeOrderShipping } from "../api/orders.js"; // merge into the existing import from "../api/orders.js"
import { answerSubstitutes, getSuggestedSubstitutes } from "../api/substitutions.js";
import { HaziHinamError } from "../errors.js";
import { describeItem } from "./format.js";
```

2. In `listOrdersOp.run`, add one property to each mapped order, after `delivery`:

```ts
      editable: o.IsOrderShippingChangeAllowed
        ? { canChangeDeliverySlot: true, changeableUntil: o.Order_Draft_Due_Date ?? null }
        : undefined,
```

3. Append three operations:

```ts
export const changeOrderDeliverySlotOp = defineOperation({
  name: "change_order_delivery_slot",
  description: "Move an already placed order to another delivery or pickup slot, while the site still allows it (see list_orders' editable). Give shipmentId from list_delivery_slots and exactly one of addressId (delivery) or storeId (pickup). Confirm with the user first.",
  input: {
    orderId: z.coerce.number().int().positive(),
    shipmentId: z.coerce.number().int().positive(),
    addressId: z.coerce.number().int().positive().optional(),
    storeId: z.coerce.number().int().positive().optional(),
  },
  readOnly: false,
  async run(ctx, { orderId, shipmentId, addressId, storeId }) {
    if ((addressId === undefined) === (storeId === undefined)) {
      throw new HaziHinamError("BAD_INPUT", "Give exactly one of addressId (delivery) and storeId (pickup).");
    }
    const client = await ctx.client();
    const order = (await listOrders(client)).find(o => o.Id === orderId);
    if (!order) throw new HaziHinamError("NOT_FOUND", `Order ${orderId} is not in the order history.`);
    if (!order.IsOrderShippingChangeAllowed || !order.Order_Draft_Id) {
      throw new HaziHinamError("NOT_CHANGEABLE", `Order ${orderId} can no longer change its delivery slot.`);
    }
    await changeOrderShipping(client, order.Order_Draft_Id, { shipmentId, addressId: addressId ?? null, storeId: storeId ?? null });
    return { orderId, shipmentId, ...(addressId !== undefined ? { addressId } : { storeId }) };
  },
});

const substitutionId = z.string().regex(/^[\w-]{1,64}$/);

export const getSubstitutionsOp = defineOperation({
  name: "get_substitutions",
  description: "Show the substitutes the store proposes for missing products in an order (the id from the store's substitution SMS link, usually the order id).",
  input: { orderId: substitutionId },
  readOnly: true,
  async run(ctx, { orderId }) {
    const pairs = await getSuggestedSubstitutes(await ctx.client(), orderId);
    return {
      pending: pairs.length > 0,
      suggestions: pairs.map(p => ({ original: describeItem(p.Original.Item), alternative: describeItem(p.Alternative.Item) })),
    };
  },
});

export const answerSubstitutionsOp = defineOperation({
  name: "answer_substitutions",
  description: "Answer the store's substitute proposals for an order. approve is 'all', 'none', or comma-separated original itemIds to accept; every other proposal is declined. Confirm the choices with the user first.",
  input: { orderId: substitutionId, approve: z.string().regex(/^(all|none|\d+(,\d+)*)$/) },
  readOnly: false,
  async run(ctx, { orderId, approve }) {
    const client = await ctx.client();
    const pairs = await getSuggestedSubstitutes(client, orderId);
    if (!pairs.length) throw new HaziHinamError("NOTHING_PENDING", "There are no substitute proposals to answer for this order.");
    const originals = pairs.map(p => p.Original.Item.Id);
    const chosen = approve === "all" ? new Set(originals) : approve === "none" ? new Set<number>() : new Set(approve.split(",").map(Number));
    const unknown = [...chosen].filter(id => !originals.includes(id));
    if (unknown.length) throw new HaziHinamError("BAD_INPUT", `Item ${unknown.join(", ")} has no substitute proposal.`);
    await answerSubstitutes(client, orderId, pairs.map(p => ({
      Original_Id: p.Original.Item.Id,
      Alternative_Id: p.Alternative.Item.Id,
      IsApproved: chosen.has(p.Original.Item.Id),
    })));
    return { approved: originals.filter(id => chosen.has(id)), rejected: originals.filter(id => !chosen.has(id)) };
  },
});
```

In `src/operations/index.ts`, import the three from `./orders.js` and insert them right after `copyOrderToCartOp`:

```ts
  changeOrderDeliverySlotOp,
  getSubstitutionsOp,
  answerSubstitutionsOp,
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including the existing `list_orders` test (it uses `toEqual`, which ignores the `undefined` `editable`); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/orders.ts src/api/substitutions.ts src/operations/orders.ts src/operations/index.ts test/orders-v2.test.ts
git commit -m "feat: change a placed order's delivery slot and answer substitutions"
```

---

### Task 8: Barcode fallback when replaying the usual order

**Files:**
- Modify: `src/usual-order.ts` (`ReplayReport`, `replayUsualOrder`)
- Modify: `src/operations/usual-order.ts` (`prepare_usual_order` output)
- Test: `test/usual-order.test.ts` (append), `test/operations-reorder.test.ts` (append)

**Interfaces:**
- Consumes: `getItemByBarcode` (Task 2), existing replay code.
- Produces: `ReplayReport.remapped: { item: UsualItem; newItemId: number }[]`; `prepare_usual_order` result `cart.remapped: { name, oldItemId, newItemId }[]` (present only when non-empty).

Why: the site sometimes retires a product id and lists the same product (same barcode) under a new id. The saved usual order then fails for that line. When setting a line is rejected (non-auth error), look the barcode up; if it resolves to a different id, set that id instead and report the remap so the user can re-save the usual order. The saved file is **not** rewritten automatically.

- [ ] **Step 1: Write the failing tests**

Append to `test/usual-order.test.ts` (reuse that file's existing imports and helpers; `fakeFetch`, `item`, `tempStore`, `USUAL_ORDER_FILE`, `HaziHinamClient` and `replayUsualOrder` are already imported there — add any that are missing):

```ts
describe("replayUsualOrder barcode fallback", () => {
  const usual = {
    savedAt: "2026-09-01T00:00:00.000Z",
    items: [
      { itemId: 1, barcode: "7290000000001", name: "Bread", quantity: 1, type: 1 },
      { itemId: 2, barcode: "7290000000002", name: "Milk", quantity: 3, type: 1 },
    ],
  };

  it("sets the product's new id when the saved id is rejected", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, usual);
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": (call: any) =>
        call.body.Object.ItemId === 2
          ? { json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "retired" } } }
          : { json: { IsOK: true, Results: null, ErrorResponse: null } },
      "GET item/getItemByBarkod/7290000000002": { Item: item(22, { BarKod: "7290000000002" }) },
      "GET item/getItemsInCart": { CartItems: { Categories: [{ Id: 1, Name: "c", Items: [
        item(1, { Cart: { Quantity: 1, ItemQuantityType: 1 } }),
        item(22, { Cart: { Quantity: 3, ItemQuantityType: 1 } }),
      ] }] } },
      "GET order/cartSummary": { CartSummary: { Price_NET_TOTAL: 1, Price_Shipping: 0, Price_Savings: 0, Price_Order_Total: 1, Minimum_Cart_Price_NET: 0 } },
    });
    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    expect(report.remapped).toEqual([{ item: usual.items[1], newItemId: 22 }]);
    expect(report.added.map(i => i.itemId)).toEqual([1, 2]);
    expect(report.missing).toEqual([]);
    const adds = f.calls.filter(c => c.path === "item/addItemToCart").map(c => c.body.Object);
    expect(adds.at(-1)).toEqual({ ItemId: 22, Quantity: 3, Type: 1, IsCalculateCart: true });
  });

  it("keeps the line as rejected when the barcode finds nothing new", async () => {
    const store = await tempStore();
    await store.writeJson(USUAL_ORDER_FILE, usual);
    const f = fakeFetch({
      "DELETE item/removeItemsInCart": null,
      "POST item/addItemToCart": (call: any) =>
        call.body.Object.ItemId === 2
          ? { json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "retired" } } }
          : { json: { IsOK: true, Results: null, ErrorResponse: null } },
      "GET item/getItemByBarkod/7290000000002": { Item: null },
      "GET item/getItemsInCart": { CartItems: { Categories: [{ Id: 1, Name: "c", Items: [item(1, { Cart: { Quantity: 1, ItemQuantityType: 1 } })] }] } },
      "GET order/cartSummary": { CartSummary: { Price_NET_TOTAL: 1, Price_Shipping: 0, Price_Savings: 0, Price_Order_Total: 1, Minimum_Cart_Price_NET: 0 } },
    });
    const report = await replayUsualOrder(new HaziHinamClient("t", { fetch: f.fetch }), store);
    expect(report.remapped).toEqual([]);
    expect(report.missing).toMatchObject([{ item: usual.items[1], reason: "rejected" }]);
  });
});
```

Append to `test/operations-reorder.test.ts` a test that `prepare_usual_order` includes `cart.remapped` as `[{ name: "Milk", oldItemId: 2, newItemId: 22 }]` in the same scenario (build the routes exactly as the first test above, using that file's existing `run`/context helpers and `USUAL_ORDER_FILE`), and omits `remapped` when nothing was remapped (assert `result.cart.remapped` is `undefined` in an existing happy-path test's scenario).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/usual-order.test.ts test/operations-reorder.test.ts`
Expected: FAIL — `report.remapped` is undefined.

- [ ] **Step 3: Implement**

In `src/usual-order.ts`:

1. Import `getItemByBarcode` from `./api/catalog.js`.
2. Add `remapped: { item: UsualItem; newItemId: number }[];` to `ReplayReport`.
3. Replace the body of `replayUsualOrder` from `const rejected = …` through the classification loop with:

```ts
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
```

In `src/operations/usual-order.ts`, in `prepare_usual_order`'s returned `cart` object, add after `missing`:

```ts
        remapped: report.remapped.length
          ? report.remapped.map(r => ({ name: r.item.name, oldItemId: r.item.itemId, newItemId: r.newItemId }))
          : undefined,
```

(use the variable name the existing code gives the replay report), and extend `nextStep` so that when `report.remapped.length > 0` it adds: `" Some products changed id on the site; after checking the cart, run save_usual_order to update the saved list."`

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass (existing replay tests still pass: `remapped` is `[]` there); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/usual-order.ts src/operations/usual-order.ts test/usual-order.test.ts test/operations-reorder.test.ts
git commit -m "feat: fall back to the barcode when a saved product id is retired"
```

---

### Task 9: Docs, MCP instructions and survey status

**Files:**
- Modify: `src/mcp.ts` (`INSTRUCTIONS`), `README.md`, `docs/API-SURVEY.md`
- Test: `test/mcp.test.ts` (append one assertion)

**Interfaces:**
- Consumes: the final `operations` list.
- Produces: documentation only; no new code interfaces.

- [ ] **Step 1: Write the failing test**

Append to `test/mcp.test.ts` (inside its existing `describe`, reusing its client/server setup):

```ts
it("describes the shopping tools in its instructions", async () => {
  // Use the same connected client the other tests in this file create.
  const instructions = client.getInstructions() ?? "";
  expect(instructions).toMatch(/search_products/);
  expect(instructions).toMatch(/cannot place or pay/i);
});
```

If this file creates the client inside each test instead of sharing one, build it the same way inside this test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL — instructions do not mention `search_products`.

- [ ] **Step 3: Implement**

In `src/mcp.ts`, replace `INSTRUCTIONS` with:

```ts
const INSTRUCTIONS = [
  "Tools for the user's own Hazi Hinam (Israeli supermarket) online account.",
  "To reorder: call prepare_usual_order with the day the user asked for. It replaces the cart with the saved usual order at exact amounts and lists delivery slots.",
  "A weekday resolves to the next two occurrences; ask the user which date and slot they want.",
  "Report the total, any missing items (suggest alternatives with search_products), and the available slots.",
  "To find products use search_products (Hebrew works best), then set_cart_item with the itemId. get_product_details answers ingredient, allergen and nutrition questions.",
  "Placed orders: list_orders shows which can still change their slot (change_order_delivery_slot); get_substitutions/answer_substitutions handle the store's replacement proposals.",
  "Confirm with the user before any tool that changes the cart, an order, favorites, lists or the default address.",
  "You cannot place or pay for orders, or change the products of a placed order. The user finishes on the website.",
  "If a tool returns AUTH_REQUIRED, ask the user to run `hazi-hinam login` in a terminal.",
  "If NO_USUAL_ORDER, ask the user to fill the cart on the website with their usual amounts, then call save_usual_order.",
].join(" ");
```

In `README.md`, extend the command table with every new operation (CLI name in kebab-case, MCP name in snake_case, and the "Changes data" column: `—` for read-only, otherwise what it changes: `cart`, `order`, `account`). Group rows under the existing table in the same order as `src/operations/index.ts`. Note under the table that list-valued flags are comma-separated (`--optionIds 5,6`, `--approve 3,7`).

In `docs/API-SURVEY.md`, change the **MCP** column from `next` to `v2` for every endpoint this plan implemented:
`Address/get`, `address/setDefault`, `distribution/getStores`, `Catalog/get`, `item/{id}`, `item/getItemByBarkod/{barcode}`, `item/GetItemGS1Details/{id}`, `item/getItemsBySearch`, `item/getItemsBySubCategory`, `item/GetSuggestedSearchPhrases`, `item/getItemsInMivza/{id}`, `item/getItemsPromoted`, `item/deleteItemRemarks/{id}`, `item/getItemsRemarks/{id}`, `item/saveItemRemarks`, `item/addItemToFavorites`, `item/getItemsFav`, `item/RemoveItemFromFavorites/{id}`, `item/addShoppingListItemsToCart/{id}`, `item/getItemsByShoppingList/{id}`, `shoppinglist/get`, `shoppinglist/post`, `order/ChangeDraftOrderShipping`, `SSCS/GetOrderSuggestedAlternativeItems/{id}`, `SSCS/SetOrderAlternativeItems`, `Branches`.
Leave `LogOut` (it lives under `/proxy/`, outside the client's allowed base), `Item/GetItemsByCategory` (sub-category browsing covers it) and `order/DownloadInvoice/{id}` (404 in the survey; file download) as `next`, and add one line to "Findings from the survey" saying why each was deferred. Update the Summary table counts to match.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts README.md docs/API-SURVEY.md
git commit -m "docs: phase-2 commands, MCP instructions and survey status"
```

- [ ] **Step 6: Live read-only smoke check (controller, with the user signed in)**

Not for the implementer. With the user's explicit OK and a fresh login, run only read-only commands:

```bash
node dist/bin.js search-products --query "חלב"
node dist/bin.js get-product-details --itemId <an id from the search>
node dist/bin.js list-categories
node dist/bin.js list-promoted-products
node dist/bin.js list-favorites
node dist/bin.js list-shopping-lists
node dist/bin.js list-addresses
node dist/bin.js list-branches
```

Record any shape mismatch as a follow-up; do not paste personal output into the repo.

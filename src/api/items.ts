import type { Category, Item } from "./types.js";

// The cart response lists each item both flat and per category; categories are the complete view.
export function flattenCategories(categories: Category[] | null | undefined): Item[] {
  const byId = new Map<number, Item>();
  for (const category of categories ?? []) {
    for (const item of category.Items ?? []) {
      if (!byId.has(item.Id)) byId.set(item.Id, item);
    }
  }
  return [...byId.values()];
}

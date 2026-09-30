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
    promotion: i.Mivza?.MivzaId ? { promotionId: i.Mivza.MivzaId, text: i.Mivza.MivzaDesc } : undefined,
    inCart: i.Cart && i.Cart.Quantity > 0 ? { quantity: i.Cart.Quantity, unit: unitName(i.Cart.ItemQuantityType) } : undefined,
    favorite: i.IsFavorites ? true : undefined,
  };
}

export type ItemView = ReturnType<typeof describeItem>;

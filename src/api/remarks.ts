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

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

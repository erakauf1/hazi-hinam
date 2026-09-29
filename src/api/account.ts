import type { HaziHinamClient } from "../client.js";
import type { UserInfoResults } from "./types.js";

export function getUserInfo(c: HaziHinamClient): Promise<UserInfoResults> {
  return c.get<UserInfoResults>("user/info");
}

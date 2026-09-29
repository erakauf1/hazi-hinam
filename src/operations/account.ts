import { getUserInfo } from "../api/account.js";
import { defineOperation } from "./define.js";

export const status = defineOperation({
  name: "status",
  description: "Check whether the user is signed in to Hazi Hinam, when the 48-hour login expires, and how many items are in the cart.",
  input: {},
  readOnly: true,
  async run(ctx) {
    const session = await ctx.store.loadSession(ctx.now());
    if (!session) return { signedIn: false, hint: "Ask the user to run `hazi-hinam login` in a terminal." };
    const info = await getUserInfo(ctx.clientFor(session.accessToken));
    return { signedIn: info.UserInfo !== null, expiresAt: session.expiresAt, cartItems: info.CartItemsCount };
  },
});

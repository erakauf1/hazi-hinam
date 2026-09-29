# Adding a command

Every capability is one operation. The CLI command and the MCP tool are generated from it.

1. Find the endpoint in `docs/API.md`. Candidate endpoints to add next are listed in `docs/API-SURVEY.md`. If it is
   new, capture it from the site's bundle or live traffic first and add it there. Never add `order/post`,
   `user/cc` or `user/GetIFrameURL`; the client refuses them.
2. If the call is reusable, add a typed function under `src/api/` (see `src/api/cart.ts`). POST bodies are passed
   unwrapped; the client adds `{"Object": ...}`.
3. Add the operation in the matching `src/operations/*.ts` file:

   ```ts
   export const searchItemsOp = defineOperation({
     name: "search_items",
     description: "Search the store's catalog by name. Returns item ids usable with set_cart_item.",
     input: { query: z.string().min(1).max(100) },
     readOnly: true,
     async run(ctx, { query }) {
       return searchItems(await ctx.client(), query);
     },
   });
   ```

4. Append it to `operations` in `src/operations/index.ts`.
5. Test it with `fakeFetch` (see `test/operations.test.ts`). Fixtures are made up; never paste real responses.

Rules: numeric inputs use `z.coerce.number()` so CLI strings work. Set `readOnly: false` for anything that changes
the cart or account, and `destructive: true` for anything that removes data the user may want.

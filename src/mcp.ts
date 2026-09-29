import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Context } from "./context.js";
import { formatError } from "./errors.js";
import { operations } from "./operations/index.js";

const VERSION = "0.1.0";

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

export function createServer(ctx: Context): McpServer {
  const server = new McpServer({ name: "hazi-hinam", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const operation of operations) {
    server.registerTool(
      operation.name,
      {
        description: operation.description,
        inputSchema: operation.input,
        annotations: {
          readOnlyHint: operation.readOnly,
          destructiveHint: operation.destructive ?? false,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await operation.run(ctx, args as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text" as const, text: formatError(error) }] };
        }
      },
    );
  }
  return server;
}

export async function runMcpServer(ctx: Context): Promise<void> {
  await createServer(ctx).connect(new StdioServerTransport());
}

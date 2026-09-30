# hazi-hinam

Unofficial MCP server and CLI for the [Hazi Hinam](https://shop.hazi-hinam.co.il/) online store, so AI assistants
can use the store through its own API instead of clicking through the website.

Unofficial and unaffiliated with Hazi Hinam.

## What it does

- Saves your "usual order" (products and exact amounts) from your cart, then refills the cart with it on request.
- Finds delivery slots for a day ("thursday", "חמישי", or a date).
- Searches the catalog and shows product details (ingredients, allergens, nutrition), promotions, favorites and shopping lists.
- Lists past orders, shows and edits the cart, and can move a placed order to another delivery slot.
- **Payment is not supported in this version.** The tool stops before checkout; you pick the slot and pay on the
  website.
- **It never automates the login CAPTCHA.** You always sign in yourself.

## Install

```sh
git clone https://github.com/erakauf1/hazi-hinam && cd hazi-hinam
npm install && npm run build
```

## Sign in

The store's login has a CAPTCHA, so you always sign in yourself. The login lasts 48 hours.

```sh
node dist/bin.js login --browser   # opens Chrome; you log in; the token is captured
node dist/bin.js login             # or paste access_token from DevTools → Network → Login → Response
node dist/bin.js status
node dist/bin.js logout            # end the session on the server, then forget the saved login
```

## Commands

CLI commands are kebab-case; the matching MCP tools are snake_case. Flags are named after the tool inputs
(for example `--itemId`, `--orderId`). Output is JSON.

| CLI command | MCP tool | Changes data |
| --- | --- | --- |
| `status` | `status` | — |
| `search-products --query TEXT [--page N] [--pageSize N]` | `search_products` | — |
| `suggest-search-phrases --query TEXT` | `suggest_search_phrases` | — |
| `get-product (--itemId ID \| --barcode CODE)` | `get_product` | — |
| `get-product-details --itemId ID` | `get_product_details` | — |
| `list-categories` | `list_categories` | — |
| `list-category-products --subCategoryId ID` | `list_category_products` | — |
| `list-promoted-products` | `list_promoted_products` | — |
| `get-promotion-products --promotionId ID` | `get_promotion_products` | — |
| `list-favorites` | `list_favorites` | — |
| `add-favorite --itemId ID [--unit unit\|kg]` | `add_favorite` | account |
| `remove-favorite --itemId ID` | `remove_favorite` | account |
| `list-shopping-lists` | `list_shopping_lists` | — |
| `get-shopping-list --listId ID` | `get_shopping_list` | — |
| `create-shopping-list --name TEXT [--fromOrderId ID]` | `create_shopping_list` | account |
| `add-shopping-list-to-cart --listId ID` | `add_shopping_list_to_cart` | cart |
| `list-orders [--limit N]` | `list_orders` | — |
| `get-order-items --orderId ID` | `get_order_items` | — |
| `copy-order-to-cart --orderId ID` | `copy_order_to_cart` | cart |
| `change-order-delivery-slot --orderId ID --shipmentId ID (--addressId ID \| --storeId ID)` | `change_order_delivery_slot` | order |
| `get-substitutions --orderId ID` | `get_substitutions` | — |
| `answer-substitutions --orderId ID --approve all\|none\|IDS` | `answer_substitutions` | order (destructive) |
| `get-cart` | `get_cart` | — |
| `set-cart-item --itemId ID --quantity N [--unit unit\|kg]` | `set_cart_item` | cart |
| `clear-cart` | `clear_cart` | cart (destructive) |
| `get-item-remark-options --itemId ID` | `get_item_remark_options` | — |
| `set-item-remark --itemId ID [--optionIds IDS] [--text TEXT]` | `set_item_remark` | cart (destructive) |
| `clear-item-remark --itemId ID` | `clear_item_remark` | cart (destructive) |
| `list-delivery-slots [--day thursday]` | `list_delivery_slots` | — |
| `list-addresses` | `list_addresses` | — |
| `set-default-address --addressId ID` | `set_default_address` | account |
| `list-pickup-stores` | `list_pickup_stores` | — |
| `list-branches` | `list_branches` | — |
| `save-usual-order` | `save_usual_order` | local file |
| `show-usual-order` | `show_usual_order` | — |
| `prepare-usual-order [--day thursday]` | `prepare_usual_order` | cart (destructive) |

List-valued flags are comma-separated (`--optionIds 5,6`, `--approve 3,7`).

`node dist/bin.js help` prints the same list with descriptions. `login`, `logout` and `mcp` (including
`mcp --http`) are CLI-only.

```sh
node dist/bin.js save-usual-order                 # after filling the cart on the site once
node dist/bin.js prepare-usual-order --day thursday
```

## MCP

```sh
claude mcp add hazi-hinam -- node /absolute/path/to/hazi-hinam/dist/bin.js mcp
```

Then ask: "Prepare my usual Hazi Hinam order for Thursday."

## Use it from your phone

The Claude mobile app can't run programs on your phone, so the server runs on your computer and the app reaches it
over the internet. Nothing is hosted by this project: your login and cart stay between your computer and the store.

1. Sign in on your computer: `node dist/bin.js login --browser`.
2. Install Cloudflare's free `cloudflared` tool (macOS: `brew install cloudflared`), then start the server:

   ```sh
   node dist/bin.js mcp --http --tunnel
   ```

   It prints a URL like `https://<random>.trycloudflare.com/mcp` and a secret.
3. On [claude.ai](https://claude.ai), open Settings → Connectors → Add custom connector. Paste the URL, choose
   **No sign-in**, and under Request headers add `Authorization` with the value `Bearer <secret>`, both as printed.
4. Open the Claude app on your phone and ask: "Prepare my usual Hazi Hinam order for Thursday."

Good to know:

- **The secret is the password.** Anyone who has it can read and change your cart and orders (but not pay). Don't share
  it. `--new-secret` makes a new one and the old one stops working.
- If a client can't send headers, the server also prints a URL with the secret inside it
  (`.../mcp/<secret>`). It works the same, but a URL is easier to leak by accident, so prefer the header.
- **Your computer must stay on and awake**, with the terminal open. Ctrl+C stops the server and the tunnel.
- **The `--tunnel` address changes every restart**, so edit the connector's URL after restarting. For a fixed address,
  leave out `--tunnel` and expose port 8765 yourself, for example with `tailscale funnel 8765`, then use that
  address + `/mcp` with the same header.
- **The store login lasts 48 hours.** When it expires, Claude will ask you to run `login` again on your computer.
- Custom connectors need a Claude plan that includes them.

## Your data

The login token, your usual order and the phone connector's secret live in `~/.config/hazi-hinam/` (owner-only permissions), never in this
repository. Override with `HAZI_HINAM_CONFIG_DIR`.

## Development

`npm test`, `npm run typecheck`. Adding a command: [docs/ADDING-COMMANDS.md](docs/ADDING-COMMANDS.md).
API research: [docs/API.md](docs/API.md).

## Disclaimer

This project was made for personal research and educational purposes only. It is not affiliated with, endorsed
by, or supported by Hazi Hinam. It uses the store's undocumented API, which can change or break at any time.

You use it entirely at your own risk and are solely responsible for how you use it, including following Hazi
Hinam's terms of service and applicable law. The author accepts no responsibility or liability for any use or
misuse of this software, or for any resulting orders, charges, account restrictions, data loss or other damage.

## License

[MIT](LICENSE). The software is provided "as is", without warranty of any kind.

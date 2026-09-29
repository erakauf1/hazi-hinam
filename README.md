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

`node dist/bin.js help` prints the same list with descriptions. `login`, `logout` and `mcp` are CLI-only.

```sh
node dist/bin.js save-usual-order                 # after filling the cart on the site once
node dist/bin.js prepare-usual-order --day thursday
```

## MCP

```sh
claude mcp add hazi-hinam -- node /absolute/path/to/hazi-hinam/dist/bin.js mcp
```

Then ask: "Prepare my usual Hazi Hinam order for Thursday."

## Your data

The login token and your usual order live in `~/.config/hazi-hinam/` (owner-only permissions), never in this
repository. Override with `HAZI_HINAM_CONFIG_DIR`.

## Development

`npm test`, `npm run typecheck`. Adding a command: [docs/ADDING-COMMANDS.md](docs/ADDING-COMMANDS.md).
API research: [docs/API.md](docs/API.md).

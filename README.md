# hazi-hinam

Unofficial MCP server and CLI for the [Hazi Hinam](https://shop.hazi-hinam.co.il/) online store, so AI assistants
can use the store through its own API instead of clicking through the website.

Unofficial and unaffiliated with Hazi Hinam.

## What it does

- Saves your "usual order" (products and exact amounts) from your cart, then refills the cart with it on request.
- Finds delivery slots for a day ("thursday", "חמישי", or a date).
- Lists past orders, shows and edits the cart.
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
node dist/bin.js logout            # forget the saved login
```

## Commands

CLI commands are kebab-case; the matching MCP tools are snake_case. Flags are named after the tool inputs
(for example `--itemId`, `--orderId`). Output is JSON.

| CLI command | MCP tool | Changes data |
| --- | --- | --- |
| `status` | `status` | no |
| `list-orders [--limit N]` | `list_orders` | no |
| `get-order-items --orderId ID` | `get_order_items` | no |
| `copy-order-to-cart --orderId ID` | `copy_order_to_cart` | cart |
| `get-cart` | `get_cart` | no |
| `set-cart-item --itemId ID --quantity N [--unit unit\|kg]` | `set_cart_item` | cart |
| `clear-cart` | `clear_cart` | cart |
| `list-delivery-slots [--day thursday]` | `list_delivery_slots` | no |
| `save-usual-order` | `save_usual_order` | local file |
| `show-usual-order` | `show_usual_order` | no |
| `prepare-usual-order [--day thursday]` | `prepare_usual_order` | cart |

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

# hazi-hinam

Unofficial MCP server and CLI for the [Hazi Hinam](https://shop.hazi-hinam.co.il/) online store, so AI assistants
can use the store through its own API instead of clicking through the website.

Unofficial and unaffiliated with Hazi Hinam.

## Status

Research phase. See [docs/API.md](docs/API.md) for the endpoints mapped so far.

## Design

- **You log in yourself.** The store's login is protected by a CAPTCHA; this tool never tries to get past it.
  You sign in once and the tool reuses that login, which the store keeps valid for 48 hours.
- **It stops before payment.** It can fill the cart and find a delivery slot, but placing and paying for an
  order always stays a manual step on the site.
- **Your data stays on your machine.** The login token and your saved "usual order" live in
  `~/.config/hazi-hinam/`, never in this repository.

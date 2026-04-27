# picnic-cli

Unofficial command-line client for the [Picnic](https://picnic.app) online supermarket
(DE and NL), built on [Bun](https://bun.sh) and wrapping
[`MRVDH/picnic-api`](https://github.com/MRVDH/picnic-api).

Not affiliated with Picnic. The underlying library reverse-engineers the mobile-app
API; endpoints can change without notice and accounts can be rate-limited if abused.

## Capabilities

- Log in with email + password, including SMS 2FA
- Persist the session token locally so subsequent commands skip auth
- Search the catalog, fetch product details, fetch product images
- Inspect, modify, and clear the shopping cart
- List delivery slots, list past/current deliveries, fetch a single delivery
- DE and NL accounts (default: DE)
- Pipe-friendly TSV output for `search` and `deliveries`; `--json` mode for `cart`

## Install

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
git clone https://github.com/Lennix/picnic-cli.git
cd picnic-cli
bun install
bun install -g .          # exposes `picnic` on PATH (~/.bun/bin)
```

`bun install -g .` symlinks the working tree into `~/.bun/install/global/node_modules/`,
so edits to `src/` are picked up live without re-installing.

## Usage

```text
picnic login                     Log in (prompts for credentials, supports 2FA)
picnic logout                    Clear stored auth
picnic me                        Show logged-in user
picnic search <query>            Search the catalog
picnic product <id>              Show product details
picnic cart [--json]             Show current cart (default: summary)
picnic cart add <id> [count]     Add product to cart
picnic cart rm  <id> [count]     Remove product from cart
picnic cart clear                Clear the cart
picnic slots                     List delivery slots
picnic deliveries                List past/current deliveries
picnic delivery <id>             Show delivery detail
```

### Examples

```bash
picnic login                            # interactive
picnic search milch                     # id<TAB>price<TAB>name
picnic search milch | grep Bärenmarke
picnic product s1057152                 # full Fusion page JSON
picnic cart                             # human-readable summary
picnic cart add s1057152 2              # add 2× to cart
picnic slots | jq '.delivery_slots[] | select(.is_available)'
```

Sample `picnic cart` output:

```
1× s1177402   Malz EINWEG (500ml) €1.29 (+€0.25 dep)
────────────────────────────────────────────────────────────
Total: €1.54   (incl €0.25 dep)   Items: 1
Slot:  Di. 28.04. 19:00–20:50  MOV €45.00
```

## Auth & state

- Session token is written to `~/.config/picnic-cli/auth.json` after a successful
  login. `picnic logout` invalidates the token server-side and removes the file.
- The login flow asks for email and password (hidden input). If the account has
  2FA enabled, an SMS code is requested and verified automatically; the new auth
  key from the verify response is what gets stored.

## Environment variables

| Variable           | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `PICNIC_COUNTRY`   | `DE` or `NL` for new logins (default `DE`)            |
| `PICNIC_PASSWORD`  | Skip the password prompt — useful for non-TTY shells  |
| `PICNIC_DEBUG`     | If set, prints the login request/response for tracing |

## How it works

The CLI is a thin wrapper around `picnic-api`. Two upstream rough edges are
papered over locally in [`src/patch.ts`](./src/patch.ts):

1. `HttpClient.sendRequest` and `AuthService.login` call `response.json()`
   without checking for empty/204 bodies, which throws "Unexpected EOF" on
   several real responses (notably the 2FA generate endpoint). The patch reads
   the body as text first and only `JSON.parse`s when non-empty.
2. `OrderArticle.deposit` and the per-article deposit aggregation are missing
   from the wrapper's types and from `cart.deposit_breakdown` pre-checkout. The
   cart summary computes the deposit total locally so the displayed total
   matches what the app shows.

The TTY password reader in [`src/prompt.ts`](./src/prompt.ts) strips ESC
sequences and bracketed-paste markers so terminal paste artifacts don't end up
in the password hash.

## Disclaimer

This is an independent project. Use at your own risk; do not embed credentials
in CI without rotating them; respect Picnic's terms of service.

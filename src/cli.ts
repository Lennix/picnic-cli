#!/usr/bin/env bun
import "./patch.ts";
import { loadAuth, saveAuth, clearAuth, requireAuth } from "./auth.ts";
import { makeClient } from "./client.ts";
import { formatCart } from "./format.ts";
import { readLine, readPassword } from "./prompt.ts";

const HELP = `picnic — unofficial CLI for the Picnic supermarket API

Usage:
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

Env:
  PICNIC_COUNTRY=DE|NL             Country code for new logins (default DE)
  PICNIC_PASSWORD                  Password for non-TTY login
`;

function fmtPrice(cents?: number | null): string {
  if (cents == null) return "";
  return `€${(cents / 100).toFixed(2)}`;
}

async function cmdLogin() {
  const country = ((process.env.PICNIC_COUNTRY ?? "DE").toUpperCase() as "NL" | "DE");
  const email = (await readLine("Email: ")).trim();
  const password = process.env.PICNIC_PASSWORD ?? (await readPassword("Password: "));
  const client = makeClient({ countryCode: country });
  const result = await client.auth.login(email, password);
  if (result.second_factor_authentication_required) {
    await client.auth.generate2FACode("SMS");
    const code = (await readLine("2FA code (SMS): ")).trim();
    await client.auth.verify2FACode(code);
  }
  await saveAuth({ authKey: client.authKey!, countryCode: country, userId: result.user_id });
  console.log(`Logged in as ${email} (${country}).`);
}

async function cmdLogout() {
  const auth = await loadAuth();
  if (auth?.authKey) {
    try {
      const client = makeClient({ auth });
      await client.auth.logout();
    } catch {}
  }
  await clearAuth();
  console.log("Logged out.");
}

async function cmdMe() {
  const client = makeClient({ auth: await requireAuth() });
  const user = await client.user.getUserDetails();
  console.log(JSON.stringify(user, null, 2));
}

async function cmdSearch(query: string) {
  const client = makeClient({ auth: await requireAuth() });
  const results = await client.catalog.search(query);
  if (!results?.length) {
    console.log("No results.");
    return;
  }
  for (const r of results) {
    console.log(`${r.id}\t${fmtPrice(r.display_price)}\t${r.name}`);
  }
}

async function cmdProduct(id: string) {
  const client = makeClient({ auth: await requireAuth() });
  const details = await client.catalog.getProductDetails(id);
  console.log(JSON.stringify(details, null, 2));
}

async function cmdCart(json: boolean) {
  const client = makeClient({ auth: await requireAuth() });
  const cart = await client.cart.getCart();
  console.log(json ? JSON.stringify(cart, null, 2) : formatCart(cart));
}

async function cmdCartAdd(id: string, count: number) {
  const client = makeClient({ auth: await requireAuth() });
  const cart = await client.cart.addProductToCart(id, count);
  console.log(`Added ${count}× ${id}. Total: ${fmtPrice(cart.total_price)}`);
}

async function cmdCartRm(id: string, count: number) {
  const client = makeClient({ auth: await requireAuth() });
  const cart = await client.cart.removeProductFromCart(id, count);
  console.log(`Removed ${count}× ${id}. Total: ${fmtPrice(cart.total_price)}`);
}

async function cmdCartClear() {
  const client = makeClient({ auth: await requireAuth() });
  await client.cart.clearCart();
  console.log("Cart cleared.");
}

async function cmdSlots() {
  const client = makeClient({ auth: await requireAuth() });
  const slots = await client.cart.getDeliverySlots();
  console.log(JSON.stringify(slots, null, 2));
}

async function cmdDeliveries() {
  const client = makeClient({ auth: await requireAuth() });
  const deliveries = await client.delivery.getDeliveries();
  for (const d of deliveries) {
    const total = d.orders.reduce((s, o) => s + (o.total_price ?? 0), 0);
    console.log(`${d.delivery_id}\t${d.status}\t${d.slot.window_start ?? ""}\t${fmtPrice(total)}`);
  }
}

async function cmdDelivery(id: string) {
  const client = makeClient({ auth: await requireAuth() });
  const detail = await client.delivery.getDelivery(id);
  console.log(JSON.stringify(detail, null, 2));
}

function need(arg: string | undefined, name: string): string {
  if (!arg) {
    console.error(`Missing argument: ${name}`);
    process.exit(2);
  }
  return arg;
}

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "login": return await cmdLogin();
      case "logout": return await cmdLogout();
      case "me": return await cmdMe();
      case "search": return await cmdSearch(need(sub, "query"));
      case "product": return await cmdProduct(need(sub, "id"));
      case "slots": return await cmdSlots();
      case "deliveries": return await cmdDeliveries();
      case "delivery": return await cmdDelivery(need(sub, "id"));
      case "cart": {
        if (!sub || sub === "--json" || sub === "-j") return await cmdCart(sub === "--json" || sub === "-j");
        if (sub === "add") return await cmdCartAdd(need(rest[0], "id"), Number(rest[1] ?? 1));
        if (sub === "rm" || sub === "remove")
          return await cmdCartRm(need(rest[0], "id"), Number(rest[1] ?? 1));
        if (sub === "clear") return await cmdCartClear();
        console.error(`Unknown cart subcommand: ${sub}`);
        process.exit(2);
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return;
      default:
        console.error(`Unknown command: ${cmd}\n`);
        console.log(HELP);
        process.exit(2);
    }
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }
}

await main();

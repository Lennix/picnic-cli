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
  picnic search <query> [flags]    Search the catalog
    -v, --verbose                    Always attach product details
    --no-auto                        Disable auto-detail when ≤3 results
    --detailed                       Use full unstripped product JSON in details
  picnic product <id> [--detailed] Show product details (default: stripped)
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

const AUTO_DETAIL_THRESHOLD = 3;

function cleanText(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim() || undefined;
}

function findSection(sections: any[] | undefined, ...needles: string[]): string | undefined {
  if (!sections) return undefined;
  for (const s of sections) {
    const t = (s?.title ?? "").toLowerCase();
    if (needles.some(n => t.includes(n))) return s.content;
  }
  return undefined;
}

function extractIngredients(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return cleanText(raw.replace(/^Zutaten:\s*/i, "").replace(/^Ingrediënten:\s*/i, ""));
}

function parseNutrition(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const flat = raw.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const out: Record<string, string> = {};
  const grab = (key: string, ...patterns: RegExp[]) => {
    for (const p of patterns) {
      const m = flat.match(p);
      if (m) { out[key] = m[1].replace(/\s+/g, "") + (m[2] ?? ""); return; }
    }
  };
  grab("kcal_per_100g", /(\d+[\.,]?\d*)\s*kcal\b/i);
  grab("fat_g", /Fett\s*([\d.,]+)\s*(g)\b/i);
  grab("saturated_fat_g", /gesättigte\s+Fettsäuren\s*([\d.,]+)\s*(g)\b/i);
  grab("carbs_g", /Kohlenhydrate\s*([\d.,]+)\s*(g)\b/i);
  grab("sugar_g", /Zucker\s*([\d.,]+)\s*(g)\b/i);
  grab("protein_g", /Eiweiß\s*([\d.,]+)\s*(g)\b/i);
  grab("salt_g", /Salz\s*([\d.,]+)\s*(g)\b/i);
  grab("fiber_g", /Ballaststoffe\s*([\d.,]+)\s*(g)\b/i);
  return Object.keys(out).length ? out : undefined;
}

function formatProduct(p: any): string {
  const s = stripProduct(p);
  const lines: string[] = [];
  const add = (k: string, v: any) => {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    lines.push(`${k}: ${v}`);
  };
  add("id", s.id);
  add("name", s.name);
  add("brand", s.brand);
  add("size", s.size);
  add("price", s.price + (s.unit_price ? ` (${s.unit_price})` : ""));
  add("promotion", s.promotion);
  if (s.description) {
    lines.push("description:");
    for (const ln of s.description.split("\n")) lines.push(`  ${ln}`);
  }
  if (s.highlights?.length) {
    lines.push(`highlights: ${s.highlights.join(" · ")}`);
  }
  if (s.allergens?.length) {
    add("allergens", s.allergens.join(", "));
  }
  add("ingredients", s.ingredients);
  if (s.nutrition) {
    const labels: Array<[string, string]> = [
      ["kcal_per_100g", "kcal"],
      ["fat_g", "fat"],
      ["saturated_fat_g", "sat-fat"],
      ["carbs_g", "carbs"],
      ["sugar_g", "sugar"],
      ["fiber_g", "fiber"],
      ["protein_g", "protein"],
      ["salt_g", "salt"],
    ];
    const parts: string[] = [];
    for (const [k, lbl] of labels) if (s.nutrition[k]) parts.push(`${lbl}=${s.nutrition[k]}`);
    lines.push(`nutrition (per 100g): ${parts.join(" · ")}`);
  }
  if (s.extra) {
    lines.push("extra:");
    for (const ln of s.extra.split("\n")) lines.push(`  ${ln}`);
  }
  return lines.join("\n");
}

function stripProduct(p: any): any {
  if (!p) return p;
  const allergens = Array.isArray(p.allergens)
    ? p.allergens.filter((a: string) => !/^enth[äa]lt$/i.test(a.trim()))
    : undefined;
  const ingredients = extractIngredients(findSection(p.infoSections, "zutat", "ingred"));
  const nutritionRaw = findSection(p.infoSections, "nährwert", "voedings");
  const nutrition = parseNutrition(nutritionRaw);
  const extra = cleanText(findSection(p.infoSections, "zusätzlich", "extra"));
  // Variable-weight items: API puts size into `brand` and €/kg into `unitQuantity`.
  // Detect and swap so `brand` stays semantic.
  let brand = p.brand;
  let size = p.unitQuantity;
  let unit_price = p.unitPrice;
  const brandLooksLikeSize = typeof brand === "string" && /^(ca\.?\s*)?\d+[\.,]?\d*\s*(g|kg|ml|l)\b/i.test(brand);
  const sizeLooksLikeUnitPrice = typeof size === "string" && /^€[\d.,]+\s*\/\s*\w+/.test(size);
  if (brandLooksLikeSize && sizeLooksLikeUnitPrice) {
    unit_price = size;
    size = brand;
    brand = undefined;
  }
  return {
    id: p.id,
    name: p.name,
    brand: brand || undefined,
    size: size || undefined,
    price: fmtPrice(p.displayPrice),
    unit_price: unit_price || undefined,
    description: cleanText(p.description),
    highlights: p.highlights?.length ? p.highlights : undefined,
    allergens: allergens?.length ? allergens : undefined,
    ingredients,
    nutrition,
    extra,
    promotion: p.promotion?.label || undefined,
  };
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

async function cmdSearch(
  query: string,
  opts: { verbose: boolean; noAuto: boolean; detailed: boolean } = { verbose: false, noAuto: false, detailed: false }
) {
  const client = makeClient({ auth: await requireAuth() });
  const results = await client.catalog.search(query);
  if (!results?.length) {
    console.log("No results.");
    return;
  }
  for (const r of results) {
    console.log(`${r.id}\t${fmtPrice(r.display_price)}\t${(r as any).unit_quantity ?? ""}\t${r.name}`);
  }
  const shouldDetail = opts.verbose || (!opts.noAuto && results.length <= AUTO_DETAIL_THRESHOLD);
  if (!shouldDetail) return;
  const details = await Promise.all(
    results.map(r => client.catalog.getProductDetails(r.id).catch(() => null))
  );
  console.log("");
  if (opts.detailed) {
    console.log(JSON.stringify(details.filter(Boolean), null, 2));
  } else {
    const blocks = details.filter(Boolean).map(d => formatProduct(d));
    console.log(blocks.join("\n---\n"));
  }
}

async function cmdProduct(id: string, opts: { detailed: boolean } = { detailed: false }) {
  const client = makeClient({ auth: await requireAuth() });
  const details = await client.catalog.getProductDetails(id);
  if (opts.detailed) {
    console.log(JSON.stringify(details, null, 2));
  } else {
    console.log(formatProduct(details));
  }
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
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flags = new Set(args.filter(a => a.startsWith("-")));
  const positional = args.filter(a => !a.startsWith("-"));
  const sub = positional[1];
  const rest = positional.slice(2);
  try {
    switch (cmd) {
      case "login": return await cmdLogin();
      case "logout": return await cmdLogout();
      case "me": return await cmdMe();
      case "search": return await cmdSearch(need(sub, "query"), {
        verbose: flags.has("-v") || flags.has("--verbose"),
        noAuto: flags.has("--no-auto"),
        detailed: flags.has("--detailed"),
      });
      case "product": return await cmdProduct(need(sub, "id"), {
        detailed: flags.has("--detailed"),
      });
      case "slots": return await cmdSlots();
      case "deliveries": return await cmdDeliveries();
      case "delivery": return await cmdDelivery(need(sub, "id"));
      case "cart": {
        const json = flags.has("--json") || flags.has("-j");
        if (!sub) return await cmdCart(json);
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

import type { Cart, DeliverySlot, OrderArticle, OrderLine } from "picnic-api/lib/domains/cart/types";

// The wrapper's OrderArticle type omits `deposit`, but the API returns it
// per article (in cents). Roll it up locally.
type ArticleWithDeposit = OrderArticle & { deposit?: number };

export function fmtPrice(cents?: number | null): string {
  if (cents == null) return "";
  return `€${(cents / 100).toFixed(2)}`;
}

function lineDeposit(line: OrderLine): number {
  return line.items.reduce((s, a) => s + ((a as ArticleWithDeposit).deposit ?? 0), 0);
}

function fmtSlotWindow(slot: DeliverySlot): string {
  const start = new Date(slot.window_start);
  const end = new Date(slot.window_end);
  const day = start.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
  const t = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${t(start)}–${t(end)}`;
}

function lineSummary(line: OrderLine): string {
  const qty = line.items.length;
  const first = line.items[0];
  if (!first) return "";
  const id = first.id;
  const name = first.name;
  const unit = first.unit_quantity;
  const linePrice = fmtPrice(line.display_price);
  const dep = lineDeposit(line);
  const depStr = dep ? ` (+${fmtPrice(dep)} dep)` : "";
  return `${qty}× ${id.padEnd(10)} ${name} (${unit}) ${linePrice}${depStr}`;
}

export function formatCart(cart: Cart): string {
  const lines: string[] = [];
  if (!cart.items.length) {
    lines.push("(cart is empty)");
  } else {
    for (const line of cart.items) lines.push(lineSummary(line));
  }
  lines.push("─".repeat(60));

  const articleDeposit = cart.items.reduce((s, l) => s + lineDeposit(l), 0);
  const breakdownDeposit = cart.deposit_breakdown.reduce((s, d) => s + d.value * d.count, 0);
  const deposit = breakdownDeposit || articleDeposit;
  const grandTotal = cart.checkout_total_price + (breakdownDeposit ? 0 : articleDeposit);

  const summary: string[] = [`Total: ${fmtPrice(grandTotal)}`];
  if (deposit) summary.push(`(incl ${fmtPrice(deposit)} dep)`);
  if (cart.total_savings) summary.push(`Savings: ${fmtPrice(cart.total_savings)}`);
  summary.push(`Items: ${cart.total_count}`);
  lines.push(summary.join("   "));

  const selected = cart.delivery_slots.find((s) => s.slot_id === cart.selected_slot?.slot_id);
  if (selected) {
    const mov = selected.minimum_order_value ? `  MOV ${fmtPrice(selected.minimum_order_value)}` : "";
    lines.push(`Slot:  ${fmtSlotWindow(selected)}${mov}`);
  } else {
    lines.push("Slot:  (none selected)");
  }
  return lines.join("\n");
}

import { describe, expect, test } from "bun:test";
import { formatCart } from "./format.ts";
import type { Cart, OrderLine } from "picnic-api/lib/domains/cart/types";

function article(id: string, name: string, price: number) {
  return {
    type: "ORDER_ARTICLE",
    id,
    name,
    unit_quantity: "500g",
    price,
    decorators: [{ type: "QUANTITY", quantity: 1 }],
    max_count: 99,
    image_ids: [],
    perishable: false,
    analytics_contexts: [],
    selling_unit_contexts_for_mutations: [],
  };
}

// Mirrors the live API shape: undiscounted display_price/price on the line,
// discounted total in a PRICE decorator, API label in PROMO, cart-level
// family total in membership_savings.
function cartWithFamilyDiscount(): Cart {
  const familyLine = {
    type: "ORDER_LINE",
    id: "1",
    items: [article("s1019260", "Bio Karotte-Vollkorn geschnitten", 449)],
    display_price: 449,
    price: 449,
    decorators: [
      { type: "PROMO", text: "10% Rabatt", background_color: "#295813", text_color: "#FFFFFF" },
      { type: "PRICE", display_price: 404 },
    ],
  } as unknown as OrderLine;
  const plainLine = {
    type: "ORDER_LINE",
    id: "2",
    items: [article("s1021655", "Bonduelle Weiße Bohnen", 179)],
    display_price: 179,
    price: 179,
  } as unknown as OrderLine;
  return {
    type: "ORDER",
    id: "shopping_cart",
    items: [familyLine, plainLine],
    delivery_slots: [],
    selected_slot: { slot_id: "x", state: "IMPLICIT" },
    slot_selector_message: null,
    total_count: 2,
    total_price: 583,
    checkout_total_price: 583,
    total_savings: 0,
    mts: 0,
    deposit_breakdown: [],
    decorator_overrides: {},
    state_token: "",
    fees: [],
    basket_sections: [],
    analytics_context_data: { items_list: [] },
    show_create_sellable_banner: false,
    membership_savings: 45,
  } as unknown as Cart;
}

describe("formatCart family discount", () => {
  test("discounted line shows effective price and API promo label", () => {
    const out = formatCart(cartWithFamilyDiscount());
    expect(out).toContain("€4.04 (-€0.45 10% Rabatt)");
    expect(out).not.toContain("€4.49 (-");
  });

  test("undiscounted line is unchanged", () => {
    const out = formatCart(cartWithFamilyDiscount());
    expect(out).toContain("Bonduelle Weiße Bohnen (500g) €1.79");
  });

  test("summary shows cart-level family savings", () => {
    const out = formatCart(cartWithFamilyDiscount());
    expect(out).toContain("Total: €5.83");
    expect(out).toContain("Family: €0.45");
  });

  test("cart without family discount shows no Family segment", () => {
    const cart = cartWithFamilyDiscount();
    cart.membership_savings = 0;
    cart.items = [cart.items[1]];
    const out = formatCart(cart);
    expect(out).not.toContain("Family:");
    expect(out).not.toContain("(-€");
  });
});

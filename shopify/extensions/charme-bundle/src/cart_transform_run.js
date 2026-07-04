// @ts-check

/**
 * Charmé cart bundle — Cart Transform `cart.transform.run` target.
 * --------------------------------------------------------------------------
 * A finished custom case is added to the native cart as several lines that all
 * share the same `_design_token` line-item property:
 *   • the base case variant (model × colour) at its base price
 *   • one line per charm (via the store's £2/£3/£5 charm variants)
 *
 * This function MERGES every line of the same design into ONE parent
 * "Custom Charm Case" line so the customer sees a single item in the cart /
 * checkout, with the charms listed as its components. For a `linesMerge`
 * operation the bundle price is the SUM of its components, so base + charms is
 * charged correctly without any custom pricing (no Shopify Plus required).
 *
 * The parent variant id is read from an app-owned shop metafield
 * ($app:charme / parent_variant) — point it at a hidden "Custom Charm Case"
 * product via shopify/scripts/activate-cart-transform.mjs.
 */

/** @typedef {{ operations: Array<Record<string, unknown>> }} CartTransformRunResult */

/** @type {CartTransformRunResult} */
const NO_CHANGES = { operations: [] };

/**
 * @param {any} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const parentVariantId = input?.shop?.parentVariant?.value;
  if (!parentVariantId) return NO_CHANGES;

  // Group cart lines by the design token they belong to.
  /** @type {Map<string, Array<{ id: string, quantity: number }>>} */
  const groups = new Map();
  for (const line of input.cart.lines) {
    const token = line.designToken?.value;
    if (!token) continue;
    const arr = groups.get(token) || [];
    arr.push(line);
    groups.set(token, arr);
  }

  const operations = [];
  for (const lines of groups.values()) {
    // Only bundle when there's more than the base line (i.e. at least one charm).
    if (lines.length < 2) continue;
    operations.push({
      linesMerge: {
        cartLines: lines.map((l) => ({ cartLineId: l.id, quantity: l.quantity })),
        parentVariantId,
        title: "Custom Charm Case",
      },
    });
  }

  return operations.length ? { operations } : NO_CHANGES;
}

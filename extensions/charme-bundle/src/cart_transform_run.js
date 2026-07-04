// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/**
 * @type {CartTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * Merge every cart line of one custom design (the base case line + charm lines
 * that share the same `_design_token`) into ONE parent "Custom Charm Case"
 * line, so the customer sees a single item in the cart & checkout with the
 * charms as its components. For a linesMerge the bundle price is the SUM of its
 * components, so base + charms is charged correctly (no Shopify Plus needed).
 *
 * The parent variant id comes from the app-owned shop metafield
 * $app:charme/parent_variant (set by activate-cart-transform.mjs).
 *
 * @param {CartTransformRunInput} input
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
};
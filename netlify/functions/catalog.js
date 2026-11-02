// Single source of truth for what can be bought. Prices are in NZD cents.
// The browser only sends { sku, qty }; every price is looked up here.
const CATALOG = {
  'hh-shampoo':        { name: 'Honeycomb Hound Shampoo (200ml)', cents: 2000 },
  'hh-conditioner':    { name: 'Honeycomb Hound Conditioner (200ml)', cents: 2000 },
  'hh-spritz':         { name: 'Honeycomb Hound Coat Spritz (100ml)', cents: 1000 },
  'paw-petite':        { name: 'Petite Paw Balm (5g)', cents: 500 },
  'paw-prodigious':    { name: 'Tremendous Trotters Paw Balm (60g)', cents: 2000 },
  'witch-please':      { name: 'Witch Please Spritz (100ml)', cents: 1000 },
  'apple-oat-1':       { name: 'Apple Oat Biscuit (single)', cents: 120 },
  'apple-oat-5':       { name: 'Apple Oat Biscuits (5-pack)', cents: 500 },
  'pumpkin-small-1':   { name: 'Pumpkin Bliss Ball, small (single)', cents: 200 },
  'pumpkin-small-5':   { name: 'Pumpkin Bliss Balls, small (5-pack)', cents: 800 },
  'pumpkin-large-1':   { name: 'Pumpkin Bliss Ball, large (single)', cents: 250 },
  'pumpkin-large-5':   { name: 'Pumpkin Bliss Balls, large (5-pack)', cents: 1000 },
  'kumara-small-1':    { name: 'Kumara Bliss Ball, small (single)', cents: 200 },
  'kumara-small-5':    { name: 'Kumara Bliss Balls, small (5-pack)', cents: 800 },
  'kumara-large-1':    { name: 'Kumara Bliss Ball, large (single)', cents: 250 },
  'kumara-large-5':    { name: 'Kumara Bliss Balls, large (5-pack)', cents: 1000 },
};

const MAX_QTY = 50;
const MAX_LINES = 20;

// Returns { items } or { error }. Rejects anything not in the catalog.
function validateCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0 || cart.length > MAX_LINES) {
    return { error: 'Your order is empty.' };
  }
  const merged = new Map();
  for (const line of cart) {
    const sku = line && line.sku;
    const qty = line && line.qty;
    if (typeof sku !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOG, sku)) {
      return { error: 'Unknown product in order.' };
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { error: 'Invalid quantity.' };
    }
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }
  const items = [];
  for (const [sku, qty] of merged) {
    if (qty > MAX_QTY) return { error: 'Invalid quantity.' };
    items.push({ sku, qty, ...CATALOG[sku] });
  }
  return { items };
}

module.exports = { CATALOG, validateCart };

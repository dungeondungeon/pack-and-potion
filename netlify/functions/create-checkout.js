const { validateCart } = require('./catalog');

const SHIPPING_CENTS = 1000;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Builds the form-encoded body Stripe's Checkout Sessions API expects.
function buildSessionParams(items, origin) {
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', `${origin}/?order=success`);
  p.set('cancel_url', `${origin}/?order=cancelled#shelf`);
  p.set('currency', 'nzd');
  p.set('billing_address_collection', 'auto');
  p.set('shipping_address_collection[allowed_countries][0]', 'NZ');
  p.set('phone_number_collection[enabled]', 'true');

  items.forEach((it, i) => {
    p.set(`line_items[${i}][quantity]`, String(it.qty));
    p.set(`line_items[${i}][price_data][currency]`, 'nzd');
    p.set(`line_items[${i}][price_data][unit_amount]`, String(it.cents));
    p.set(`line_items[${i}][price_data][product_data][name]`, it.name);
  });

  p.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  p.set('shipping_options[0][shipping_rate_data][display_name]', 'NZ-wide shipping');
  p.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(SHIPPING_CENTS));
  p.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'nzd');
  p.set('shipping_options[1][shipping_rate_data][type]', 'fixed_amount');
  p.set('shipping_options[1][shipping_rate_data][display_name]', 'Free local delivery (Te Aroha & Hamilton only)');
  p.set('shipping_options[1][shipping_rate_data][fixed_amount][amount]', '0');
  p.set('shipping_options[1][shipping_rate_data][fixed_amount][currency]', 'nzd');

  p.set('custom_text[submit][message]', 'Free local delivery applies to Te Aroha and Hamilton addresses only. We will contact you if the address does not qualify.');
  p.set('metadata[order]', items.map((i) => `${i.sku}x${i.qty}`).join(',').slice(0, 480));
  return p;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'Checkout is not configured yet.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Bad request.' }); }

  const { items, error } = validateCart(body.cart);
  if (error) return json(400, { error });

  // Redirect back to the host that served this request (so deploy previews return to the
  // preview, not production). process.env.URL is always the production URL on Netlify.
  const origin = `https://${event.headers.host}`;

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildSessionParams(items, origin).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      console.error('Stripe error', res.status, data && data.error && data.error.message);
      return json(502, { error: 'Could not start checkout. Please try again.' });
    }
    return json(200, { url: data.url });
  } catch (e) {
    console.error('Checkout failure', e.message);
    return json(502, { error: 'Could not start checkout. Please try again.' });
  }
};

exports.buildSessionParams = buildSessionParams;

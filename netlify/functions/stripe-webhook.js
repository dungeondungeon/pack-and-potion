// Emails PackandPotion a packing-slip style order summary when a Checkout payment completes.
// Needs these Netlify env vars (Functions scope): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// RESEND_API_KEY, ORDER_EMAIL_TO, and optionally ORDER_EMAIL_FROM.
const crypto = require('crypto');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (cents, cur) => `${(cents / 100).toFixed(2)} ${String(cur || 'nzd').toUpperCase()}`;

// Stripe-Signature: t=timestamp,v1=hexsig[,v1=...]. Signed payload is `${t}.${rawBody}`.
function verifySignature(rawBody, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.split('='));
  const t = (parts.find(([k]) => k === 't') || [])[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

function buildEmail(session, lineItems) {
  const sd = session.shipping_details || session.collected_information?.shipping_details || {};
  const a = sd.address || {};
  const cust = session.customer_details || {};
  const shipCents = session.total_details?.amount_shipping ?? 0;
  const addrLines = [sd.name || cust.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country]
    .filter(Boolean);
  const phone = cust.phone || '(none given)';

  const rows = lineItems.map((li) => ({ name: li.description, qty: li.quantity, total: li.amount_total }));
  const text = [
    `New Pack and Potion order (${money(session.amount_total, session.currency)})`,
    '',
    'ITEMS',
    ...rows.map((r) => `  ${r.qty} x ${r.name}  -  ${money(r.total, session.currency)}`),
    `  Shipping: ${shipCents === 0 ? 'FREE local delivery (check the address is Te Aroha or Hamilton)' : money(shipCents, session.currency)}`,
    '',
    'SHIP TO',
    ...addrLines.map((l) => `  ${l}`),
    `  Phone: ${phone}`,
    `  Email: ${cust.email || '(none)'}`,
    '',
    `Stripe session: ${session.id}`,
  ].join('\n');

  const html = `<h2>New Pack and Potion order: ${esc(money(session.amount_total, session.currency))}</h2>
<table cellpadding="6" style="border-collapse:collapse">
${rows.map((r) => `<tr><td><b>${esc(r.qty)} &times;</b></td><td>${esc(r.name)}</td><td align="right">${esc(money(r.total, session.currency))}</td></tr>`).join('\n')}
<tr><td></td><td>Shipping${shipCents === 0 ? ' (<b>free local delivery</b>: check the address is Te Aroha or Hamilton)' : ''}</td><td align="right">${esc(money(shipCents, session.currency))}</td></tr>
</table>
<h3>Ship to</h3>
<p>${addrLines.map(esc).join('<br>')}<br>Phone: ${esc(phone)}<br>Email: ${esc(cust.email || '(none)')}</p>
<p style="color:#777">Stripe session ${esc(session.id)}</p>`;

  return { subject: `New order: ${money(session.amount_total, session.currency)} (${rows.reduce((n, r) => n + r.qty, 0)} items)`, text, html };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_EMAIL_TO;
  if (!secret || !stripeKey || !resendKey || !to) {
    console.error('stripe-webhook: missing env vars');
    return json(500, { error: 'Not configured.' });
  }

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (!verifySignature(raw, event.headers['stripe-signature'], secret)) {
    return json(400, { error: 'Bad signature.' });
  }

  let evt;
  try { evt = JSON.parse(raw); } catch { return json(400, { error: 'Bad request.' }); }
  if (evt.type !== 'checkout.session.completed' && evt.type !== 'checkout.session.async_payment_succeeded') {
    return json(200, { ignored: evt.type });
  }
  const session = evt.data && evt.data.object;
  if (!session || session.payment_status === 'unpaid') return json(200, { ignored: 'unpaid' });

  try {
    const auth = { Authorization: `Bearer ${stripeKey}` };
    const li = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`, { headers: auth });
    const liData = await li.json();
    if (!li.ok) throw new Error(`line_items ${li.status}: ${liData.error && liData.error.message}`);

    const mail = buildEmail(session, liData.data || []);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ORDER_EMAIL_FROM || 'Pack and Potion Orders <onboarding@resend.dev>',
        to: [to],
        reply_to: session.customer_details?.email || undefined,
        ...mail,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`resend ${res.status}: ${detail.slice(0, 300)}`);
    }
    return json(200, { sent: true });
  } catch (e) {
    console.error('stripe-webhook failure', e.message);
    // Detail is only ever returned to a caller with a valid Stripe signature, and holds no secrets.
    return json(500, { error: 'Failed; Stripe will retry.', detail: String(e.message).slice(0, 400) }); // Stripe retries non-2xx
  }
};

exports.verifySignature = verifySignature;
exports.buildEmail = buildEmail;

// POST /api/sumup-webhook
// SumUp calls this when a checkout changes. We never trust the body: we look the checkout up
// with SumUp ourselves. This catches payments where the customer closed the tab early.
import { json, settleCheckout } from '../lib/shared.mjs';

export default async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body.id || body.checkout_id || body?.payload?.checkout_id;
    // Checkout ids are UUID-like; settleCheckout looks the order up before calling SumUp
    if (id && /^[0-9a-zA-Z_-]{8,64}$/.test(String(id))) await settleCheckout(String(id));
  } catch (e) {
    console.error(e);
  }
  return json(200, { ok: true }); // always 200 so SumUp doesn't retry forever
};

export const config = { path: '/api/sumup-webhook' };

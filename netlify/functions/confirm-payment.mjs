// POST /api/confirm-payment  { orderId }
// Called by the shop page after the card form reports back. Asks SumUp directly whether
// the payment went through, because the browser's word alone isn't proof.
import { json, sb, userFromRequest, settleCheckout } from '../lib/shared.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const user = await userFromRequest(req);
    if (!user) return json(401, { error: 'Please log in again.' });
    const { orderId } = await req.json();
    const [order] = await sb(`orders?id=eq.${Number(orderId)}&customer_id=eq.${user.id}&select=id,sumup_checkout_id,status`);
    if (!order) return json(404, { error: 'Order not found.' });
    if (!order.sumup_checkout_id) return json(400, { error: 'This order has no payment attached.' });

    const result = await settleCheckout(order.sumup_checkout_id);
    const [fresh] = await sb(`orders?id=eq.${order.id}&select=*`);
    return json(200, { status: result.status, order: fresh });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'We could not confirm the payment yet. If your card was charged, we will still receive the order.' });
  }
};

export const config = { path: '/api/confirm-payment' };

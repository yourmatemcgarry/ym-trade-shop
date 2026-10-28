// Pure order logic: validates a basket + fulfilment choice and works out the money.
// The browser shows the same maths for display, but this server copy is the one that counts.
import { dayDiff, weekday, UNATTENDED } from './shared.mjs';

const round2 = (n) => Math.round(n * 100) / 100;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const clean = (s, max = 500) => String(s ?? '').trim().slice(0, max);

export function buildOrder({ priceList, settings, input, today, hour = 0 }) {
  const errors = [];
  const byId = new Map(priceList.map((p) => [p.id, p]));

  // ----- Items -----
  const items = [];
  const rawItems = input.items && typeof input.items === 'object' ? input.items : {};
  for (const [id, rawQty] of Object.entries(rawItems)) {
    const qty = Number(rawQty);
    if (!qty) continue;
    const p = byId.get(id);
    if (!p) { errors.push(`An item in your order is no longer available. Refresh the page and try again.`); continue; }
    if (!Number.isInteger(qty) || qty < 0 || qty > 999) { errors.push(`Check the quantity for ${p.name}.`); continue; }
    if (p.max_per_order && qty > p.max_per_order) { errors.push(`${p.name} ${p.pack} is limited to ${p.max_per_order} per order.`); continue; }
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) { errors.push(`${p.name} ${p.pack} isn't priced correctly. Call us to order it.`); continue; }
    items.push({ product_id: p.id, sku: p.sku, name: p.name, pack: p.pack, qty, price, line: round2(price * qty) });
  }
  if (!items.length && !errors.length) errors.push('Your order is empty.');

  // ----- Fulfilment -----
  const f = input.fulfilment || {};
  // Earliest day: lead days from today, plus one more after the daily cut-off time
  const lead = Number(settings.lead_days ?? 1) + (hour >= Number(settings.cutoff_hour ?? 24) ? 1 : 0);
  const fulfilment = { method: f.method === 'delivery' ? 'delivery' : 'pickup' };

  if (!isDate(f.date)) errors.push('Choose a day.');
  else {
    const ahead = dayDiff(today, f.date);
    if (ahead < lead || ahead > 60) errors.push('That day is no longer available. Pick another.');
    const days = fulfilment.method === 'pickup' ? settings.pickup_days : settings.delivery_days;
    if (!days.includes(weekday(f.date))) errors.push(`We don't ${fulfilment.method === 'pickup' ? 'do pickups' : 'deliver'} on that day.`);
    fulfilment.date = f.date;
  }

  if (fulfilment.method === 'pickup') {
    if (!settings.pickup_slots.includes(f.slot)) errors.push('Choose a pickup time.');
    fulfilment.slot = f.slot;
    fulfilment.pickup_address = settings.pickup_address;
  } else {
    fulfilment.address_line = clean(f.address_line, 200);
    fulfilment.suburb = clean(f.suburb, 80);
    fulfilment.postcode = String(f.postcode ?? '').trim();
    if (!fulfilment.address_line || !fulfilment.suburb) errors.push('Add the delivery address.');
    const pc = Number(fulfilment.postcode);
    if (!/^\d{4}$/.test(fulfilment.postcode) || pc < settings.pc_from || pc > settings.pc_to)
      errors.push(`We deliver to postcodes ${settings.pc_from}–${settings.pc_to}.`);
    if (!isDate(f.need_by)) errors.push('Tell us the date you need it by.');
    else if (dayDiff(today, f.need_by) < lead || dayDiff(today, f.need_by) > 90) errors.push('Check the date you need it by.');
    else if (isDate(f.date) && f.need_by < f.date) errors.push('Your preferred delivery day is after the date you need it by. Pick an earlier day.');
    fulfilment.need_by = f.need_by;
    fulfilment.need_by_time = clean(f.need_by_time, 20);
    fulfilment.unattended = UNATTENDED[f.unattended] ? f.unattended : 'attend';
    fulfilment.leave_where = clean(f.leave_where, 200);
    if (fulfilment.unattended === 'leave' && !fulfilment.leave_where) errors.push('Tell us where to leave it.');
    fulfilment.delivery_notes = clean(f.delivery_notes, 500);
  }
  if (!input.age_confirmed) errors.push('Confirm that whoever collects or receives the order is 18 or over.');

  // ----- Money -----
  const goods = round2(items.reduce((a, i) => a + i.line, 0));
  const delivery_fee = fulfilment.method === 'delivery' && goods < Number(settings.free_over) ? Number(settings.delivery_fee) : 0;
  const card_fee = round2((goods + delivery_fee) * Number(settings.card_fee_pct) / 100);
  const total = round2(goods + delivery_fee + card_fee);
  const gst = round2(total / 11);
  if (!errors.length && !(total > 0)) errors.push('Your order total looks wrong. Refresh the page and try again.');

  return { errors, order: { items, goods, delivery_fee, card_fee, total, gst, fulfilment, notes: clean(input.notes, 1000) } };
}

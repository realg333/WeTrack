import { z } from 'zod';
import { webhookSchema } from './domain.mjs';

const text = z.string().max(200).nullable().optional();
const cents = z.number().int().min(0).max(1000000000);
const utc = (value) => {
  if (!value) return undefined;
  // The UTMify payload defines dates without a suffix as UTC, never local time.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  return z.string().datetime({ offset: true }).parse(iso);
};
const schema = z.object({
  orderId: z.string().min(1).max(120),
  platform: z.string().min(1).max(100),
  paymentMethod: z.enum(['pix', 'credit_card', 'boleto', 'paypal', 'free_price']),
  status: z.enum(['waiting_payment', 'paid', 'refused', 'refunded', 'chargedback']),
  createdAt: z.string(),
  approvedDate: z.string().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  customer: z.object({
    name: z.string().max(100),
    email: z.string().email().max(200),
    phone: text,
    country: z.string().max(2).optional(),
  }),
  products: z
    .array(
      z.object({
        id: z.string().max(120),
        name: z.string().min(1).max(150),
        quantity: z.number().int().positive(),
        priceInCents: cents,
      }),
    )
    .min(1)
    .max(100),
  trackingParameters: z
    .object({
      src: text,
      sck: text,
      utm_source: text,
      utm_medium: text,
      utm_campaign: text,
      utm_content: text,
      utm_term: text,
      visitor_id: text,
    })
    .default({}),
  commission: z.object({
    totalPriceInCents: cents,
    gatewayFeeInCents: cents.optional(),
    userCommissionInCents: cents.optional(),
    currency: z.literal('BRL').optional(),
  }),
  isTest: z.boolean().default(false),
});
export function normalizeUtmify(raw) {
  const v = schema.parse(raw),
    utm = v.trackingParameters;
  const external = (s) => s?.match(/(?:^|\|)(\d+)$/)?.[1];
  let phone = v.customer.phone?.replace(/\D/g, '');
  if (phone && (v.customer.country || 'BR') === 'BR' && [10, 11].includes(phone.length))
    phone = '55' + phone;
  const ref = [utm.sck, utm.src].find((s) => /^wt[a-zA-Z0-9]{16,26}$/.test(s || ''));
  return {
    isTest: v.isTest,
    sale: webhookSchema.parse({
      order_id: v.orderId,
      status: {
        waiting_payment: 'pending',
        paid: 'approved',
        refused: 'canceled',
        refunded: 'refunded',
        chargedback: 'chargeback',
      }[v.status],
      amount: v.commission.totalPriceInCents / 100,
      product: v.products
        .map((p) => p.name)
        .join(' + ')
        .slice(0, 150),
      customer_name: v.customer.name,
      customer_email: v.customer.email,
      customer_phone: phone || undefined,
      payment_method: ['pix', 'credit_card', 'boleto'].includes(v.paymentMethod)
        ? v.paymentMethod
        : 'other',
      utm_source:
        { FB: 'facebook', IG: 'instagram', GOOGLE: 'google', TIKTOK: 'tiktok' }[
          utm.utm_source?.toUpperCase()
        ] ||
        utm.utm_source ||
        'direct',
      utm_campaign: utm.utm_campaign || '',
      utm_medium: utm.utm_medium || '',
      utm_content: utm.utm_content || '',
      utm_term: utm.utm_term || '',
      adset_id: external(utm.utm_medium),
      ad_id: external(utm.utm_content),
      visitor_id: utm.visitor_id || undefined,
      attribution_code: ref,
      created_at: utc(v.createdAt),
      approved_at: utc(v.approvedDate),
    }),
  };
}

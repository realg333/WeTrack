import { z } from 'zod';
import { feeAmounts } from './fees.mjs';

export const dateKey = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
export const money = (value) => Math.round(value * 100) / 100;
export const ratio = (a, b) => (b ? a / b : 0);
export const campaignSchema = z.object({
  name: z.string().trim().min(3).max(100),
  source: z.enum(['Meta Ads', 'Google Ads', 'TikTok Ads']).default('Meta Ads'),
  budget: z.number().min(0).max(1000000),
  project_id: z.string(),
  currency: z.enum(['BRL', 'USD']).default('BRL'),
});
export const pixelSchema = z.object({
  name: z.string().trim().min(3).max(80),
  domain: z
    .string()
    .url()
    .refine((v) => ['https:', 'http:'].includes(new URL(v).protocol)),
  checkout_url: z.union([z.string().url(), z.literal('')]).default(''),
  project_id: z.string(),
});
export const webhookSchema = z.object({
  order_id: z.string().min(1).max(120),
  status: z.enum(['approved', 'pending', 'refunded', 'chargeback', 'canceled', 'disputed']),
  amount: z.number().finite().min(0).max(10000000),
  currency: z.enum(['BRL', 'USD']).default('BRL'),
  customer_name: z.string().max(100).default('Cliente'),
  customer_email: z.string().email().max(200).optional(),
  customer_phone: z
    .string()
    .regex(/^\+?[1-9][0-9]{7,14}$/)
    .optional(),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(300).optional(),
  product: z.string().min(1).max(150),
  payment_method: z.enum(['pix', 'credit_card', 'boleto', 'debit_card', 'other']).default('pix'),
  utm_source: z.string().max(100).default('direct'),
  utm_campaign: z.string().max(200).default(''),
  utm_medium: z.string().max(100).default(''),
  utm_content: z.string().max(200).default(''),
  utm_term: z.string().max(200).default(''),
  adset_id: z.string().max(200).optional(),
  ad_id: z.string().max(200).optional(),
  visitor_id: z.string().max(100).optional(),
  attribution_code: z
    .string()
    .regex(/^wt[a-zA-Z0-9]{16,26}$/)
    .optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  approved_at: z.string().datetime({ offset: true }).optional(),
  action_source: z.enum(['website', 'system_generated']).optional(),
});
export function summarize(sales, spend, visits, fees) {
  const approved = sales.filter((s) => s.status === 'approved');
  const revenue = money(approved.reduce((sum, s) => sum + s.amount, 0));
  const costs = feeAmounts(revenue, fees);
  const profit = money(revenue - spend - costs.gateway_fee - costs.tax);
  return {
    revenue,
    spend: money(spend),
    ...costs,
    profit,
    sales: approved.length,
    roas: ratio(revenue, spend),
    cpa: ratio(spend, approved.length),
    ticket: ratio(revenue, approved.length),
    margin: ratio(profit, revenue) * 100,
    visits,
    conversion: ratio(approved.length, visits) * 100,
    pending: sales.filter((s) => s.status === 'pending').length,
  };
}

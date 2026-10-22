import { z } from 'zod';

export const feeSchema = z
  .object({
    gateway_percent: z.number().finite().min(0).max(100),
    tax_percent: z.number().finite().min(0).max(100),
    gateway_fixed: z.number().finite().min(0).max(1000000).multipleOf(0.01).default(0),
    credit_card_percent: z.number().finite().min(0).max(100).default(0),
    pix_percent: z.number().finite().min(0).max(100).default(0),
  })
  .strict();

export function readFees(db, projectId) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(`fees:${projectId}`);
  return feeSchema.parse(row ? JSON.parse(row.value) : { gateway_percent: 0, tax_percent: 0 });
}

export function feeAmounts(revenue, fees = {}, basis = {}) {
  const round = (value) => Math.round(value * 100) / 100;
  const costs = {
    gateway_fee: round((revenue * (fees.gateway_percent || 0)) / 100),
    gateway_fixed_fee: round((basis.sales || 0) * (fees.gateway_fixed || 0)),
    credit_card_fee: round(((basis.card_revenue || 0) * (fees.credit_card_percent || 0)) / 100),
    pix_fee: round(((basis.pix_revenue || 0) * (fees.pix_percent || 0)) / 100),
    tax: round((revenue * (fees.tax_percent || 0)) / 100),
  };
  return {
    ...costs,
    total_fees: round(Object.values(costs).reduce((sum, amount) => sum + amount, 0)),
  };
}

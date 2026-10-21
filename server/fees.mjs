import { z } from 'zod';

export const feeSchema = z
  .object({
    gateway_percent: z.number().finite().min(0).max(100),
    tax_percent: z.number().finite().min(0).max(100),
  })
  .strict();

export function readFees(db, projectId) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(`fees:${projectId}`);
  return row ? feeSchema.parse(JSON.parse(row.value)) : { gateway_percent: 0, tax_percent: 0 };
}

export function feeAmounts(revenue, fees = {}) {
  const round = (value) => Math.round(value * 100) / 100;
  return {
    gateway_fee: round((revenue * (fees.gateway_percent || 0)) / 100),
    tax: round((revenue * (fees.tax_percent || 0)) / 100),
  };
}

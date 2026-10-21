export const supportedCurrencies = ['BRL', 'USD'];
export const campaignCurrency =
  "COALESCE((SELECT currency FROM campaign_currencies WHERE campaign_id=c.id),'BRL')";
export const saleCurrency =
  "COALESCE((SELECT currency FROM sale_currencies WHERE sale_id=s.id),'BRL')";

export function saveSaleCurrency(db, saleId, currency = 'BRL', existing = false) {
  const previous =
    db.prepare('SELECT currency FROM sale_currencies WHERE sale_id=?').get(saleId)?.currency ||
    'BRL';
  if (existing && previous !== currency)
    throw Object.assign(new Error('A moeda de um pedido existente não pode ser alterada.'), {
      status: 400,
    });
  db.prepare('INSERT OR IGNORE INTO sale_currencies VALUES(?,?)').run(saleId, currency);
}

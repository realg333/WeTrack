import { createHash } from 'node:crypto';

export const phoneHash = (phone) =>
  createHash('sha256')
    .update(String(phone || '').replace(/\D/g, ''))
    .digest('hex');
export function matchWhatsAppSale(db, saleId) {
  if (db.prepare('SELECT sale_id FROM wa_sale_links WHERE sale_id=?').get(saleId)) return;
  const sale = db
    .prepare(
      'SELECT s.*,a.visitor_id,i.phone_hash FROM sales s LEFT JOIN sale_attribution a ON a.sale_id=s.id LEFT JOIN sale_identity i ON i.sale_id=s.id WHERE s.id=?',
    )
    .get(saleId);
  if (!sale) return;
  const saleTime = new Date(sale.created_at).toISOString();
  const since = new Date(Date.parse(sale.created_at) - 30 * 86400000).toISOString();
  // A visit identifier is a stronger match than a phone number. Both are scoped to this operation.
  let conversation = sale.visitor_id
    ? db
        .prepare(
          'SELECT * FROM wa_conversations WHERE project_id=? AND visitor_id=? AND started_at<=? AND started_at>=? ORDER BY started_at DESC LIMIT 1',
        )
        .get(sale.project_id, sale.visitor_id, saleTime, since)
    : null;
  if (!conversation && sale.phone_hash) {
    const contact = db
      .prepare('SELECT id FROM wa_contacts WHERE project_id=? AND phone_hash=?')
      .get(sale.project_id, sale.phone_hash);
    if (contact)
      conversation = db
        .prepare(
          'SELECT * FROM wa_conversations WHERE project_id=? AND contact_id=? AND started_at<=? AND started_at>=? ORDER BY started_at DESC LIMIT 1',
        )
        .get(sale.project_id, contact.id, saleTime, since);
  }
  if (conversation)
    db.prepare('INSERT OR IGNORE INTO wa_sale_links VALUES(?,?,?,?,?,?)').run(
      sale.id,
      sale.project_id,
      conversation.contact_id,
      conversation.id,
      sale.visitor_id === conversation.visitor_id ? 'visitor' : 'phone',
      new Date().toISOString(),
    );
}
export function rememberSaleIdentity(db, saleId, projectId, data) {
  const phone = String(data.customer_phone || '').replace(/\D/g, '');
  if (/^[1-9]\d{7,14}$/.test(phone))
    db.prepare(
      'INSERT INTO sale_identity VALUES(?,?,?) ON CONFLICT(sale_id) DO UPDATE SET phone_hash=excluded.phone_hash',
    ).run(saleId, projectId, phoneHash(phone));
  matchWhatsAppSale(db, saleId);
}
export function reconcileWhatsAppSales(db, projectId, contactId) {
  const contact = db
    .prepare('SELECT * FROM wa_contacts WHERE id=? AND project_id=?')
    .get(contactId, projectId);
  if (!contact) return;
  const sales = db
    .prepare(
      `SELECT s.id FROM sales s LEFT JOIN sale_identity i ON i.sale_id=s.id LEFT JOIN sale_attribution a ON a.sale_id=s.id
    WHERE s.project_id=? AND NOT EXISTS(SELECT 1 FROM wa_sale_links l WHERE l.sale_id=s.id) AND
    (i.phone_hash=? OR a.visitor_id IN (SELECT visitor_id FROM wa_conversations WHERE project_id=? AND contact_id=?))`,
    )
    .all(projectId, phoneHash(contact.wa_id), projectId, contact.id);
  for (const sale of sales) matchWhatsAppSale(db, sale.id);
}

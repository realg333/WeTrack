// IDs take priority. A repeated campaign name cannot identify a single account.
export function resolveCampaign(db, projectId, reference) {
  if (!reference) return null;
  const external = reference.match(/\|(\d+)$/)?.[1] || reference;
  const exact = db
    .prepare(
      'SELECT c.id FROM campaigns c LEFT JOIN meta_campaigns m ON m.campaign_id=c.id WHERE c.project_id=? AND (c.id=? OR m.external_id=?)',
    )
    .get(projectId, reference, external);
  if (exact) return exact;
  const names = db
    .prepare('SELECT id FROM campaigns WHERE project_id=? AND name=? LIMIT 2')
    .all(projectId, reference);
  return names.length === 1 ? names[0] : null;
}
export function resolveAd(db, projectId, reference) {
  return reference
    ? db
        .prepare(
          'SELECT ad.id,ad.adset_id,a.campaign_id FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN campaigns c ON c.id=a.campaign_id WHERE c.project_id=? AND (ad.id=? OR ad.external_id=?)',
        )
        .get(projectId, reference, reference.match(/\|(\d+)$/)?.[1] || reference)
    : null;
}
export function resolveAdset(db, projectId, reference) {
  return reference
    ? db
        .prepare(
          'SELECT a.id AS adset_id,a.campaign_id FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id WHERE c.project_id=? AND (a.id=? OR a.external_id=?)',
        )
        .get(projectId, reference, reference.match(/\|(\d+)$/)?.[1] || reference)
    : null;
}

export function isManualAttribution(db, saleId) {
  return Boolean(db.prepare('SELECT 1 FROM manual_sale_attribution WHERE sale_id=?').get(saleId));
}

// Keep the received references separate from the resolved hierarchy and manual corrections.
export function saveSaleTracking(db, saleId, term, adsetReference, adReference) {
  db.prepare(
    `INSERT INTO sale_tracking VALUES(?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET
      utm_term=COALESCE(NULLIF(sale_tracking.utm_term,''),excluded.utm_term),
      adset_reference=COALESCE(NULLIF(sale_tracking.adset_reference,''),excluded.adset_reference),
      ad_reference=COALESCE(NULLIF(sale_tracking.ad_reference,''),excluded.ad_reference)`,
  ).run(saleId, term || '', adsetReference || '', adReference || '');
}

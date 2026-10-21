import { createHash, randomUUID } from 'node:crypto';
import { dateKey } from './domain.mjs';
import { saveSaleCurrency } from './currencies.mjs';
import {
  resolveCampaign,
  resolveAd,
  resolveAdset,
  isManualAttribution,
  saveSaleTracking,
} from './attribution.mjs';

export function recordSale(db, meta, integration, input, options = {}) {
  let data = { ...input };
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const native = options.provider
      ? db
          .prepare(
            'SELECT * FROM provider_orders WHERE project_id=? AND provider=? AND external_id=?',
          )
          .get(integration.project_id, options.provider, data.order_id)
      : null;
    const previous = native
      ? db.prepare('SELECT * FROM sales WHERE id=?').get(native.sale_id)
      : db
          .prepare('SELECT * FROM sales WHERE integration_id=? AND external_id=?')
          .get(integration.id, data.order_id);
    const happened = Date.parse(data.occurred_at || now);
    if (
      native &&
      (happened < native.updated_at ||
        (['refunded', 'chargeback'].includes(previous.status) && data.status !== previous.status) ||
        (previous.status === 'approved' && ['pending', 'canceled'].includes(data.status)))
    ) {
      db.exec('COMMIT');
      return {
        ok: true,
        duplicate: true,
        ignored: 'Evento antigo ou regressão de status descartado.',
        id: previous.id,
        capi: 'not_queued',
      };
    }
    if (options.provider && data.tracking_code) {
      const ref = db
        .prepare('SELECT payload FROM checkout_refs WHERE project_id=? AND code=? AND expires_at>?')
        .get(integration.project_id, data.tracking_code, Date.now());
      if (ref) data = { ...data, ...JSON.parse(ref.payload) };
    }
    let source = data.utm_source,
      campaignName = data.utm_campaign;
    let attributionAd = data.ad_id || data.utm_content || '',
      attributionSet = data.adset_id || data.utm_term || '';
    if (data.visitor_id && source === 'direct') {
      const attribution = db
        .prepare(
          "SELECT e.utm_source,e.utm_campaign,d.utm_medium,d.utm_content,d.utm_term FROM events e LEFT JOIN event_details d ON d.event_id=e.id WHERE e.project_id=? AND e.visitor_id=? AND e.created_at>=? AND e.utm_source NOT IN ('direct','') ORDER BY e.created_at DESC LIMIT 1",
        )
        .get(
          integration.project_id,
          data.visitor_id,
          new Date(Date.now() - 7 * 86400000).toISOString(),
        );
      if (attribution) {
        source = attribution.utm_source;
        campaignName = attribution.utm_campaign;
        attributionAd ||= attribution.utm_content || '';
        attributionSet ||= attribution.utm_term || '';
        data.utm_medium ||= attribution.utm_medium || '';
        data.utm_content ||= attribution.utm_content || '';
        data.utm_term ||= attribution.utm_term || '';
      }
    }
    const campaign = resolveCampaign(db, integration.project_id, campaignName);
    const sid =
      previous?.id ||
      (options.provider
        ? 'sale_' +
          createHash('sha256')
            .update(JSON.stringify([integration.project_id, options.provider, data.order_id]))
            .digest('hex')
            .slice(0, 32)
        : 'sale_' + randomUUID().replaceAll('-', '').slice(0, 16));
    const time = data.created_at || now;
    const manual = isManualAttribution(db, sid);
    if (previous) {
      db.prepare(
        'UPDATE sales SET status=?,amount=?,utm_source=?,utm_campaign=?,utm_medium=?,utm_content=?,campaign_id=COALESCE(campaign_id,?),customer_email=COALESCE(customer_email,?),customer_name=?,payment_method=? WHERE id=?',
      ).run(
        data.status,
        data.amount,
        previous.utm_source === 'direct' && source !== 'direct' ? source : previous.utm_source,
        previous.utm_campaign || campaignName,
        previous.utm_medium || data.utm_medium,
        previous.utm_content || data.utm_content,
        manual ? null : campaign?.id || null,
        data.customer_email || null,
        previous.customer_name === 'Cliente' ? data.customer_name : previous.customer_name,
        previous.payment_method === 'other' ? data.payment_method : previous.payment_method,
        sid,
      );
    } else
      db.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        sid,
        integration.project_id,
        data.order_id,
        integration.id,
        campaign?.id || null,
        data.customer_name,
        data.customer_email || null,
        data.product,
        data.amount,
        data.status,
        data.payment_method,
        source,
        campaignName,
        data.utm_medium,
        data.utm_content,
        time,
        dateKey(new Date(time)),
      );
    saveSaleCurrency(db, sid, data.currency, Boolean(previous));
    const ad = resolveAd(db, integration.project_id, attributionAd),
      adset = ad || resolveAdset(db, integration.project_id, attributionSet);
    if (adset && !manual)
      db.prepare('UPDATE sales SET campaign_id=? WHERE id=?').run(adset.campaign_id, sid);
    saveSaleTracking(db, sid, data.utm_term, attributionSet, attributionAd);
    db.prepare(
      `INSERT INTO sale_attribution VALUES(?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET visitor_id=COALESCE(excluded.visitor_id,sale_attribution.visitor_id)${manual ? '' : ',adset_id=COALESCE(excluded.adset_id,sale_attribution.adset_id),ad_id=COALESCE(excluded.ad_id,sale_attribution.ad_id)'}`,
    ).run(
      sid,
      data.visitor_id || null,
      adset?.adset_id || attributionSet || null,
      ad?.id || attributionAd || null,
    );
    if (options.provider)
      db.prepare(
        'INSERT INTO provider_orders VALUES(?,?,?,?,?) ON CONFLICT(project_id,provider,external_id) DO UPDATE SET updated_at=excluded.updated_at',
      ).run(integration.project_id, options.provider, data.order_id, sid, happened);
    db.prepare('UPDATE integrations SET last_used=? WHERE id=?').run(now, integration.id);
    const queued =
      data.status === 'approved' && previous?.status !== 'approved' && !options.skipCapi
        ? meta.enqueue(sid, integration.id, data)
        : false;
    db.exec('COMMIT');
    return {
      ok: true,
      id: sid,
      duplicate: Boolean(previous),
      capi: queued ? 'queued' : 'not_queued',
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

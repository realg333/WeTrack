import { resolveAd, resolveAdset, resolveCampaign } from './attribution.mjs';
import { money } from './domain.mjs';
import { campaignCurrency, saleCurrency } from './currencies.mjs';

const campaignVisible = `NOT EXISTS(SELECT 1 FROM meta_campaigns mc WHERE mc.campaign_id=c.id) OR EXISTS(SELECT 1 FROM meta_campaigns mc JOIN meta_account_selection sel ON sel.account_id=mc.account_id AND sel.project_id=c.project_id WHERE mc.campaign_id=c.id AND sel.enabled=1)`;
export function whatsAppRange(start, end) {
  return {
    lower: `${start}T03:00:00.000Z`,
    upper: new Date(Date.parse(`${end}T03:00:00Z`) + 86400000).toISOString(),
  };
}
export function whatsAppData(db, projectId, start, end) {
  const { lower, upper } = whatsAppRange(start, end);
  const conversations = db
    .prepare(
      'SELECT v.*,ct.stage,ct.name FROM wa_conversations v JOIN wa_contacts ct ON ct.id=v.contact_id WHERE v.project_id=? AND v.started_at>=? AND v.started_at<?',
    )
    .all(projectId, lower, upper);
  const resolved = new Map();
  for (const v of conversations) {
    const key = JSON.stringify([v.ad_reference, v.utm_campaign, v.utm_content, v.utm_term]);
    if (!resolved.has(key)) {
      const ad = resolveAd(db, projectId, v.ad_reference || v.utm_content),
        set = ad || resolveAdset(db, projectId, v.utm_term);
      resolved.set(key, {
        ad_id: ad?.id,
        adset_id: set?.adset_id,
        campaign_id: set?.campaign_id || resolveCampaign(db, projectId, v.utm_campaign)?.id,
      });
    }
    Object.assign(v, resolved.get(key));
  }
  const sales = db
    .prepare(
      `SELECT s.*,${saleCurrency} AS currency,l.contact_id,l.conversation_id,l.method FROM wa_sale_links l JOIN sales s ON s.id=l.sale_id LEFT JOIN campaigns c ON c.id=s.campaign_id WHERE l.project_id=? AND s.project_id=? AND l.contact_id IS NOT NULL AND s.status='approved' AND julianday(s.created_at)<julianday(?) AND (c.id IS NULL OR (${campaignVisible}))`,
    )
    .all(projectId, projectId, upper);
  return { conversations, sales, lower, upper };
}
export function whatsAppMetrics(conversations, sales, spend, start, end) {
  const ids = new Set(conversations.map((v) => v.id)),
    contacts = new Set(conversations.map((v) => v.contact_id));
  const cohort = sales.filter((s) => ids.has(s.conversation_id));
  const buyers = new Set(cohort.map((s) => s.contact_id));
  const converted = new Set(cohort.map((s) => s.conversation_id));
  const period = sales.filter((s) => ids.has(s.conversation_id) && s.day >= start && s.day <= end);
  const stage = (s) =>
    new Set(conversations.filter((v) => v.stage === s).map((v) => v.contact_id)).size;
  return {
    wa_conversations: conversations.length,
    wa_contacts: contacts.size,
    wa_qualified: stage('qualified'),
    wa_negotiating: stage('negotiating'),
    wa_lost: stage('lost'),
    wa_buyers: buyers.size,
    wa_converted: converted.size,
    wa_sales: period.length,
    wa_revenue: money(period.reduce((n, s) => n + s.amount, 0)),
    wa_cost_per_conversation: conversations.length ? spend / conversations.length : null,
    wa_conversion: conversations.length ? (converted.size / conversations.length) * 100 : null,
  };
}
export function whatsAppMetricRows(db, projectId, start, end, level, rows) {
  const { conversations, sales } = whatsAppData(db, projectId, start, end);
  const key = level === 'campaigns' ? 'campaign_id' : level === 'adsets' ? 'adset_id' : 'ad_id';
  return new Map(
    rows.map((r) => [
      r.id,
      whatsAppMetrics(
        conversations.filter((v) => v[key] === r.id),
        sales.filter((s) => s.currency === (r.currency || 'BRL')),
        r.spend,
        start,
        end,
      ),
    ]),
  );
}
export function whatsAppReport(
  db,
  projectId,
  start,
  end,
  { q = '', stage = 'all', page = 1, currency = 'BRL' } = {},
) {
  const { conversations, sales: allSales, lower, upper } = whatsAppData(db, projectId, start, end);
  const sales = allSales.filter((s) => s.currency === currency);
  const contacts = db
    .prepare(
      `SELECT ct.id,ct.wa_id,ct.name,ct.stage,ct.created_at,ct.last_seen FROM wa_contacts ct WHERE ct.project_id=? AND
    (EXISTS(SELECT 1 FROM wa_conversations v JOIN wa_messages m ON m.conversation_id=v.id WHERE v.contact_id=ct.id AND m.direction='inbound' AND m.occurred_at>=? AND m.occurred_at<?)
     OR (ct.created_at>=? AND ct.created_at<? AND NOT EXISTS(SELECT 1 FROM wa_conversations v WHERE v.contact_id=ct.id))
     OR EXISTS(SELECT 1 FROM wa_sale_links l JOIN sales s ON s.id=l.sale_id WHERE l.contact_id=ct.id AND s.status='approved' AND s.day BETWEEN ? AND ?)) ORDER BY ct.last_seen DESC,ct.id`,
    )
    .all(projectId, lower, upper, lower, upper, start, end);
  const inPeriod = sales.filter((s) => s.day >= start && s.day <= end);
  const latest = db
    .prepare(
      'SELECT * FROM wa_conversations WHERE project_id=? AND started_at<? ORDER BY started_at DESC',
    )
    .all(projectId, upper);
  const latestByContact = new Map();
  for (const v of latest)
    if (!latestByContact.has(v.contact_id)) latestByContact.set(v.contact_id, v);
  const rows = contacts.map((c) => {
    const origin = latestByContact.get(c.id);
    const paid = inPeriod.filter((s) => s.contact_id === c.id);
    return {
      ...c,
      conversations: conversations.filter((v) => v.contact_id === c.id).length,
      source: origin?.utm_source || 'manual',
      campaign: origin?.utm_campaign || '',
      ad_reference: origin?.ad_reference || origin?.utm_content || '',
      attribution_method: origin?.attribution_method || 'manual',
      visitor_id: origin?.visitor_id || null,
      sales: paid.length,
      revenue: money(paid.reduce((v, s) => v + s.amount, 0)),
    };
  });
  const filtered = rows.filter(
    (c) =>
      (stage === 'all' || (stage === 'buyers' && c.sales > 0) || c.stage === stage) &&
      `${c.name} ${c.wa_id}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
  );
  const campaigns = db
    .prepare(
      `SELECT c.id FROM campaigns c WHERE c.project_id=? AND (${campaignVisible}) AND ${campaignCurrency}=?`,
    )
    .all(projectId, currency);
  const visible = new Set(campaigns.map((c) => c.id));
  const assigned = conversations.filter((v) => v.campaign_id && visible.has(v.campaign_id));
  const sourceCampaigns = new Set(assigned.map((v) => v.campaign_id));
  let spend = 0;
  for (const id of sourceCampaigns)
    spend += db
      .prepare(
        'SELECT COALESCE(SUM(amount),0) AS spend FROM spend WHERE campaign_id=? AND day BETWEEN ? AND ?',
      )
      .get(id, start, end).spend;
  return {
    currency,
    contacts: filtered.slice((page - 1) * 20, page * 20),
    total: filtered.length,
    page,
    size: 20,
    pipeline: {
      new: rows.filter((c) => c.stage === 'new').length,
      qualified: rows.filter((c) => c.stage === 'qualified').length,
      negotiating: rows.filter((c) => c.stage === 'negotiating').length,
      lost: rows.filter((c) => c.stage === 'lost').length,
      buyers: rows.filter((c) => c.sales > 0).length,
    },
    metrics: {
      ...whatsAppMetrics(conversations, sales, spend, start, end),
      contacts: contacts.length,
      attributed_conversations: assigned.length,
      attributed_spend: money(spend),
      cost_per_conversation: assigned.length ? spend / assigned.length : null,
      revenue: money(inPeriod.reduce((n, s) => n + s.amount, 0)),
      sales: inPeriod.length,
    },
  };
}
export function contactDetails(db, projectId, id) {
  const contact = db
    .prepare(
      'SELECT id,wa_id,name,stage,created_at,last_seen FROM wa_contacts WHERE project_id=? AND id=?',
    )
    .get(projectId, id);
  if (!contact)
    throw Object.assign(new Error('Contato não encontrado nesta operação.'), { status: 404 });
  const conversations = db
    .prepare(
      `SELECT v.*,c.name AS connection_name,(SELECT COUNT(*) FROM wa_messages m WHERE m.conversation_id=v.id AND m.direction='inbound') AS inbound,
    (SELECT COUNT(*) FROM wa_messages m WHERE m.conversation_id=v.id AND m.direction='outbound') AS outbound FROM wa_conversations v JOIN wa_connections c ON c.id=v.connection_id WHERE v.contact_id=? ORDER BY v.started_at DESC LIMIT 100`,
    )
    .all(id);
  const sales = db
    .prepare(
      `SELECT s.id,s.external_id,s.product,s.customer_name,s.amount,${saleCurrency} AS currency,s.status,s.created_at,l.method FROM wa_sale_links l JOIN sales s ON s.id=l.sale_id WHERE l.contact_id=? AND s.project_id=? ORDER BY s.created_at DESC LIMIT 100`,
    )
    .all(id, projectId);
  const history = db
    .prepare(
      'SELECT stage,created_at FROM wa_stage_history WHERE contact_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',
    )
    .all(id);
  return { contact, conversations, sales, history };
}

import { money, summarize } from './domain.mjs';
import { resolveCampaign, resolveAd, resolveAdset } from './attribution.mjs';
import { readFees } from './fees.mjs';

const divide = (a, b, multiplier = 1) => (a != null && b ? (a / b) * multiplier : null);
export function metricValues(sales, spend, impressions, clicks, events = [], meta = [], fees) {
  const unique = (name) =>
    new Set(events.filter((e) => e.event_name === name).map((e) => e.visitor_id)).size;
  const count = (name) => events.filter((e) => e.event_name === name).length;
  const sum = (key) => (meta.length ? meta.reduce((v, m) => v + Number(m[key] || 0), 0) : null);
  const amount = (status) =>
    money(sales.filter((s) => s.status === status).reduce((v, s) => v + s.amount, 0));
  const views = events.filter((e) => e.event_name === 'PageView');
  const visits = unique('PageView');
  const sessions = new Set(views.map((e) => `${e.visitor_id}:${e.session_id || e.visitor_id}`))
    .size;
  // Engagement snapshots are cumulative. Only the highest snapshot per page visit counts.
  const pages = new Map();
  for (const e of events)
    if (e.page_view_id) {
      const page = pages.get(e.page_view_id) || { duration: 0, active: 0, scroll: 0 };
      page.duration = Math.max(page.duration, e.duration_ms || 0);
      page.active = Math.max(page.active, e.active_ms || 0);
      page.scroll = Math.max(page.scroll, e.scroll_depth || 0);
      pages.set(e.page_view_id, page);
    }
  const measured = [...pages.values()];
  const base = summarize(sales, spend, visits, fees);
  const pending = sales.filter((s) => s.status === 'pending').length;
  const refunded = sales.filter((s) => s.status === 'refunded').length;
  const chargebacks = sales.filter((s) => s.status === 'chargeback').length;
  const link = sum('link_clicks'),
    landing = sum('landing_views'),
    checkouts = sum('checkouts');
  return {
    ...base,
    impressions,
    clicks,
    cpa: divide(spend, base.sales),
    roas: divide(base.revenue, spend),
    ticket: divide(base.revenue, base.sales),
    margin: divide(base.profit, base.revenue, 100),
    conversion: divide(base.sales, visits, 100),
    orders: sales.length,
    pending_amount: amount('pending'),
    refunded,
    refunded_amount: amount('refunded'),
    chargebacks,
    chargeback_amount: amount('chargeback'),
    canceled: sales.filter((s) => s.status === 'canceled').length,
    approval_rate: divide(base.sales, sales.length, 100),
    refund_rate: divide(refunded, sales.length, 100),
    roi: divide(base.profit, spend, 100),
    cpc: divide(spend, clicks),
    cpm: divide(spend, impressions, 1000),
    ctr: divide(clicks, impressions, 100),
    link_clicks: link,
    link_ctr: divide(link, impressions, 100),
    link_cpc: divide(spend, link),
    landing_views: landing,
    landing_rate: divide(landing, link, 100),
    landing_cost: divide(spend, landing),
    meta_checkouts: checkouts,
    meta_purchases: sum('meta_purchases'),
    meta_leads: sum('leads'),
    meta_carts: sum('carts'),
    meta_checkout_cost: divide(spend, checkouts),
    page_views: views.length,
    sessions,
    pages_per_session: divide(views.length, sessions),
    view_content: count('ViewContent'),
    carts: unique('AddToCart'),
    checkouts: unique('InitiateCheckout'),
    payment_info: unique('AddPaymentInfo'),
    leads: unique('Lead'),
    contacts: unique('Contact'),
    registrations: unique('CompleteRegistration'),
    whatsapp_clicks: count('WhatsAppClick'),
    form_submits: count('FormSubmit'),
    video_plays: count('VideoPlay'),
    video_completions: count('VideoComplete'),
    checkout_returns: unique('CheckoutReturn'),
    subscriptions: unique('Subscribe'),
    trials: unique('StartTrial'),
    schedules: unique('Schedule'),
    searches: count('Search'),
    wishlist: unique('AddToWishlist'),
    cpl: divide(spend, unique('Lead')),
    checkout_cost: divide(spend, unique('InitiateCheckout')),
    checkout_conversion: divide(base.sales, unique('InitiateCheckout'), 100),
    avg_duration: measured.length
      ? measured.reduce((v, p) => v + p.duration, 0) / measured.length / 1000
      : null,
    avg_active: measured.length
      ? measured.reduce((v, p) => v + p.active, 0) / measured.length / 1000
      : null,
    avg_scroll: measured.length
      ? measured.reduce((v, p) => v + p.scroll, 0) / measured.length
      : null,
    pix_sales: sales.filter((s) => s.status === 'approved' && s.payment_method === 'pix').length,
    card_sales: sales.filter((s) => s.status === 'approved' && s.payment_method === 'credit_card')
      .length,
    boleto_sales: sales.filter((s) => s.status === 'approved' && s.payment_method === 'boleto')
      .length,
    pending,
  };
}

export function analyticsData(db, projectId, start, end) {
  const events = db
    .prepare(
      `SELECT e.*,d.session_id,d.utm_term,d.utm_content,t.page_view_id,t.duration_ms,t.active_ms,t.scroll_depth
    FROM events e LEFT JOIN event_details d ON d.event_id=e.id LEFT JOIN event_engagement t ON t.event_id=e.id
    WHERE e.project_id=? AND e.day BETWEEN ? AND ?`,
    )
    .all(projectId, start, end);
  const cache = new Map();
  for (const event of events) {
    const key = JSON.stringify([event.utm_campaign, event.utm_term, event.utm_content]);
    if (!cache.has(key)) {
      const ad = resolveAd(db, projectId, event.utm_content);
      const set = ad || resolveAdset(db, projectId, event.utm_term);
      cache.set(key, {
        campaign_id: set?.campaign_id || resolveCampaign(db, projectId, event.utm_campaign)?.id,
        adset_id: set?.adset_id,
        ad_id: ad?.id,
      });
    }
    Object.assign(event, cache.get(key));
  }
  const meta = db
    .prepare('SELECT * FROM entity_funnel WHERE project_id=? AND day BETWEEN ? AND ?')
    .all(projectId, start, end);
  return { events, meta };
}

export function enrichRows(db, projectId, start, end, level, rows, sales) {
  const fees = readFees(db, projectId);
  const { events, meta } = analyticsData(db, projectId, start, end);
  const key = level === 'campaigns' ? 'campaign_id' : level === 'adsets' ? 'adset_id' : 'ad_id';
  return rows.map((row) => ({
    ...row,
    ...metricValues(
      sales.filter((s) => s[key] === row.id || (row.external_id && s[key] === row.external_id)),
      row.spend,
      row.impressions,
      row.clicks,
      events.filter((e) => e[key] === row.id),
      meta.filter((m) =>
        level === 'campaigns'
          ? m.level === 'campaign' && m.entity_id === row.id
          : m.level === 'ad' && (level === 'ads' ? m.entity_id === row.id : m.adset_id === row.id),
      ),
      fees,
    ),
  }));
}

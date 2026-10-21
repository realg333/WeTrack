import { summarize, money, ratio } from './domain.mjs';
import { ruleReport } from './rule-model.mjs';
import { enrichRows } from './analytics.mjs';
import { campaignCurrency, saleCurrency } from './currencies.mjs';

export const campaignVisible = `NOT EXISTS (SELECT 1 FROM meta_campaigns mc WHERE mc.campaign_id=c.id) OR EXISTS (SELECT 1 FROM meta_campaigns mc JOIN meta_account_selection sel ON sel.account_id=mc.account_id AND sel.project_id=c.project_id WHERE mc.campaign_id=c.id AND sel.enabled=1)`;
export function visibleCampaigns(db, projectId, currency) {
  return db
    .prepare(
      `SELECT c.*,m.external_id,m.account_id,${campaignCurrency} AS currency FROM campaigns c LEFT JOIN meta_campaigns m ON m.campaign_id=c.id WHERE c.project_id=? AND (${campaignVisible}) ${currency ? `AND ${campaignCurrency}=?` : ''} ORDER BY c.active DESC,c.name`,
    )
    .all(...(currency ? [projectId, currency] : [projectId]));
}
export function reportSales(db, projectId, start, end, currency) {
  return db
    .prepare(
      `SELECT s.*,${saleCurrency} AS currency,sa.visitor_id,sa.adset_id,sa.ad_id,c.name AS campaign_name,
        a.name AS adset_name,ad.name AS ad_name,st.utm_term,st.adset_reference,st.ad_reference,
        ma.updated_at AS attribution_updated_at,
        CASE WHEN ma.sale_id IS NOT NULL THEN 'manual' WHEN s.campaign_id IS NOT NULL THEN 'automatic' ELSE 'unattributed' END AS attribution_method
      FROM sales s LEFT JOIN campaigns c ON c.id=s.campaign_id
      LEFT JOIN sale_attribution sa ON sa.sale_id=s.id
      LEFT JOIN ad_sets a ON a.id=sa.adset_id AND a.campaign_id=s.campaign_id
      LEFT JOIN ads ad ON ad.id=sa.ad_id AND ad.adset_id=a.id
      LEFT JOIN sale_tracking st ON st.sale_id=s.id
      LEFT JOIN manual_sale_attribution ma ON ma.sale_id=s.id
      WHERE s.project_id=? AND s.day BETWEEN ? AND ? AND (c.id IS NULL OR (${campaignVisible})) ${currency ? `AND ${saleCurrency}=?` : ''} ORDER BY s.created_at DESC`,
    )
    .all(...(currency ? [projectId, start, end, currency] : [projectId, start, end]));
}
function spendFor(db, campaignId, start, end) {
  return db
    .prepare(
      'SELECT COALESCE(SUM(amount),0) AS amount,COALESCE(SUM(impressions),0) AS impressions,COALESCE(SUM(clicks),0) AS clicks FROM spend WHERE campaign_id=? AND day BETWEEN ? AND ?',
    )
    .get(campaignId, start, end);
}
export function dashboardReport(db, p, start, end, currency = 'BRL') {
  const rows = reportSales(db, p.id, start, end, currency);
  const campaignRows = visibleCampaigns(db, p.id, currency);
  const campaigns = campaignRows.map((c) => {
    const spent = spendFor(db, c.id, start, end);
    return {
      ...c,
      ...summarize(
        rows.filter((s) => s.campaign_id === c.id),
        spent.amount,
        0,
      ),
      impressions: spent.impressions,
      clicks: spent.clicks,
    };
  });
  const spend = money(campaigns.reduce((v, c) => v + c.spend, 0));
  const visits = db
    .prepare(
      "SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE project_id=? AND day BETWEEN ? AND ? AND event_name='PageView'",
    )
    .get(p.id, start, end).n;
  const metrics = {
    ...summarize(rows, spend, visits),
    impressions: campaigns.reduce((v, c) => v + c.impressions, 0),
    clicks: campaigns.reduce((v, c) => v + c.clicks, 0),
  };
  const daily = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const spending = db
    .prepare(
      `SELECT s.day,SUM(s.amount) AS amount FROM spend s JOIN campaigns c ON c.id=s.campaign_id WHERE c.project_id=? AND (${campaignVisible}) AND s.day BETWEEN ? AND ? AND ${campaignCurrency}=? GROUP BY s.day`,
    )
    .all(p.id, start, end, currency);
  for (
    let n = 0;
    n < 366 && cursor.toISOString().slice(0, 10) <= end;
    n++, cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    daily.push({
      day,
      revenue: money(
        rows
          .filter((s) => s.day === day && s.status === 'approved')
          .reduce((v, s) => v + s.amount, 0),
      ),
      spend: money(spending.find((s) => s.day === day)?.amount || 0),
    });
  }
  const sources = [...new Set(rows.map((s) => s.utm_source))]
    .map((source) => {
      const sales = rows.filter((s) => s.utm_source === source && s.status === 'approved');
      return {
        source,
        sales: sales.length,
        revenue: money(sales.reduce((v, s) => v + s.amount, 0)),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const pages = db
    .prepare(
      "SELECT page_url,COUNT(*) AS views,COUNT(DISTINCT visitor_id) AS visitors FROM events WHERE project_id=? AND day BETWEEN ? AND ? AND event_name='PageView' GROUP BY page_url ORDER BY views DESC LIMIT 20",
    )
    .all(p.id, start, end);
  const rules = ruleReport(db, p.id, campaignRows).filter((r) => r.currency === currency);
  const funnelRows = db
    .prepare(
      `SELECT f.* FROM campaign_funnel f JOIN campaigns c ON c.id=f.campaign_id WHERE c.project_id=? AND c.source='Meta Ads' AND (${campaignVisible}) AND f.day BETWEEN ? AND ? AND ${campaignCurrency}=?`,
    )
    .all(p.id, start, end, currency);
  const metaCampaigns = new Set(campaigns.filter((c) => c.source === 'Meta Ads').map((c) => c.id));
  const metaOrders = rows.filter((s) => metaCampaigns.has(s.campaign_id));
  const counts = db
    .prepare(
      'SELECT event_name,COUNT(DISTINCT visitor_id) AS n FROM events WHERE project_id=? AND day BETWEEN ? AND ? GROUP BY event_name',
    )
    .all(p.id, start, end);
  const count = (name) => counts.find((r) => r.event_name === name)?.n || 0;
  const sum = (key) => funnelRows.reduce((v, r) => v + r[key], 0);
  const sessions = db
    .prepare(
      "SELECT COUNT(DISTINCT COALESCE(NULLIF(d.session_id,''),e.visitor_id)) AS n FROM events e LEFT JOIN event_details d ON d.event_id=e.id WHERE e.project_id=? AND e.day BETWEEN ? AND ? AND e.event_name='PageView'",
    )
    .get(p.id, start, end).n;
  const hours = Array(24).fill(0),
    hourFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  for (const sale of rows)
    if (sale.status === 'approved') hours[Number(hourFormat.format(new Date(sale.created_at)))]++;
  const stages = (values, labels) =>
    values.map((value, i) => ({
      label: labels[i],
      value,
      rate: ratio(value, values[0]) * 100,
      step_rate: i ? ratio(value, values[i - 1]) * 100 : 100,
    }));
  const funnel = {
    meta: stages(
      [
        sum('link_clicks'),
        sum('landing_views'),
        sum('checkouts'),
        metaOrders.length,
        metaOrders.filter((s) => s.status === 'approved').length,
      ],
      [
        'Cliques no link',
        'Visitas na página',
        'Checkout iniciado',
        'Pedidos gerados',
        'Vendas aprovadas',
      ],
    ),
    site: stages(
      [sessions, visits, count('InitiateCheckout'), rows.length, metrics.sales],
      [
        'Sessões no site',
        'Visitantes únicos',
        'Checkout iniciado',
        'Pedidos gerados',
        'Vendas aprovadas',
      ],
    ),
    meta_available: funnelRows.length > 0,
    hourly: hours.map((sales, hour) => ({ hour, sales })),
  };
  return {
    currency,
    metrics,
    daily,
    campaigns,
    sources,
    pages,
    rules,
    sales: rows,
    project: p,
    start,
    end,
    funnel,
  };
}

export function hierarchyReport(db, projectId, start, end, level, parent, currency = 'BRL') {
  const sales = reportSales(db, projectId, start, end, currency);
  if (level === 'campaigns')
    return enrichRows(
      db,
      projectId,
      start,
      end,
      level,
      visibleCampaigns(db, projectId, currency).map((c) => {
        const s = spendFor(db, c.id, start, end);
        return {
          ...c,
          ...summarize(
            sales.filter((r) => r.campaign_id === c.id),
            s.amount,
            0,
          ),
          clicks: s.clicks,
          impressions: s.impressions,
        };
      }),
      sales,
    );
  if (
    level === 'adsets' &&
    parent &&
    !db.prepare('SELECT id FROM campaigns WHERE id=? AND project_id=?').get(parent, projectId)
  )
    throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 });
  if (
    level === 'ads' &&
    parent &&
    !db
      .prepare(
        'SELECT a.id FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id WHERE a.id=? AND c.project_id=?',
      )
      .get(parent, projectId)
  )
    throw Object.assign(new Error('Conjunto não encontrado.'), { status: 404 });
  const rows =
    level === 'adsets'
      ? db
          .prepare(
            `SELECT a.*,c.name AS campaign_name,c.source,m.account_id,${campaignCurrency} AS currency FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id LEFT JOIN meta_campaigns m ON m.campaign_id=c.id WHERE c.project_id=? AND (${campaignVisible}) AND ${campaignCurrency}=? ${parent ? 'AND c.id=?' : ''} ORDER BY a.name`,
          )
          .all(...(parent ? [projectId, currency, parent] : [projectId, currency]))
      : db
          .prepare(
            `SELECT ad.*,a.campaign_id,a.name AS adset_name,c.name AS campaign_name,c.source,m.account_id,0 AS budget,${campaignCurrency} AS currency FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN campaigns c ON c.id=a.campaign_id LEFT JOIN meta_campaigns m ON m.campaign_id=c.id WHERE c.project_id=? AND (${campaignVisible}) AND ${campaignCurrency}=? ${parent ? 'AND a.id=?' : ''} ORDER BY ad.name`,
          )
          .all(...(parent ? [projectId, currency, parent] : [projectId, currency]));
  return enrichRows(
    db,
    projectId,
    start,
    end,
    level,
    rows.map((r) => {
      const amounts =
        level === 'adsets'
          ? db
              .prepare(
                'SELECT COALESCE(SUM(i.amount),0) AS amount,COALESCE(SUM(i.clicks),0) AS clicks,COALESCE(SUM(i.impressions),0) AS impressions FROM ad_insights i JOIN ads ad ON ad.id=i.ad_id WHERE ad.adset_id=? AND i.day BETWEEN ? AND ?',
              )
              .get(r.id, start, end)
          : db
              .prepare(
                'SELECT COALESCE(SUM(amount),0) AS amount,COALESCE(SUM(clicks),0) AS clicks,COALESCE(SUM(impressions),0) AS impressions FROM ad_insights WHERE ad_id=? AND day BETWEEN ? AND ?',
              )
              .get(r.id, start, end);
      const key = level === 'adsets' ? 'adset_id' : 'ad_id';
      const matching = sales.filter(
        (s) => s[key] === r.id || (r.external_id && s[key] === r.external_id),
      );
      return {
        ...r,
        ...summarize(matching, amounts.amount, 0),
        clicks: amounts.clicks,
        impressions: amounts.impressions,
      };
    }),
    sales,
  );
}

export function visitorList(db, projectId, start, end, query = '', page = 1) {
  const q = query.toLowerCase();
  const where =
    'e.project_id=? AND e.day BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM events m WHERE m.project_id=e.project_id AND m.visitor_id=e.visitor_id AND m.day BETWEEN ? AND ? AND (instr(lower(m.visitor_id),?)>0 OR instr(lower(m.page_url),?)>0 OR instr(lower(m.utm_source),?)>0))';
  const params = [projectId, start, end, start, end, q, q, q];
  const total = db
    .prepare(`SELECT COUNT(DISTINCT e.visitor_id) AS n FROM events e WHERE ${where}`)
    .get(...params).n;
  const visitors = db
    .prepare(
      `SELECT e.visitor_id,MIN(e.created_at) AS first_seen,MAX(e.created_at) AS last_seen,COUNT(*) AS events,COUNT(DISTINCT CASE WHEN e.event_name='PageView' THEN e.page_url END) AS pages,COUNT(DISTINCT COALESCE(d.session_id,e.visitor_id)) AS sessions,MAX(CASE WHEN e.event_name='InitiateCheckout' THEN 1 ELSE 0 END) AS checkout, (SELECT x.utm_source FROM events x WHERE x.project_id=e.project_id AND x.visitor_id=e.visitor_id AND x.day BETWEEN ? AND ? ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1) AS source FROM events e LEFT JOIN event_details d ON d.event_id=e.id WHERE ${where} GROUP BY e.visitor_id ORDER BY last_seen DESC,e.visitor_id LIMIT 20 OFFSET ?`,
    )
    .all(start, end, ...params, (page - 1) * 20);
  return { visitors, total, page, size: 20 };
}
export function visitorJourney(db, projectId, visitorId, start, end) {
  const events = db
    .prepare(
      `WITH engagement AS (
        SELECT t.page_view_id,MAX(t.duration_ms) AS duration_ms,MAX(t.active_ms) AS active_ms,MAX(t.scroll_depth) AS scroll_depth
        FROM event_engagement t JOIN events e ON e.id=t.event_id
        WHERE e.project_id=? AND e.visitor_id=? AND e.day BETWEEN ? AND ? GROUP BY t.page_view_id
      )
      SELECT e.id,e.event_name,e.page_url,e.utm_source,e.utm_campaign,e.created_at,d.session_id,d.page_title,d.referrer,d.section,d.target_url,
        s.channel,s.value,s.currency,s.content_id,s.content_name,s.click_ids,
        json_extract(s.first_touch,'$.utm_source') AS first_source,json_extract(s.first_touch,'$.utm_campaign') AS first_campaign,
        t.page_view_id,t.reason,t.away_ms,COALESCE(t.occurred_at,e.created_at) AS occurred_at,
        CASE WHEN e.event_name='PageView' THEN m.duration_ms ELSE t.duration_ms END AS duration_ms,
        CASE WHEN e.event_name='PageView' THEN m.active_ms ELSE t.active_ms END AS active_ms,
        CASE WHEN e.event_name='PageView' THEN m.scroll_depth ELSE t.scroll_depth END AS scroll_depth
      FROM events e LEFT JOIN event_details d ON d.event_id=e.id LEFT JOIN event_engagement t ON t.event_id=e.id LEFT JOIN event_signals s ON s.event_id=e.id
        LEFT JOIN engagement m ON m.page_view_id=t.page_view_id
      WHERE e.project_id=? AND e.visitor_id=? AND e.day BETWEEN ? AND ? AND e.event_name<>'PageEngagement'
      ORDER BY COALESCE(t.occurred_at,e.created_at),e.rowid LIMIT 500`,
    )
    .all(projectId, visitorId, start, end, projectId, visitorId, start, end);
  if (!events.length)
    throw Object.assign(new Error('Visitante não encontrado neste período.'), { status: 404 });
  const sales = reportSales(db, projectId, start, end).filter((s) => s.visitor_id === visitorId);
  return { visitor_id: visitorId, events, sales, limited: events.length === 500 };
}

import { z } from 'zod';
import { dateKey, money } from './domain.mjs';

export const conditionSchema = z
  .object({
    metric: z.enum([
      'spend',
      'sales',
      'cpa',
      'roas',
      'revenue',
      'profit',
      'clicks',
      'impressions',
      'ctr',
      'cpc',
    ]),
    operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
    threshold: z.number().finite().min(-10000000).max(10000000),
  })
  .strict()
  .refine((c) => c.metric === 'profit' || c.threshold >= 0, 'O limite precisa ser positivo.')
  .refine(
    (c) => !['sales', 'clicks', 'impressions'].includes(c.metric) || Number.isInteger(c.threshold),
    'Use um número inteiro para contagens.',
  );
export const ruleSchema = z
  .object({
    project_id: z.string().min(1),
    name: z.string().trim().min(3).max(100),
    action: z
      .enum(['alert', 'pause', 'stop', 'resume', 'increase_budget', 'decrease_budget'])
      .default('alert'),
    conditions: z.array(conditionSchema).max(8).default([]),
    budget_change: z
      .object({
        mode: z.enum(['percent', 'fixed']),
        amount: z.number().finite().positive().max(1000000),
        limit: z.number().finite().positive().max(1000000).nullable(),
      })
      .strict()
      .nullable()
      .default(null),
    notify_push: z.boolean().default(true),
    period: z.enum(['today', 'yesterday', '3d', '7d', '30d']).default('today'),
    campaign_ids: z.array(z.string().min(1).max(100)).max(100).default([]),
    min_spend: z.number().finite().min(0).max(1000000).default(0),
    cooldown_minutes: z.number().int().min(15).max(10080).default(60),
    schedule_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (!r.conditions.length && !r.schedule_time)
      ctx.addIssue({ code: 'custom', message: 'Inclua uma condição ou um horário.' });
    if (r.action === 'alert' && !r.conditions.length)
      ctx.addIssue({ code: 'custom', message: 'Alertas precisam de uma condição.' });
    const scales = r.action === 'increase_budget' || r.action === 'decrease_budget';
    if (scales && !r.budget_change)
      ctx.addIssue({
        code: 'custom',
        path: ['budget_change'],
        message: 'Informe quanto o orçamento deve mudar.',
      });
    if (scales && r.budget_change?.mode === 'percent') {
      const max = r.action === 'decrease_budget' ? 99 : 300;
      if (r.budget_change.amount < 1 || r.budget_change.amount > max)
        ctx.addIssue({
          code: 'custom',
          path: ['budget_change', 'amount'],
          message:
            r.action === 'decrease_budget'
              ? 'A redução percentual fica entre 1% e 99%.'
              : 'O aumento percentual fica entre 1% e 300%.',
        });
    }
    if (r.budget_change)
      for (const key of ['amount', 'limit']) {
        const value = r.budget_change[key];
        if (value != null && Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
          ctx.addIssue({
            code: 'custom',
            path: ['budget_change', key],
            message: 'Use no máximo duas casas decimais.',
          });
      }
  });

export function hydrateRule(row) {
  const config = row.config ? JSON.parse(row.config) : {};
  return {
    ...row,
    config: undefined,
    action: 'alert',
    conditions: [{ metric: row.metric, operator: row.operator, threshold: row.threshold }],
    period: 'today',
    campaign_ids: [],
    min_spend: 0,
    cooldown_minutes: 60,
    schedule_time: null,
    budget_change: null,
    notify_push: true,
    ...config,
  };
}
export function ruleRange(period, clock = new Date()) {
  const end = new Date(`${dateKey(clock)}T12:00:00Z`);
  if (period === 'yesterday') end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - ({ '3d': 3, '7d': 7, '30d': 30 }[period] || 1) + 1);
  return { start: dateKey(start), end: dateKey(end) };
}
export function ruleMetrics(db, campaign, period, clock) {
  const { start, end } = ruleRange(period, clock);
  const spend = db
    .prepare(
      'SELECT COALESCE(SUM(amount),0) AS spend,COALESCE(SUM(clicks),0) AS clicks,COALESCE(SUM(impressions),0) AS impressions FROM spend WHERE campaign_id=? AND day BETWEEN ? AND ?',
    )
    .get(campaign.id, start, end);
  const orders = db
    .prepare(
      "SELECT COUNT(*) AS sales,COALESCE(SUM(amount),0) AS revenue FROM sales WHERE campaign_id=? AND project_id=? AND status='approved' AND day BETWEEN ? AND ?",
    )
    .get(campaign.id, campaign.project_id, start, end);
  return {
    spend: money(spend.spend),
    sales: orders.sales,
    revenue: money(orders.revenue),
    profit: money(orders.revenue - spend.spend),
    clicks: spend.clicks,
    impressions: spend.impressions,
    cpa: orders.sales ? spend.spend / orders.sales : null,
    roas: spend.spend ? orders.revenue / spend.spend : null,
    ctr: spend.impressions ? (spend.clicks / spend.impressions) * 100 : null,
    cpc: spend.clicks ? spend.spend / spend.clicks : null,
  };
}
export function conditionsMatch(rule, metrics) {
  return (
    metrics.spend >= rule.min_spend &&
    rule.conditions.every((c) => {
      const value = metrics[c.metric];
      if (value === null || !Number.isFinite(value)) return false;
      return {
        gt: () => value > c.threshold,
        gte: () => value >= c.threshold,
        lt: () => value < c.threshold,
        lte: () => value <= c.threshold,
        eq: () => Math.abs(value - c.threshold) < 0.000001,
      }[c.operator]();
    })
  );
}
export function nextBudget(current, change, action) {
  if (!change || !(current > 0)) return null;
  const raw =
    change.mode === 'percent'
      ? current * (action === 'increase_budget' ? 1 + change.amount / 100 : 1 - change.amount / 100)
      : action === 'increase_budget'
        ? current + change.amount
        : current - change.amount;
  let next = money(raw);
  if (change.limit != null)
    next = money(
      action === 'increase_budget' ? Math.min(next, change.limit) : Math.max(next, change.limit),
    );
  if (next < 1 || next === current) return null;
  if (action === 'increase_budget' ? next < current : next > current) return null;
  return next;
}
export function scheduleDue(rule, clock) {
  if (!rule.schedule_time) return true;
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(clock);
  const minutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const elapsed = minutes(hour) - minutes(rule.schedule_time);
  return elapsed >= 0 && elapsed < 60;
}
export function configuredRules(db, projectId) {
  return db
    .prepare(
      'SELECT r.*,rc.config FROM rules r LEFT JOIN rule_configs rc ON rc.rule_id=r.id WHERE r.project_id=? ORDER BY r.created_at DESC,r.id',
    )
    .all(projectId)
    .map(hydrateRule);
}
export function ruleTargets(db, rule, campaign) {
  if (rule.campaign_ids.length && !rule.campaign_ids.includes(campaign.id)) return false;
  if (rule.action === 'resume') return !campaign.active;
  if (rule.action === 'increase_budget' || rule.action === 'decrease_budget')
    return Boolean(campaign.active);
  return (
    Boolean(campaign.active) ||
    (rule.action === 'stop' &&
      db.prepare('SELECT mode FROM rule_campaign_state WHERE campaign_id=?').get(campaign.id)
        ?.mode === 'pause')
  );
}
export function ruleReport(db, projectId, campaigns, clock = new Date()) {
  const cache = new Map();
  const metrics = (rule, campaign) => {
    const key = `${rule.period}:${campaign.id}`;
    if (!cache.has(key)) cache.set(key, ruleMetrics(db, campaign, rule.period, clock));
    return cache.get(key);
  };
  return configuredRules(db, projectId).map((r) => ({
    ...r,
    matches: r.active
      ? campaigns
          .filter(
            (c) =>
              ruleTargets(db, r, c) && conditionsMatch(r, metrics(r, c)) && scheduleDue(r, clock),
          )
          .map((c) => c.name)
      : [],
  }));
}

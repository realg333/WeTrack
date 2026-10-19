import { randomUUID } from 'node:crypto';
import { dateKey } from './domain.mjs';
import { visibleCampaigns } from './reporting.mjs';
import {
  configuredRules,
  conditionsMatch,
  ruleMetrics,
  ruleRange,
  ruleSchema,
  scheduleDue,
  ruleTargets,
} from './rule-model.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function createRuleService(db, meta, { clock = () => new Date() } = {}) {
  function parse(input) {
    // Preserve the original alert API for existing clients.
    if (input.metric !== undefined && input.conditions === undefined) {
      const { metric, operator, threshold, ...rest } = input;
      input = { ...rest, conditions: [{ metric, operator, threshold }] };
    }
    const rule = ruleSchema.parse(input);
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(rule.project_id);
    if (!project) throw fail('Operação não encontrada.', 404);
    const campaigns = visibleCampaigns(db, rule.project_id);
    if (rule.campaign_ids.some((id) => !campaigns.some((c) => c.id === id)))
      throw fail('Selecione campanhas disponíveis nesta operação.');
    return { ...rule, active: rule.active ?? rule.action === 'alert' };
  }
  function save(input, ruleId) {
    const rule = parse(input);
    if (
      ruleId &&
      !db.prepare('SELECT id FROM rules WHERE id=? AND project_id=?').get(ruleId, rule.project_id)
    )
      throw fail('Regra não encontrada nesta operação.', 404);
    const id = ruleId || `rule_${randomUUID()}`;
    const first = rule.conditions[0] || { metric: 'spend', operator: 'gte', threshold: 0 };
    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO rules VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,metric=excluded.metric,operator=excluded.operator,threshold=excluded.threshold,active=excluded.active',
      ).run(
        id,
        rule.project_id,
        rule.name,
        first.metric,
        first.operator,
        first.threshold,
        Number(rule.active),
        clock().toISOString(),
      );
      const { project_id, name, active, ...config } = rule;
      db.prepare(
        'INSERT INTO rule_configs VALUES(?,?) ON CONFLICT(rule_id) DO UPDATE SET config=excluded.config',
      ).run(id, JSON.stringify(config));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { id };
  }
  function blocker(rule, campaign, rules, now, { checkCooldown = true } = {}) {
    if (
      checkCooldown &&
      rule.id &&
      db
        .prepare(
          "SELECT 1 FROM rule_runs WHERE rule_id=? AND campaign_id=? AND status IN ('success','error','running') AND created_at>?",
        )
        .get(
          rule.id,
          campaign.id,
          new Date(now.getTime() - rule.cooldown_minutes * 60000).toISOString(),
        )
    )
      return 'Esta regra está no intervalo de segurança após a última tentativa.';
    if (rule.action === 'alert') return null;
    if (!campaign.external_id)
      return 'Campanha local: automações de veiculação exigem uma campanha Meta conectada.';
    if (meta.accountsFor) {
      const account = meta.accountsFor(rule.project_id).find((a) => a.id === campaign.account_id);
      if (!account?.enabled || !account.supported || account.account_status !== 1)
        return 'A conta Meta precisa estar conectada, selecionada, ativa e em BRL.';
    }
    const state = db
      .prepare('SELECT * FROM rule_campaign_state WHERE campaign_id=?')
      .get(campaign.id);
    if (rule.action === 'resume') {
      if (!state || state.mode !== 'pause')
        return state?.mode === 'stop'
          ? 'Corte definitivo: reativação automática bloqueada.'
          : 'Esta campanha não foi pausada pelas regras.';
      if (
        rules.some(
          (r) =>
            r.active &&
            ['pause', 'stop'].includes(r.action) &&
            (!r.campaign_ids.length || r.campaign_ids.includes(campaign.id)) &&
            scheduleDue(r, now) &&
            conditionsMatch(r, ruleMetrics(db, campaign, r.period, now)),
        )
      )
        return 'Uma regra de pausa ou corte ainda está atingida.';
      if (
        rule.schedule_time &&
        db
          .prepare(
            "SELECT 1 FROM rule_runs WHERE rule_id=? AND campaign_id=? AND status='success' AND action='resume' AND created_at>=?",
          )
          .get(rule.id || '', campaign.id, `${dateKey(now)}T03:00:00.000Z`)
      )
        return 'Esta regra já reativou a campanha hoje.';
    }
    if (
      checkCooldown &&
      state &&
      rule.action !== 'stop' &&
      now.getTime() - Date.parse(state.changed_at) < rule.cooldown_minutes * 60000
    )
      return 'Intervalo de segurança entre alterações ainda não terminou.';
    return null;
  }
  function preview(input, ruleId) {
    const rule = parse(input),
      now = clock(),
      rules = configuredRules(db, rule.project_id);
    if (ruleId && !rules.some((r) => r.id === ruleId))
      throw fail('Regra não encontrada nesta operação.', 404);
    const protections = rules.filter((r) => r.id !== ruleId);
    const campaigns = visibleCampaigns(db, rule.project_id).filter(
      (c) => !rule.campaign_ids.length || rule.campaign_ids.includes(c.id),
    );
    return {
      range: ruleRange(rule.period, now),
      last_sync:
        db.prepare('SELECT last_sync FROM meta_connections WHERE project_id=?').get(rule.project_id)
          ?.last_sync || null,
      scheduled_now: scheduleDue(rule, now),
      matches: campaigns.flatMap((c) => {
        if (
          !ruleTargets(db, rule, c) ||
          !conditionsMatch(rule, ruleMetrics(db, c, rule.period, now))
        )
          return [];
        return [
          {
            id: c.id,
            name: c.name,
            metrics: ruleMetrics(db, c, rule.period, now),
            blocked: blocker({ ...rule, id: ruleId }, c, protections, now),
          },
        ];
      }),
    };
  }
  function history(projectId) {
    return db
      .prepare(
        'SELECT * FROM rule_runs WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
      )
      .all(projectId)
      .map((r) => ({ ...r, metrics: JSON.parse(r.metrics) }));
  }
  function log(rule, c, metrics, status, message) {
    const id = randomUUID();
    db.prepare('INSERT INTO rule_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      id,
      rule.project_id,
      rule.id,
      rule.name,
      c.id,
      c.name,
      rule.action,
      status,
      message,
      JSON.stringify(metrics),
      clock().toISOString(),
    );
    return id;
  }
  function skip(rule, campaign, metrics, message) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM rule_runs WHERE rule_id=? AND campaign_id=? AND status='skipped' AND message=? AND created_at>?",
        )
        .get(rule.id, campaign.id, message, new Date(clock().getTime() - 3600000).toISOString())
    )
      log(rule, campaign, metrics, 'skipped', message);
  }
  async function run(projectId, { force = false, deadline = Date.now() + 210000 } = {}) {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!project || project.demo)
      return { skipped: true, reason: 'Demonstração: use a simulação.' };
    const rules = configuredRules(db, projectId).filter((r) => r.active);
    if (!rules.length) return { skipped: true, reason: 'Nenhuma regra ativa.' };
    const stamp = clock().getTime(),
      lease = stamp + 300000;
    db.prepare('INSERT OR IGNORE INTO rule_worker_state(project_id) VALUES(?)').run(projectId);
    const acquired = db
      .prepare(
        'UPDATE rule_worker_state SET lease_until=?,last_attempt=? WHERE project_id=? AND lease_until<=? AND (? OR next_run<=?)',
      )
      .run(lease, clock().toISOString(), projectId, stamp, Number(force), stamp);
    if (!acquired.changes)
      return { skipped: true, reason: 'Execução em andamento ou intervalo de 5 minutos.' };
    let error = null,
      success = 0,
      failures = 0;
    try {
      // Never make a decision using an old cache when synchronization fails.
      if (
        rules.some((r) => r.action !== 'alert') ||
        meta.accountsFor?.(projectId).some((a) => a.enabled && a.supported)
      ) {
        const start = rules.map((r) => ruleRange(r.period, clock()).start).sort()[0];
        await meta.sync(projectId, start, dateKey(clock()));
      }
      db.prepare(
        "UPDATE rule_runs SET status='error',message='Execução anterior interrompida. Confira o estado atual da campanha.' WHERE project_id=? AND status='running'",
      ).run(projectId);
      const priority = { stop: 0, pause: 1, alert: 2, resume: 3 };
      rules.sort((a, b) => priority[a.action] - priority[b.action]);
      for (const rule of rules) {
        if (!scheduleDue(rule, clock())) continue;
        for (const campaign of visibleCampaigns(db, projectId)) {
          if (Date.now() > deadline)
            throw fail(
              'Tempo da execução atingido. As campanhas restantes serão verificadas no próximo ciclo.',
            );
          if (rule.campaign_ids.length && !rule.campaign_ids.includes(campaign.id)) continue;
          const state = db
            .prepare('SELECT * FROM rule_campaign_state WHERE campaign_id=?')
            .get(campaign.id);
          if (
            rule.action === 'resume'
              ? campaign.active
              : !campaign.active && !(rule.action === 'stop' && state?.mode === 'pause')
          )
            continue;
          const metrics = ruleMetrics(db, campaign, rule.period, clock());
          if (!conditionsMatch(rule, metrics)) continue;
          const recent = db
            .prepare(
              "SELECT 1 FROM rule_runs WHERE rule_id=? AND campaign_id=? AND status IN ('success','error','running') AND created_at>?",
            )
            .get(
              rule.id,
              campaign.id,
              new Date(clock().getTime() - rule.cooldown_minutes * 60000).toISOString(),
            );
          if (recent) continue;
          const blocked = blocker(rule, campaign, rules, clock());
          if (blocked) {
            skip(rule, campaign, metrics, blocked);
            continue;
          }
          if (rule.action === 'alert') {
            log(
              rule,
              campaign,
              metrics,
              'success',
              'Limites atingidos. Alerta registrado no painel.',
            );
            success++;
            continue;
          }
          let runId;
          try {
            const before = await meta.management.inspect(projectId, 'campaigns', campaign.id);
            const current = configuredRules(db, projectId).find((r) => r.id === rule.id);
            if (!current?.active || JSON.stringify(current) !== JSON.stringify(rule)) continue;
            if (
              db
                .prepare('SELECT lease_until FROM rule_worker_state WHERE project_id=?')
                .get(projectId)?.lease_until !== lease ||
              clock().getTime() >= lease
            )
              throw fail('A execução perdeu sua reserva. Aguarde o próximo ciclo.');
            if (!before.editable || !['ACTIVE', 'PAUSED'].includes(before.status))
              throw fail('O status atual da Meta não permite esta ação.');
            if (
              rule.action === 'resume'
                ? before.active
                : !before.active && !(rule.action === 'stop' && state?.mode === 'pause')
            )
              continue;
            // Re-read all active protections after asynchronous network calls.
            const protection = blocker(rule, campaign, configuredRules(db, projectId), clock());
            if (protection) {
              skip(rule, campaign, metrics, protection);
              continue;
            }
            runId = log(rule, campaign, metrics, 'running', 'Enviando alteração à Meta.');
            await meta.management.update(
              projectId,
              'campaigns',
              campaign.id,
              { active: rule.action === 'resume', expected_revision: before.revision },
              {
                automated: true,
                guard: () => {
                  const latest = configuredRules(db, projectId);
                  const currentRule = latest.find((r) => r.id === rule.id);
                  if (!currentRule?.active || JSON.stringify(currentRule) !== JSON.stringify(rule))
                    throw fail(
                      'A regra mudou durante a verificação. Aguarde o próximo ciclo.',
                      409,
                    );
                  if (
                    clock().getTime() >= lease ||
                    db
                      .prepare('SELECT lease_until FROM rule_worker_state WHERE project_id=?')
                      .get(projectId)?.lease_until !== lease
                  )
                    throw fail('A reserva da execução expirou.', 409);
                  if (
                    !conditionsMatch(rule, ruleMetrics(db, campaign, rule.period, clock())) ||
                    !scheduleDue(rule, clock())
                  )
                    throw fail(
                      'As condições mudaram durante a verificação. Nenhuma alteração foi enviada.',
                      409,
                    );
                  const blockedNow = blocker(rule, campaign, latest, clock(), {
                    checkCooldown: false,
                  });
                  if (blockedNow) throw fail(blockedNow, 409);
                },
              },
            );
            db.exec('BEGIN');
            try {
              if (rule.action === 'resume')
                db.prepare('DELETE FROM rule_campaign_state WHERE campaign_id=?').run(campaign.id);
              else
                db.prepare(
                  'INSERT INTO rule_campaign_state VALUES(?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET mode=excluded.mode,rule_id=excluded.rule_id,changed_at=excluded.changed_at',
                ).run(campaign.id, rule.action, rule.id, clock().toISOString());
              db.prepare("UPDATE rule_runs SET status='success',message=? WHERE id=?").run(
                rule.action === 'resume'
                  ? 'Reativação confirmada na Meta.'
                  : rule.action === 'stop'
                    ? 'Pausa confirmada na Meta. Reativação automática bloqueada.'
                    : 'Pausa confirmada na Meta.',
                runId,
              );
              db.exec('COMMIT');
            } catch (e) {
              db.exec('ROLLBACK');
              throw e;
            }
            success++;
          } catch (e) {
            const message = e.status
              ? e.message
              : 'Não foi possível confirmar a alteração. Confira a conexão Meta e o estado da campanha.';
            if (runId)
              db.prepare("UPDATE rule_runs SET status='error',message=? WHERE id=?").run(
                message,
                runId,
              );
            else log(rule, campaign, metrics, 'error', message);
            failures++;
          }
        }
      }
      if (failures) error = `${failures} ação(ões) não confirmada(s). Consulte o histórico.`;
    } catch (e) {
      error = e.status
        ? e.message
        : 'A sincronização Meta falhou. Nenhuma decisão adicional foi executada; confira a conexão e tente novamente.';
      failures++;
    } finally {
      db.prepare(
        'UPDATE rule_worker_state SET lease_until=0,next_run=?,last_run=?,last_error=? WHERE project_id=? AND lease_until=?',
      ).run(stamp + 300000, clock().toISOString(), error, projectId, lease);
    }
    return { success, failures, error };
  }
  async function runAll() {
    const deadline = Date.now() + 210000,
      results = [];
    for (const p of db.prepare('SELECT id FROM projects WHERE demo=0').all()) {
      if (Date.now() > deadline) break;
      results.push({ project_id: p.id, ...(await run(p.id, { deadline })) });
    }
    return results;
  }
  return { parse, save, preview, history, run, runAll };
}

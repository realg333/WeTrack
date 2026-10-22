import { randomUUID } from 'node:crypto';
import { dateKey } from './domain.mjs';
import { visibleCampaigns } from './reporting.mjs';
import {
  configuredRules,
  conditionsMatch,
  nextBudget,
  ruleMetrics,
  ruleRange,
  ruleSchema,
  scheduleDue,
  ruleTargets,
} from './rule-model.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const reais = (value, currency = 'BRL') =>
  value.toLocaleString('pt-BR', { style: 'currency', currency });
const budgetAction = (action) => action === 'increase_budget' || action === 'decrease_budget';
export function createRuleService(db, meta, { clock = () => new Date() } = {}) {
  const schedulerKey = 'campaign-rules-scheduler-v1';
  function schedulerRecord() {
    const value = db.prepare('SELECT value FROM settings WHERE key=?').get(schedulerKey)?.value;
    return value ? JSON.parse(value) : {};
  }
  function writeScheduler(value) {
    db.prepare(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(schedulerKey, JSON.stringify(value));
  }
  function schedulerStatus(projectId) {
    const record = schedulerRecord(),
      age = clock().getTime() - Date.parse(record.last_started_at || ''),
      running = record.in_progress === true;
    const activeRules = db
      .prepare(
        'SELECT COUNT(*) AS n FROM rules r JOIN projects p ON p.id=r.project_id WHERE p.demo=0 AND r.active=1 AND (? IS NULL OR r.project_id=?)',
      )
      .get(projectId || null, projectId || null).n;
    return {
      state: !record.last_started_at
        ? 'never'
        : age > 15 * 60000
          ? 'stale'
          : running
            ? 'running'
            : record.last_error
              ? 'error'
              : 'healthy',
      interval_minutes: 5,
      stale_after_minutes: 15,
      active_rules: Number(activeRules),
      last_started_at: record.last_started_at || null,
      last_finished_at: record.last_finished_at || null,
      last_success_at: record.last_success_at || null,
      last_error: record.last_error || null,
      source: record.source || null,
    };
  }
  function parse(input) {
    // Preserve the original alert API for existing clients.
    if (input.metric !== undefined && input.conditions === undefined) {
      const { metric, operator, threshold, ...rest } = input;
      input = { ...rest, conditions: [{ metric, operator, threshold }] };
    }
    const parsed = ruleSchema.safeParse(input);
    if (!parsed.success)
      throw fail(parsed.error.issues[0]?.message || 'Verifique os campos informados.');
    const rule = {
      ...parsed.data,
      budget_change: budgetAction(parsed.data.action) ? parsed.data.budget_change : null,
      notify_push: parsed.data.action === 'alert' && parsed.data.notify_push,
    };
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(rule.project_id);
    if (!project) throw fail('Operação não encontrada.', 404);
    const campaigns = visibleCampaigns(db, rule.project_id, rule.currency);
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
    rules = rules.filter((r) => r.currency === (campaign.currency || 'BRL'));
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
        return 'A conta Meta precisa estar conectada, selecionada, ativa e em BRL ou USD.';
    }
    const state = db
      .prepare('SELECT * FROM rule_campaign_state WHERE campaign_id=?')
      .get(campaign.id);
    if (budgetAction(rule.action) && state?.mode === 'stop')
      return 'Corte definitivo: alteração automática de orçamento bloqueada.';
    if (rule.action === 'increase_budget') {
      const metricsOf = (candidate) => ruleMetrics(db, campaign, candidate.period, now);
      if (
        rules.some(
          (r) =>
            r.id !== rule.id &&
            r.active &&
            ['pause', 'stop', 'decrease_budget'].includes(r.action) &&
            (!r.campaign_ids.length || r.campaign_ids.includes(campaign.id)) &&
            scheduleDue(r, now) &&
            conditionsMatch(r, metricsOf(r)),
        )
      )
        return 'Uma regra de pausa, corte ou redução de orçamento ainda está atingida.';
    }
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
    const campaigns = visibleCampaigns(db, rule.project_id, rule.currency).filter(
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
            budget: c.budget,
            proposal: budgetAction(rule.action)
              ? nextBudget(c.budget, rule.budget_change, rule.action)
              : null,
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
      JSON.stringify({ ...metrics, currency: rule.currency || 'BRL' }),
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
      const priority = {
        stop: 0,
        pause: 1,
        decrease_budget: 2,
        alert: 3,
        increase_budget: 4,
        resume: 5,
      };
      rules.sort((a, b) => priority[a.action] - priority[b.action]);
      for (const rule of rules) {
        if (!scheduleDue(rule, clock())) continue;
        for (const campaign of visibleCampaigns(db, projectId, rule.currency)) {
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
              rule.notify_push
                ? 'Limites atingidos. Alerta no painel; notificação push reservada para o app.'
                : 'Limites atingidos. Alerta registrado no painel.',
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
            let updateInput = {
              active: rule.action === 'resume',
              expected_revision: before.revision,
            };
            let successMessage =
              rule.action === 'resume'
                ? 'Reativação confirmada na Meta.'
                : rule.action === 'stop'
                  ? 'Pausa confirmada na Meta. Reativação automática bloqueada.'
                  : 'Pausa confirmada na Meta.';
            if (budgetAction(rule.action)) {
              // ponytail: orçamento só no nível da campanha (CBO). ABO exige regra por conjunto.
              if (!before.can_edit_budget) {
                skip(
                  rule,
                  campaign,
                  metrics,
                  'O orçamento desta campanha fica no conjunto. A regra só altera campanha com orçamento próprio.',
                );
                continue;
              }
              const next = nextBudget(before.budget, rule.budget_change, rule.action);
              if (next == null) {
                skip(
                  rule,
                  campaign,
                  metrics,
                  'O orçamento já está no limite desta regra ou ficaria abaixo de R$ 1,00.',
                );
                continue;
              }
              updateInput = { budget: next, expected_revision: before.revision };
              successMessage = `Orçamento confirmado na Meta: ${reais(before.budget, before.currency)} para ${reais(next, before.currency)}.`;
            }
            runId = log(rule, campaign, metrics, 'running', 'Enviando alteração à Meta.');
            await meta.management.update(projectId, 'campaigns', campaign.id, updateInput, {
              automated: true,
              guard: () => {
                const latest = configuredRules(db, projectId);
                const currentRule = latest.find((r) => r.id === rule.id);
                if (!currentRule?.active || JSON.stringify(currentRule) !== JSON.stringify(rule))
                  throw fail('A regra mudou durante a verificação. Aguarde o próximo ciclo.', 409);
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
            });
            db.exec('BEGIN');
            try {
              if (rule.action === 'resume')
                db.prepare('DELETE FROM rule_campaign_state WHERE campaign_id=?').run(campaign.id);
              else if (rule.action === 'pause' || rule.action === 'stop')
                db.prepare(
                  'INSERT INTO rule_campaign_state VALUES(?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET mode=excluded.mode,rule_id=excluded.rule_id,changed_at=excluded.changed_at',
                ).run(campaign.id, rule.action, rule.id, clock().toISOString());
              db.prepare("UPDATE rule_runs SET status='success',message=? WHERE id=?").run(
                successMessage,
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
      if (Date.now() > deadline) {
        results.push({
          project_id: p.id,
          failures: 1,
          error: 'Tempo da execução atingido antes de verificar esta operação.',
        });
        continue;
      }
      results.push({ project_id: p.id, ...(await run(p.id, { deadline })) });
    }
    return results;
  }
  async function runScheduled({ source = 'external' } = {}) {
    if (!['github-actions', 'external', 'standalone'].includes(source))
      throw fail('Origem do agendador inválida.');
    const runId = randomUUID();
    writeScheduler({
      ...schedulerRecord(),
      run_id: runId,
      source,
      last_started_at: clock().toISOString(),
      in_progress: true,
    });
    let error = null;
    try {
      const results = await runAll(),
        ok = !results.some((r) => r.failures);
      if (!ok) error = 'Uma ou mais operações falharam. Consulte o histórico das regras.';
      return { ok, results };
    } catch (e) {
      error = 'Não foi possível concluir a verificação. Confira o banco e a conexão Meta.';
      throw e;
    } finally {
      const latest = schedulerRecord();
      // A concurrent HTTP/standalone trigger may have started a newer cycle.
      if (latest.run_id === runId)
        writeScheduler({
          ...latest,
          in_progress: false,
          last_finished_at: clock().toISOString(),
          last_success_at: error ? latest.last_success_at || null : clock().toISOString(),
          last_error: error,
        });
    }
  }
  return { parse, save, preview, history, run, runAll, runScheduled, schedulerStatus };
}

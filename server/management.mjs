import { createHash } from 'node:crypto';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const accountNumber = (value) => String(value || '').replace(/^act_/, '');
const cents = (value) => {
  const n = Number(value || 0);
  if (!Number.isSafeInteger(n) || n < 0) throw fail('Orçamento inesperado recebido da Meta.', 502);
  return n;
};

export function createMetaManagement(db, graph, accountsFor, decryptToken) {
  const pending = new Set();
  function context(project, level, id) {
    const row =
      level === 'campaigns'
        ? db
            .prepare(
              'SELECT c.id,c.project_id,m.external_id,m.account_id FROM campaigns c JOIN meta_campaigns m ON m.campaign_id=c.id WHERE c.id=? AND c.project_id=?',
            )
            .get(id, project)
        : level === 'adsets'
          ? db
              .prepare(
                'SELECT a.id,a.external_id,c.project_id,m.account_id,m.external_id AS campaign_external_id FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id JOIN meta_campaigns m ON m.campaign_id=c.id WHERE a.id=? AND c.project_id=?',
              )
              .get(id, project)
          : level === 'ads'
            ? db
                .prepare(
                  'SELECT ad.id,ad.external_id,c.project_id,m.account_id,m.external_id AS campaign_external_id,a.external_id AS adset_external_id FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN campaigns c ON c.id=a.campaign_id JOIN meta_campaigns m ON m.campaign_id=c.id WHERE ad.id=? AND c.project_id=?',
                )
                .get(id, project)
            : null;
    if (!row || !/^\d+$/.test(row.external_id || ''))
      throw fail('Item Meta não encontrado nesta operação.', 404);
    const account = accountsFor(project).find((a) => a.id === row.account_id);
    if (!account?.enabled || !account.supported)
      throw fail('Ative a conta de anúncios em BRL ou USD nesta operação antes de editar.', 403);
    if (account.account_status !== 1)
      throw fail('A conta de anúncios precisa estar ativa na Meta.', 403);
    const connection = db
      .prepare('SELECT token_cipher FROM meta_connections WHERE project_id=?')
      .get(project);
    if (!connection) throw fail('Conecte novamente seu perfil em Integrações.', 403);
    return {
      ...row,
      level,
      account_name: account.name,
      currency: account.currency,
      cipher: connection.token_cipher,
      token: decryptToken(connection.token_cipher),
    };
  }
  async function snapshot(ctx) {
    const budgetFields = ctx.level === 'ads' ? '' : ',daily_budget,lifetime_budget';
    const parentFields =
      ctx.level === 'campaigns'
        ? ''
        : ctx.level === 'adsets'
          ? ',campaign_id'
          : ',campaign_id,adset_id';
    const entity = await graph(ctx.external_id, ctx.token, {
      fields: `id,account_id,name,status,effective_status${budgetFields}${parentFields}`,
    });
    if (
      String(entity.id) !== ctx.external_id ||
      accountNumber(entity.account_id) !== accountNumber(ctx.account_id)
    )
      throw fail('A Meta retornou um item de outra conta. Sincronize a operação.', 409);
    if (
      (ctx.campaign_external_id && String(entity.campaign_id) !== ctx.campaign_external_id) ||
      (ctx.adset_external_id && String(entity.adset_id) !== ctx.adset_external_id)
    )
      throw fail('A estrutura do item mudou na Meta. Sincronize antes de editar.', 409);
    if (!entity.name || !entity.status || !entity.effective_status)
      throw fail('Resposta incompleta da Meta.', 502);
    let daily = cents(entity.daily_budget),
      lifetime = cents(entity.lifetime_budget),
      parentBudget = '';
    if (ctx.level === 'adsets') {
      const parent = await graph(ctx.campaign_external_id, ctx.token, {
        fields: 'id,account_id,daily_budget,lifetime_budget',
      });
      if (
        String(parent.id) !== ctx.campaign_external_id ||
        accountNumber(parent.account_id) !== accountNumber(ctx.account_id)
      )
        throw fail('Não foi possível confirmar a campanha deste conjunto.', 409);
      parentBudget = `${cents(parent.daily_budget)}:${cents(parent.lifetime_budget)}`;
      if (cents(parent.daily_budget) || cents(parent.lifetime_budget)) {
        daily = 0;
        lifetime = 0;
      }
    }
    const budget_type =
      ctx.level === 'ads' ? 'none' : daily ? 'daily' : lifetime ? 'lifetime' : 'inherited';
    const editable = !['ARCHIVED', 'DELETED'].includes(entity.status);
    const view = {
      id: ctx.id,
      external_id: ctx.external_id,
      level: ctx.level,
      account_id: ctx.account_id,
      account_name: ctx.account_name,
      currency: ctx.currency,
      name: entity.name,
      status: entity.status,
      effective_status: entity.effective_status,
      active: entity.status === 'ACTIVE',
      editable,
      budget_type,
      budget: (daily || lifetime) / 100,
      can_edit_budget: editable && ['daily', 'lifetime'].includes(budget_type),
    };
    return {
      ...view,
      revision: createHash('sha256')
        .update(JSON.stringify([view, parentBudget]))
        .digest('hex'),
    };
  }
  async function inspect(project, level, id) {
    return snapshot(context(project, level, id));
  }
  async function update(project, level, id, input, { automated = false, guard } = {}) {
    const lock = `${project}:${level}:${id}`;
    if (pending.has(lock)) throw fail('Há uma alteração em andamento para este item.', 409);
    pending.add(lock);
    try {
      const ctx = context(project, level, id),
        before = await snapshot(ctx);
      if (!before.editable) throw fail('Itens arquivados ou excluídos não podem ser editados.');
      if (input.expected_revision !== before.revision)
        throw fail(
          'Este item mudou na Meta. Reabra a edição para conferir os valores atuais.',
          409,
        );
      const params = {};
      if (input.name !== undefined && input.name !== before.name) params.name = input.name;
      if (input.active !== undefined && input.active !== before.active)
        params.status = input.active ? 'ACTIVE' : 'PAUSED';
      if (input.budget !== undefined) {
        if (!before.can_edit_budget)
          throw fail(
            'O orçamento é controlado em outro nível. Edite a campanha ou o conjunto que possui o orçamento.',
          );
        const amount = Math.round(input.budget * 100);
        if (
          !Number.isSafeInteger(amount) ||
          amount <= 0 ||
          amount > 100000000 ||
          Math.abs(input.budget * 100 - amount) > 0.000001
        )
          throw fail(
            `Informe um orçamento positivo, em ${before.currency}, com até duas casas decimais.`,
          );
        if (input.budget !== before.budget)
          params[before.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget'] = amount;
      }
      guard?.();
      if (!Object.keys(params).length) {
        if (!automated && level === 'campaigns' && input.active !== undefined)
          db.prepare('DELETE FROM rule_campaign_state WHERE campaign_id=?').run(id);
        return { ok: true, local_only: false, confirmed: true, unchanged: true, entity: before };
      }
      // Recheck selection and credentials immediately before the external write.
      if (context(project, level, id).cipher !== ctx.cipher)
        throw fail('A conexão mudou. Reabra a edição.', 409);
      try {
        const result = await graph(ctx.external_id, ctx.token, params, 'POST');
        if (result.success !== true)
          throw fail('A Meta não confirmou o recebimento da alteração.', 502);
      } catch (e) {
        if (e.status === 502)
          throw fail(
            `${e.message} A alteração não foi confirmada. Confira ads_management e o acesso à conta.`,
            502,
          );
        throw fail(
          'A comunicação foi interrompida durante o envio. Confira os valores atuais na Meta antes de tentar novamente.',
          409,
        );
      }
      let after;
      try {
        after = await snapshot(ctx);
      } catch {
        throw fail(
          'A Meta aceitou o pedido, mas não foi possível consultar o resultado. Atualize o item antes de repetir.',
          409,
        );
      }
      const matches =
        (!params.name || after.name === params.name) &&
        (!params.status || after.status === params.status) &&
        (params.daily_budget === undefined ||
          (after.budget_type === 'daily' &&
            Math.round(after.budget * 100) === params.daily_budget)) &&
        (params.lifetime_budget === undefined ||
          (after.budget_type === 'lifetime' &&
            Math.round(after.budget * 100) === params.lifetime_budget));
      if (!matches)
        throw fail(
          'Pedido recebido pela Meta; a consulta ainda não confirmou todos os valores. Atualize o item antes de repetir.',
          409,
        );
      const table = { campaigns: 'campaigns', adsets: 'ad_sets', ads: 'ads' }[level];
      db.prepare(
        `UPDATE ${table} SET name=?,active=?${level === 'ads' ? '' : ',budget=?'} WHERE id=?`,
      ).run(
        after.name,
        Number(after.active),
        ...(level === 'ads' ? [] : [after.budget_type === 'daily' ? after.budget : 0]),
        id,
      );
      if (!automated && level === 'campaigns' && input.active !== undefined)
        db.prepare('DELETE FROM rule_campaign_state WHERE campaign_id=?').run(id);
      return { ok: true, local_only: false, confirmed: true, entity: after };
    } finally {
      pending.delete(lock);
    }
  }
  return { inspect, update };
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bell,
  CirclePlus,
  Clock3,
  FlaskConical,
  Pencil,
  Play,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { Badge, Empty, Modal, Spinner, Toggle } from './components';
import { api, brl, dateTime, decimal, mutate } from './lib';
import type { Rule, RuleCondition, Toast } from './types';

const metrics: Record<string, string> = {
  cpa: 'CPA',
  spend: 'Investimento',
  sales: 'Vendas aprovadas',
  roas: 'ROAS',
  revenue: 'Faturamento',
  profit: 'Lucro',
  clicks: 'Cliques',
  impressions: 'Impressões',
  ctr: 'CTR (%)',
  cpc: 'CPC',
};
const operators: Record<string, string> = {
  gt: 'Maior que',
  gte: 'Maior ou igual a',
  lt: 'Menor que',
  lte: 'Menor ou igual a',
  eq: 'Igual a',
};
const actions = {
  alert: 'Alertar',
  pause: 'Pausar campanha',
  stop: 'Corte definitivo',
  resume: 'Religar campanha',
};
const periods = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '3d': 'Últimos 3 dias',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
};
type Draft = Pick<
  Rule,
  | 'name'
  | 'action'
  | 'conditions'
  | 'period'
  | 'campaign_ids'
  | 'min_spend'
  | 'cooldown_minutes'
  | 'schedule_time'
> & { active: boolean };
type Run = {
  id: string;
  rule_name: string;
  campaign_name: string;
  action: keyof typeof actions;
  status: string;
  message: string;
  created_at: string;
  metrics: Record<string, number | null>;
};
type Payload = {
  rules: Rule[];
  campaigns: { id: string; name: string; external_id: string | null }[];
  history: Run[];
  worker: {
    last_run: string | null;
    last_attempt: string | null;
    last_error: string | null;
  } | null;
};
type Preview = {
  range: { start: string; end: string };
  last_sync: string | null;
  scheduled_now: boolean;
  matches: {
    id: string;
    name: string;
    blocked: string | null;
    metrics: Record<string, number | null>;
  }[];
};
const blank = (): Draft => ({
  name: '',
  action: 'alert',
  conditions: [{ metric: 'cpa', operator: 'gt', threshold: 25 }],
  period: 'today',
  campaign_ids: [],
  min_spend: 0,
  cooldown_minutes: 60,
  schedule_time: null,
  active: true,
});
const templates: Record<string, { label: string; draft: Partial<Draft> }> = {
  custom: { label: 'Personalizada', draft: {} },
  stop: {
    label: 'Gasto alto com poucas vendas',
    draft: {
      name: 'Cortar campanhas sem retorno',
      action: 'stop',
      conditions: [
        { metric: 'spend', operator: 'gt', threshold: 100 },
        { metric: 'sales', operator: 'lt', threshold: 2 },
      ],
    },
  },
  zero: {
    label: 'Gasto sem nenhuma venda',
    draft: {
      name: 'Pausar campanhas sem vendas',
      action: 'pause',
      conditions: [
        { metric: 'spend', operator: 'gte', threshold: 50 },
        { metric: 'sales', operator: 'eq', threshold: 0 },
      ],
    },
  },
  cpa: {
    label: 'CPA acima da meta',
    draft: {
      name: 'Pausar CPA acima da meta',
      action: 'pause',
      min_spend: 100,
      conditions: [
        { metric: 'cpa', operator: 'gt', threshold: 40 },
        { metric: 'sales', operator: 'gte', threshold: 3 },
      ],
    },
  },
  roas: {
    label: 'ROAS abaixo do mínimo',
    draft: {
      name: 'Pausar ROAS baixo',
      action: 'pause',
      min_spend: 100,
      conditions: [{ metric: 'roas', operator: 'lt', threshold: 1 }],
    },
  },
  resume: {
    label: 'Religar pausadas pela manhã',
    draft: {
      name: 'Retomar campanhas às 07h',
      action: 'resume',
      schedule_time: '07:00',
      conditions: [],
    },
  },
  winner: {
    label: 'Encontrar campanhas vencedoras',
    draft: {
      name: 'Avisar sobre campanhas para escalar',
      action: 'alert',
      min_spend: 100,
      conditions: [
        { metric: 'roas', operator: 'gte', threshold: 3 },
        { metric: 'sales', operator: 'gte', threshold: 5 },
      ],
    },
  },
};
function valueText(c: RuleCondition) {
  if (['sales', 'clicks', 'impressions'].includes(c.metric)) return String(c.threshold);
  if (c.metric === 'roas') return `${decimal(c.threshold)}x`;
  if (c.metric === 'ctr') return `${decimal(c.threshold)}%`;
  return brl(c.threshold);
}
export default function RulesPage({
  project,
  creating,
  onClose,
  notify,
  onDataChange,
}: {
  project: string;
  creating: boolean;
  onClose: () => void;
  notify: Toast;
  onDataChange: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Rule | null>(null);
  const [localCreating, setLocalCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [template, setTemplate] = useState('custom');
  const [scope, setScope] = useState('all');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [formError, setFormError] = useState('');
  const form = useRef<HTMLFormElement>(null),
    revision = useRef(0);
  const load = useCallback(async () => {
    try {
      setData(await api<Payload>(`/rules?project=${encodeURIComponent(project)}`));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (creating) {
      setEditing(null);
      setDraft(blank());
      setScope('all');
      setTemplate('custom');
      setPreview(null);
      setFormError('');
      revision.current++;
    }
  }, [creating]);
  const change = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setPreview(null);
    setFormError('');
    revision.current++;
  };
  const editCondition = (index: number, patch: Partial<RuleCondition>) =>
    change({ conditions: draft.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const close = () => {
    if (!saving) {
      setEditing(null);
      setLocalCreating(false);
      onClose();
    }
  };
  const payload = () => ({
    ...draft,
    project_id: project,
    campaign_ids: scope === 'all' ? [] : draft.campaign_ids,
  });
  async function simulate() {
    if (!form.current?.reportValidity()) return;
    if (scope === 'selected' && !draft.campaign_ids.length) {
      setFormError('Selecione pelo menos uma campanha.');
      return;
    }
    const version = revision.current;
    setPreviewing(true);
    setFormError('');
    try {
      const result = await mutate<Preview>('/rules/preview', 'POST', {
        ...payload(),
        ...(editing?.id ? { rule_id: editing.id } : {}),
      });
      if (version === revision.current) setPreview(result);
    } catch (e) {
      if (version === revision.current) setFormError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (scope === 'selected' && !draft.campaign_ids.length) {
      setFormError('Selecione pelo menos uma campanha.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await mutate(
        editing ? `/rules/${editing.id}` : '/rules',
        editing ? 'PUT' : 'POST',
        payload(),
      );
      setEditing(null);
      setLocalCreating(false);
      onClose();
      await load();
      onDataChange();
      notify(
        draft.active
          ? 'Regra salva e ativada.'
          : 'Regra salva desativada. Ative quando estiver pronta.',
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rules-page">
      <div className="inline-notice">
        <ShieldCheck size={18} />
        <span>
          Condições combinadas por campanha. Gastos da Meta e vendas aprovadas atribuídas na
          WeTrack, no período de cada regra. Cortes têm prioridade sobre reativações.
        </span>
      </div>
      <section className="panel rules-worker">
        <div>
          <strong>
            <Clock3 size={16} /> Verificação automática a cada 5 minutos
          </strong>
          <p>
            Funciona com o painel fechado. O agendador pode atrasar; o limite de gasto não é um teto
            instantâneo.
          </p>
          <small>
            {data?.worker?.last_run
              ? `Última verificação: ${dateTime(data.worker.last_run)}`
              : 'Aguardando a primeira verificação de regras ativas.'}
          </small>
        </div>
        <button
          className="button secondary"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              const result = await mutate<{
                success?: number;
                failures?: number;
                error?: string;
                reason?: string;
              }>('/rules/run', 'POST', { project_id: project });
              await load();
              onDataChange();
              notify(
                result.error || result.reason || `${result.success || 0} ação(ões) concluída(s).`,
                Boolean(result.failures),
              );
            } catch (e) {
              notify((e as Error).message, true);
            } finally {
              setRunning(false);
            }
          }}
        >
          {running ? <Spinner /> : <Play size={15} />}Verificar agora
        </button>
      </section>
      {data?.worker?.last_error && data.rules.some((r) => r.active) && (
        <p className="rules-error" role="alert">
          {data.worker.last_error}
        </p>
      )}
      {error && (
        <p className="rules-error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </p>
      )}
      {!data && !error && <Spinner />}
      <div className="rule-grid">
        {data?.rules.map((r) => (
          <section className="panel rule-card" key={r.id}>
            <div className="rule-top">
              <span className="rule-icon">
                {r.action === 'alert' ? <Bell size={20} /> : <Zap size={20} />}
              </span>
              <Toggle
                label={`Ativar ${r.name}`}
                checked={Boolean(r.active)}
                disabled={pending === r.id}
                onChange={async () => {
                  setPending(r.id);
                  try {
                    await mutate(`/rules/${r.id}`, 'PATCH', {
                      project_id: project,
                      active: !r.active,
                    });
                    await load();
                    onDataChange();
                  } catch (e) {
                    notify((e as Error).message, true);
                  } finally {
                    setPending(null);
                  }
                }}
              />
            </div>
            <Badge tone={!r.active ? 'neutral' : r.action === 'resume' ? 'green' : 'amber'}>
              {actions[r.action]} · {r.active ? 'Ativa' : 'Desativada'}
            </Badge>
            <h3>{r.name}</h3>
            <ul className="rule-conditions">
              {r.conditions.map((c, i) => (
                <li key={i}>
                  {i > 0 && <small>E </small>}
                  {metrics[c.metric]}{' '}
                  <b>
                    {operators[c.operator].toLowerCase()} {valueText(c)}
                  </b>
                </li>
              ))}
            </ul>
            <p>
              {periods[r.period]} ·{' '}
              {r.campaign_ids.length
                ? `${r.campaign_ids.length} campanha(s) selecionada(s)`
                : 'Todas as campanhas'}
              {r.schedule_time && ` · Às ${r.schedule_time} (Brasília)`}
            </p>
            <p>
              Gasto mínimo: {brl(r.min_spend)} · Intervalo: {r.cooldown_minutes} min
            </p>
            {r.action === 'stop' && (
              <p>
                Bloqueia a reativação por outras regras. Para retomar, ative manualmente na gestão
                Meta.
              </p>
            )}
            <div className="rule-result">
              <Badge tone={r.matches.length ? 'amber' : 'neutral'}>
                {!r.active
                  ? 'Regra desativada'
                  : r.matches.length
                    ? `${r.matches.length} campanha(s) atingem as condições`
                    : 'Nenhuma campanha nas condições'}
              </Badge>
            </div>
            {!!r.matches.length && <p className="rule-matches">{r.matches.join(' · ')}</p>}
            <div className="rule-footer">
              <button
                className="text-button"
                disabled={pending === r.id}
                onClick={() => {
                  setEditing(r);
                  setDraft({
                    name: r.name,
                    action: r.action,
                    conditions: r.conditions,
                    period: r.period,
                    campaign_ids: r.campaign_ids,
                    min_spend: r.min_spend,
                    cooldown_minutes: r.cooldown_minutes,
                    schedule_time: r.schedule_time,
                    active: Boolean(r.active),
                  });
                  setScope(r.campaign_ids.length ? 'selected' : 'all');
                  setTemplate('custom');
                  setPreview(null);
                  setFormError('');
                  revision.current++;
                }}
              >
                <Pencil size={14} />
                Editar / simular
              </button>
              <button
                className="text-button text-red"
                disabled={pending === r.id}
                onClick={async () => {
                  setPending(r.id);
                  try {
                    await mutate(`/rules/${r.id}?project=${encodeURIComponent(project)}`, 'DELETE');
                    await load();
                    onDataChange();
                    notify('Regra excluída. As campanhas mantêm seu estado atual.');
                  } catch (e) {
                    notify((e as Error).message, true);
                  } finally {
                    setPending(null);
                  }
                }}
              >
                <Trash2 size={14} />
                Excluir
              </button>
            </div>
          </section>
        ))}
        <button
          className="add-rule"
          onClick={() => {
            setEditing(null);
            setDraft(blank());
            setScope('all');
            setTemplate('custom');
            setPreview(null);
            setFormError('');
            setLocalCreating(true);
            revision.current++;
          }}
        >
          <CirclePlus size={26} />
          <strong>Criar uma regra</strong>
          <span>Proteja o orçamento e acompanhe oportunidades.</span>
        </button>
      </div>
      <section className="panel rule-history">
        <div className="panel-heading">
          <div>
            <h2>Histórico de execuções</h2>
            <p>Até 100 registros recentes, incluindo falhas e ações bloqueadas.</p>
          </div>
        </div>
        {data?.history.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Regra / campanha</th>
                  <th>Ação</th>
                  <th>Resultado</th>
                  <th>Indicadores</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.created_at)}</td>
                    <td>
                      <strong>{r.rule_name}</strong>
                      <small>{r.campaign_name}</small>
                    </td>
                    <td>{actions[r.action]}</td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'success'
                            ? 'green'
                            : r.status === 'error'
                              ? 'red'
                              : 'neutral'
                        }
                      >
                        {{
                          success: 'Concluída',
                          error: 'Falha',
                          skipped: 'Bloqueada',
                          running: 'Em andamento',
                        }[r.status] || r.status}
                      </Badge>
                      <small>{r.message}</small>
                    </td>
                    <td>
                      {brl(r.metrics.spend || 0)}
                      <small>
                        {r.metrics.sales || 0} venda(s) · ROAS{' '}
                        {r.metrics.roas == null ? '—' : `${decimal(r.metrics.roas)}x`}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Clock3 size={24} />}
            title="Nenhuma execução registrada"
            text="As decisões das regras aparecerão aqui. Simulações não alteram campanhas."
          />
        )}
      </section>
      {(creating || localCreating || editing) && (
        <Modal
          wide
          title={editing?.id ? 'Editar regra' : 'Criar regra'}
          subtitle="Defina quando agir e confira as campanhas na simulação."
          onClose={close}
        >
          <form ref={form} onSubmit={(e) => void save(e)} className="rule-editor">
            <label>
              Modelo
              <select
                value={template}
                onChange={(e) => {
                  const key = e.target.value;
                  setTemplate(key);
                  const preset = templates[key].draft;
                  change({ ...blank(), ...preset, active: (preset.action || 'alert') === 'alert' });
                  setScope('all');
                }}
              >
                {Object.entries(templates).map(([key, t]) => (
                  <option key={key} value={key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome da regra
              <input
                required
                minLength={3}
                maxLength={100}
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
                placeholder="Ex.: Cortar gasto alto com poucas vendas"
              />
            </label>
            <div className="form-grid">
              <label>
                Ação
                <select
                  value={draft.action}
                  onChange={(e) =>
                    change({ action: e.target.value as Draft['action'], active: false })
                  }
                >
                  {Object.entries(actions).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Período de análise
                <select
                  value={draft.period}
                  onChange={(e) => change({ period: e.target.value as Draft['period'] })}
                >
                  {Object.entries(periods).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="rule-explanation">
              {draft.action === 'alert'
                ? 'Registra um alerta no painel quando as condições forem atingidas.'
                : draft.action === 'stop'
                  ? 'Pausa na Meta e bloqueia qualquer reativação automática. A campanha continua disponível para ativação manual. Desativar ou excluir a regra não religa a campanha.'
                  : draft.action === 'pause'
                    ? 'Pausa campanhas ativas na Meta. Outra regra poderá religá-las depois do intervalo de segurança.'
                    : 'Religa somente campanhas pausadas pelas regras. Pausas manuais e cortes definitivos ficam protegidos. Uma condição de pausa ainda atingida impede a reativação.'}
            </div>
            <fieldset className="rule-fieldset">
              <legend>Quando todas as condições forem verdadeiras</legend>
              {draft.conditions.map((c, i) => (
                <div className="rule-condition-row" key={i}>
                  <label>
                    Indicador{draft.conditions.length > 1 ? ` ${i + 1}` : ''}
                    <select
                      value={c.metric}
                      onChange={(e) =>
                        editCondition(i, {
                          metric: e.target.value,
                          threshold: ['sales', 'clicks', 'impressions'].includes(e.target.value)
                            ? Math.max(0, Math.round(c.threshold))
                            : c.threshold,
                        })
                      }
                    >
                      {Object.entries(metrics).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Condição{draft.conditions.length > 1 ? ` ${i + 1}` : ''}
                    <select
                      value={c.operator}
                      onChange={(e) => editCondition(i, { operator: e.target.value })}
                    >
                      {Object.entries(operators).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Valor limite{draft.conditions.length > 1 ? ` ${i + 1}` : ''}
                    <input
                      type="number"
                      required
                      min={c.metric === 'profit' ? -10000000 : 0}
                      max="10000000"
                      step={['sales', 'clicks', 'impressions'].includes(c.metric) ? '1' : '0.01'}
                      value={c.threshold}
                      onChange={(e) => editCondition(i, { threshold: Number(e.target.value) })}
                    />
                  </label>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Remover condição ${i + 1}`}
                    disabled={draft.conditions.length === 1 && !draft.schedule_time}
                    onClick={() =>
                      change({ conditions: draft.conditions.filter((_, n) => n !== i) })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {draft.conditions.length < 5 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    change({
                      conditions: [
                        ...draft.conditions,
                        { metric: 'sales', operator: 'lt', threshold: 2 },
                      ],
                    })
                  }
                >
                  <CirclePlus size={15} />
                  Adicionar condição (E)
                </button>
              )}
              <p>
                CPA exige ao menos uma venda. ROAS exige gasto. Para campanhas sem vendas, combine
                investimento com vendas iguais a zero.
              </p>
            </fieldset>
            <div className="form-grid">
              <label>
                Investimento mínimo (R$)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  required
                  value={draft.min_spend}
                  onChange={(e) => change({ min_spend: Number(e.target.value) })}
                />
              </label>
              <label>
                Intervalo de segurança (min)
                <input
                  type="number"
                  min="15"
                  max="10080"
                  step="1"
                  required
                  value={draft.cooldown_minutes}
                  onChange={(e) => change({ cooldown_minutes: Number(e.target.value) })}
                />
              </label>
            </div>
            <label>
              Horário diário (opcional, Brasília)
              <input
                type="time"
                value={draft.schedule_time || ''}
                onChange={(e) => change({ schedule_time: e.target.value || null })}
              />
            </label>
            {draft.schedule_time && (
              <p className="rule-help">
                Executa na primeira verificação dentro de 1 hora após esse horário. Reativação
                agendada ocorre no máximo uma vez por campanha ao dia. Todas as condições continuam
                valendo.
              </p>
            )}
            <label>
              Campanhas
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPreview(null);
                  revision.current++;
                }}
              >
                <option value="all">Todas as campanhas da operação</option>
                <option value="selected">Selecionar campanhas</option>
              </select>
            </label>
            {scope === 'selected' && (
              <label>
                Campanhas selecionadas
                <select
                  multiple
                  size={Math.min(6, Math.max(2, data?.campaigns.length || 2))}
                  value={draft.campaign_ids}
                  onChange={(e) =>
                    change({ campaign_ids: Array.from(e.target.selectedOptions, (o) => o.value) })
                  }
                >
                  {data?.campaigns.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                      {c.external_id ? '' : ' (local)'}
                    </option>
                  ))}
                </select>
                <small>
                  Use Ctrl ou Command para selecionar mais de uma. Ações de veiculação exigem
                  campanhas Meta.
                </small>
              </label>
            )}
            <label className="rule-activate">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => change({ active: e.target.checked })}
              />
              Ativar ao salvar
              {draft.action !== 'alert' && ' e permitir alterações de veiculação na Meta'}
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={previewing || saving}
              onClick={() => void simulate()}
            >
              {previewing ? <Spinner /> : <FlaskConical size={16} />}Simular regra
            </button>
            {preview && (
              <div className="rule-preview" aria-live="polite">
                <strong>Simulação: {preview.matches.length} campanha(s) nas condições</strong>
                <p>
                  {preview.range.start} a {preview.range.end} ·{' '}
                  {preview.last_sync
                    ? `Última sincronização: ${dateTime(preview.last_sync)}`
                    : 'Dados armazenados na WeTrack'}
                  . Nenhuma alteração foi enviada.
                </p>
                {!preview.scheduled_now && (
                  <p>
                    Fora da janela do horário configurado. As campanhas abaixo só poderão receber a
                    ação na janela diária.
                  </p>
                )}
                {preview.matches.map((c) => (
                  <div key={c.id}>
                    <b>{c.name}</b>
                    <span>
                      {brl(c.metrics.spend || 0)} · {c.metrics.sales || 0} venda(s)
                    </span>
                    {c.blocked && <small>{c.blocked}</small>}
                  </div>
                ))}
                <small>
                  Na execução, os gastos são sincronizados e o status é confirmado novamente na
                  Meta.
                </small>
              </div>
            )}
            {formError && (
              <p className="rules-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button className="button secondary" type="button" disabled={saving} onClick={close}>
                Cancelar
              </button>
              <button className="button primary" disabled={saving}>
                {saving && <Spinner />}
                {editing?.id ? 'Salvar regra' : 'Criar regra'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

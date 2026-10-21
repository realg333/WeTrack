import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Copy,
  Link2,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api, brl, dateTime, decimal, downloadCsv, mutate, number, sourceName } from './lib';
import { Badge, Empty, Modal, Pagination, SearchBox, Spinner, Toggle } from './components';
import type { Dashboard, Toast } from './types';

type Stage = 'new' | 'qualified' | 'negotiating' | 'lost';
const stages: Record<Stage, string> = {
  new: 'Novo contato',
  qualified: 'Qualificado',
  negotiating: 'Negociando',
  lost: 'Perdido',
};
const origins: Record<string, string> = {
  smart_link: 'Smart link',
  meta_ad: 'Anúncio Meta',
  unattributed: 'Origem não identificada',
  manual: 'Cadastro manual',
};
type Contact = {
  id: string;
  name: string;
  wa_id: string;
  stage: Stage;
  created_at: string;
  last_seen: string;
  source: string;
  campaign: string;
  ad_reference: string;
  attribution_method: string;
  conversations: number;
  sales: number;
  revenue: number;
};
type Connection = {
  id: string;
  name: string;
  pixel_id: string | null;
  waba_id: string;
  phone_number_id: string;
  active: number;
  test_mode: number;
  api_checked_at: string | null;
  subscribed_at: string | null;
  verified_at: string | null;
  last_received_at: string | null;
};
type Report = {
  currency: 'BRL' | 'USD';
  contacts: Contact[];
  total: number;
  size: number;
  page: number;
  pipeline: Record<string, number>;
  connections: Connection[];
  pixels: { id: string; name: string }[];
  metrics: {
    contacts: number;
    wa_conversations: number;
    wa_converted: number;
    wa_conversion: number | null;
    cost_per_conversation: number | null;
    attributed_spend: number;
    attributed_conversations: number;
    sales: number;
    revenue: number;
  };
};
type Setup = Connection & {
  webhook_url: string;
  verify_token: string;
  receipts: { received_at: string; test_mode: number; accepted: number; ignored: number }[];
};
type Order = {
  currency: 'BRL' | 'USD';
  id: string;
  external_id: string;
  customer_name: string;
  product: string;
  amount: number;
  status: string;
  created_at: string;
  method?: string;
  contact_id?: string | null;
};
type Detail = {
  contact: Contact;
  conversations: {
    id: string;
    connection_name: string;
    started_at: string;
    last_message_at: string;
    utm_source: string;
    utm_campaign: string;
    ad_reference: string | null;
    attribution_method: string;
    inbound: number;
    outbound: number;
  }[];
  sales: Order[];
  history: { stage: Stage; created_at: string }[];
};
const statusLabels: Record<string, string> = {
  approved: 'Aprovado',
  pending: 'Pendente',
  refunded: 'Reembolsado',
  chargeback: 'Chargeback',
  canceled: 'Cancelado',
  disputed: 'Em disputa',
};

export default function WhatsAppPage({ data, notify }: { data: Dashboard; notify: Toast }) {
  const project = data.project.id;
  const [tab, setTab] = useState<'contacts' | 'connections'>('contacts'),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [stage, setStage] = useState('all'),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<'connect' | 'contact' | null>(null),
    [setupId, setSetupId] = useState<string | null>(null),
    [setup, setSetup] = useState<Setup | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [saleQuery, setSaleQuery] = useState(''),
    [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  useEffect(() => {
    let current = true;
    setError('');
    api<Report>(
      `/whatsapp?${new URLSearchParams({ project, start: data.start, end: data.end, currency: data.currency, q: query, stage, page: String(page) })}`,
    )
      .then((v) => {
        if (current) setReport(v);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [project, data.start, data.end, data.currency, query, stage, page, revision]);
  useEffect(() => {
    if (!setupId) {
      setSetup(null);
      return;
    }
    let live = true;
    setSetup(null);
    api<Setup>(`/whatsapp/connections/${setupId}/setup?project=${encodeURIComponent(project)}`)
      .then((v) => {
        if (live) setSetup(v);
      })
      .catch((e) => {
        if (live) notify(e.message, true);
      });
    return () => {
      live = false;
    };
  }, [setupId, project, revision]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    api<Detail>(`/whatsapp/contacts/${selected}?project=${encodeURIComponent(project)}`)
      .then((v) => {
        if (live) setDetail(v);
      })
      .catch((e) => {
        if (live) notify(e.message, true);
      });
    return () => {
      live = false;
    };
  }, [selected, project, revision]);
  useEffect(() => {
    let live = true;
    setOrders([]);
    if (selected && saleQuery.length >= 2)
      api<Order[]>(`/whatsapp/sales?${new URLSearchParams({ project, q: saleQuery })}`)
        .then((v) => {
          if (live) setOrders(v);
        })
        .catch((e) => {
          if (live) notify(e.message, true);
        });
    return () => {
      live = false;
    };
  }, [selected, project, saleQuery, revision]);
  const reload = () => setRevision((v) => v + 1);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      notify(success);
      reload();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify('Copiado.');
    } catch {
      notify('Não foi possível copiar. Selecione o texto.', true);
    }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await mutate(modal === 'connect' ? '/whatsapp/connections' : '/whatsapp/contacts', 'POST', {
        ...form,
        project_id: project,
      });
      setModal(null);
      if (modal === 'connect') setTab('connections');
      notify(modal === 'connect' ? 'Conexão criada em modo de teste.' : 'Contato cadastrado.');
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const filter = (value: string) => {
    setStage(value);
    setPage(1);
  };
  if (error)
    return (
      <div className="error-panel">
        <p>{error}</p>
        <button className="button secondary" onClick={reload}>
          Tentar novamente
        </button>
      </div>
    );
  if (!report)
    return (
      <div className="loading-page">
        <Spinner />
      </div>
    );
  const metrics = report.metrics;
  return (
    <div className="wa-page">
      <div className="wa-heading">
        <div className="integration-tabs" role="tablist" aria-label="WhatsApp">
          <button
            role="tab"
            aria-selected={tab === 'contacts'}
            className={tab === 'contacts' ? 'selected' : ''}
            onClick={() => setTab('contacts')}
          >
            <Users size={15} />
            Contatos e vendas
          </button>
          <button
            role="tab"
            aria-selected={tab === 'connections'}
            className={tab === 'connections' ? 'selected' : ''}
            onClick={() => setTab('connections')}
          >
            <Link2 size={15} />
            Conexões <span>{report.connections.length}</span>
          </button>
        </div>
        <button className="button secondary" onClick={reload}>
          <RefreshCw size={14} />
          Atualizar WhatsApp
        </button>
      </div>
      {tab === 'contacts' ? (
        <>
          <div className="wa-metrics">
            {[
              {
                label: 'Conversas iniciadas',
                value: number(metrics.wa_conversations),
                tip: 'Sessões iniciadas por mensagem recebida no período.',
              },
              {
                label: 'Contatos no período',
                value: number(metrics.contacts),
                tip: 'Contatos com mensagens, cadastro manual ou compra aprovada no período.',
              },
              {
                label: 'Custo por conversa atribuída',
                value:
                  metrics.cost_per_conversation == null
                    ? '—'
                    : brl(metrics.cost_per_conversation, report.currency),
                tip: `${brl(metrics.attributed_spend, report.currency)} nas campanhas identificadas da moeda selecionada ÷ ${number(metrics.attributed_conversations)} conversas atribuídas a essas campanhas.`,
              },
              {
                label: 'Conversão de conversa',
                value: metrics.wa_conversion == null ? '—' : decimal(metrics.wa_conversion) + '%',
                tip: 'Conversas iniciadas no período com compra aprovada até o fim do período ÷ conversas iniciadas.',
              },
              {
                label: 'Vendas aprovadas vinculadas',
                value: number(metrics.sales),
                tip: 'Pedidos aprovados do checkout com data original no período e vínculo com contato.',
              },
              {
                label: 'Receita vinculada',
                value: brl(metrics.revenue, report.currency),
                tip: 'Receita dos pedidos vinculados aprovados. Já faz parte do faturamento geral; não somar novamente.',
              },
            ].map((m) => (
              <article className="panel" key={m.label} title={m.tip}>
                <span>{m.label}</span>
                <strong>{m.value}</strong>
              </article>
            ))}
          </div>
          <p className="panel-footnote">
            Contatos e conversas abrangem a operação. Compras e valores seguem a moeda selecionada:{' '}
            {report.currency}. O custo considera campanhas identificadas nessa moeda.
          </p>
          <div className="wa-pipeline" role="group" aria-label="Etapas dos contatos">
            {[['all', 'Todos'], ...Object.entries(stages), ['buyers', 'Comprou']].map(
              ([id, label]) => (
                <button
                  key={id}
                  aria-pressed={stage === id}
                  className={stage === id ? 'selected' : ''}
                  onClick={() => filter(id)}
                >
                  <span>{label}</span>
                  <strong>
                    {number(
                      id === 'all'
                        ? Object.values(stages).reduce(
                            (v, _, i) => v + (report.pipeline[Object.keys(stages)[i]] || 0),
                            0,
                          )
                        : report.pipeline[id] || 0,
                    )}
                  </strong>
                </button>
              ),
            )}
          </div>
          <section className="panel">
            <div className="table-toolbar">
              <SearchBox
                value={query}
                onChange={(v) => {
                  setQuery(v);
                  setPage(1);
                }}
                placeholder="Buscar contato por nome ou telefone…"
              />
              <div className="toolbar-actions">
                <button
                  className="button secondary"
                  disabled={!report.contacts.length}
                  onClick={() =>
                    downloadCsv(`wetrack-whatsapp-${report.currency}.csv`, [
                      [
                        'Contato',
                        'Telefone',
                        'Etapa',
                        'Origem',
                        'Campanha',
                        'Conversas',
                        'Vendas aprovadas',
                        'Receita',
                        'Moeda',
                      ],
                      ...report.contacts.map((c) => [
                        c.name,
                        c.wa_id,
                        stages[c.stage],
                        c.source,
                        c.campaign,
                        c.conversations,
                        c.sales,
                        c.revenue,
                        report.currency,
                      ]),
                    ])
                  }
                >
                  <ArrowDownToLine size={14} />
                  Exportar página
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    setFormError('');
                    setModal('contact');
                  }}
                >
                  <Plus size={15} />
                  Adicionar contato
                </button>
              </div>
            </div>
            {report.contacts.length ? (
              <>
                <div className="table-scroll">
                  <table className="data-table wa-contact-table">
                    <thead>
                      <tr>
                        <th>Contato</th>
                        <th>Etapa atual</th>
                        <th>Origem</th>
                        <th>Conversas iniciadas</th>
                        <th>Vendas aprovadas</th>
                        <th>Receita vinculada</th>
                        <th>Última atividade</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {report.contacts.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.name}</strong>
                            <small>+{c.wa_id}</small>
                          </td>
                          <td>
                            <select
                              aria-label={`Etapa de ${c.name}`}
                              value={c.stage}
                              disabled={busy}
                              onChange={(e) =>
                                void run(
                                  () =>
                                    mutate(`/whatsapp/contacts/${c.id}`, 'PATCH', {
                                      project_id: project,
                                      stage: e.target.value,
                                    }),
                                  'Etapa atualizada.',
                                )
                              }
                            >
                              {Object.entries(stages).map(([v, label]) => (
                                <option key={v} value={v}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <strong>{origins[c.attribution_method] || sourceName(c.source)}</strong>
                            <small>
                              {c.campaign || sourceName(c.source)}
                              {c.ad_reference ? ' · Anúncio ' + c.ad_reference : ''}
                            </small>
                          </td>
                          <td>{number(c.conversations)}</td>
                          <td>{c.sales ? <Badge>{c.sales} compra(s)</Badge> : '—'}</td>
                          <td>{brl(c.revenue, report.currency)}</td>
                          <td>{dateTime(c.last_seen)}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                setSaleQuery('');
                                setSelected(c.id);
                              }}
                            >
                              Ver contato
                              <ArrowRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={report.page}
                  size={report.size}
                  total={report.total}
                  onChange={setPage}
                />
              </>
            ) : (
              <Empty
                icon={<MessageCircle size={26} />}
                title={
                  query || stage !== 'all'
                    ? 'Nenhum contato encontrado'
                    : 'Acompanhe cada conversa até a compra'
                }
                text={
                  query || stage !== 'all'
                    ? 'Ajuste a busca, a etapa ou o período.'
                    : 'Conecte o WhatsApp Business para receber contatos automaticamente. Você continua respondendo pelo aplicativo.'
                }
                action={
                  <button className="button secondary" onClick={() => setTab('connections')}>
                    Configurar conexão
                  </button>
                }
              />
            )}
            <p className="panel-footnote">
              Etapas são marcações manuais atuais. “Comprou” depende de pedido aprovado do checkout.
              Conversas são sessões com mensagem recebida, renovadas após 24h de inatividade ou nova
              origem identificada; não são a cobrança de conversas da Meta. Clique no WhatsApp não
              conta como conversa.
            </p>
          </section>
        </>
      ) : (
        <>
          <section className="panel wa-onboarding">
            <div>
              <span className="eyebrow">SEU ATENDIMENTO CONTINUA NO CELULAR</span>
              <h2>Conecte o WhatsApp Business</h2>
              <p>
                A WeTrack recebe eventos da API oficial e acompanha contatos, origem e compras. Você
                pode continuar atendendo no aplicativo Business com coexistência, quando sua conta
                estiver habilitada na Meta.
              </p>
            </div>
            <button
              className="button primary"
              disabled={!report.pixels.length}
              onClick={() => {
                setFormError('');
                setModal('connect');
              }}
            >
              <Plus size={16} />
              Configurar API oficial
            </button>
          </section>
          {!report.pixels.length && (
            <p className="inline-notice">
              Cadastre um pixel em Integrações → Pixel de rastreio antes de configurar o WhatsApp.
            </p>
          )}
          <section className="panel wa-instructions">
            <h3>Como ativar sem trocar seu atendimento</h3>
            <ol>
              <li>
                Habilite o número Business na Cloud API pelo fluxo de <strong>coexistência</strong>{' '}
                da Meta ou de um provedor habilitado. A elegibilidade e as permissões dependem da
                Meta.
              </li>
              <li>
                Cadastre aqui o ID da conta WhatsApp, o ID do número, o token com acesso e o segredo
                do aplicativo Meta. Esses IDs são diferentes do número de telefone.
              </li>
              <li>
                Valide o acesso. Configure Webhooks → WhatsApp Business Account no aplicativo Meta e
                assine <code>messages</code> e, para ecos do aplicativo,
                <code>smb_message_echoes</code>. Em seguida, use “Conectar entregas deste número”.
              </li>
              <li>
                Envie uma mensagem de outro número, confira a entrega de teste e ative a coleta
                real. O teste não cria contatos nem faturamento.
              </li>
            </ol>
            <p>
              Esta configuração recebe eventos; ela não registra, migra ou desconecta seu número na
              Meta. Não oferece leitura de WhatsApp pessoal, chatbot ou envio de mensagens.{' '}
              <a
                href="https://docs.360dialog.com/docs/resources/phone-numbers/coexistence"
                target="_blank"
                rel="noreferrer"
              >
                Entender a coexistência e suas limitações ↗
              </a>
            </p>
          </section>
          {report.connections.map((c) => (
            <section className="panel wa-connection" key={c.id}>
              <div>
                <div className="wa-connection-title">
                  <span className="integration-logo pixel">
                    <MessageCircle size={24} />
                  </span>
                  <div>
                    <h3>{c.name}</h3>
                    <small>ID do número: {c.phone_number_id}</small>
                  </div>
                </div>
                <div className="wa-connection-badges">
                  <Badge tone={!c.active ? 'gray' : c.test_mode ? 'amber' : 'green'}>
                    {!c.active ? 'Desativada' : c.test_mode ? 'Modo de teste' : 'Coleta real'}
                  </Badge>
                  <span>
                    {c.verified_at ? 'Webhook verificado' : 'Aguardando verificação do webhook'}
                  </span>
                  <span>{c.api_checked_at ? 'Acesso validado' : 'Acesso pendente'}</span>
                </div>
                <p className="muted">
                  {c.last_received_at
                    ? 'Última entrega: ' + dateTime(c.last_received_at)
                    : 'Nenhum evento recebido ainda.'}
                </p>
              </div>
              <div className="wa-connection-actions">
                <Toggle
                  checked={Boolean(c.active)}
                  disabled={busy}
                  label={`Ativar conexão ${c.name}`}
                  onChange={() =>
                    void run(
                      () =>
                        mutate(`/whatsapp/connections/${c.id}`, 'PATCH', {
                          project_id: project,
                          active: !c.active,
                        }),
                      'Conexão atualizada.',
                    )
                  }
                />
                <button className="button secondary" onClick={() => setSetupId(c.id)}>
                  <Settings2 size={14} />
                  Configuração e entregas
                </button>
              </div>
            </section>
          ))}
        </>
      )}
      {modal && (
        <Modal
          title={modal === 'connect' ? 'Configurar WhatsApp oficial' : 'Adicionar contato'}
          subtitle={
            modal === 'connect'
              ? 'Use os dados do aplicativo Meta conectado ao número. Credenciais ficam criptografadas.'
              : 'Cadastro manual não registra uma conversa recebida nem uma venda.'
          }
          onClose={() => setModal(null)}
        >
          <form onSubmit={submit}>
            <label>
              Nome
              <input
                name="name"
                required
                minLength={modal === 'connect' ? 2 : 1}
                maxLength={modal === 'connect' ? 80 : 100}
                placeholder={modal === 'connect' ? 'Atendimento principal' : 'Nome do contato'}
              />
            </label>
            {modal === 'connect' ? (
              <>
                <label>
                  Pixel da operação
                  <select name="pixel_id" aria-label="Pixel da operação" required>
                    {report.pixels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  ID da conta WhatsApp (WABA)
                  <input name="waba_id" required pattern="[0-9]{5,30}" inputMode="numeric" />
                </label>
                <label>
                  ID do número (Phone Number ID)
                  <input
                    name="phone_number_id"
                    required
                    pattern="[0-9]{5,30}"
                    inputMode="numeric"
                  />
                </label>
                <label>
                  Token de acesso
                  <input
                    name="access_token"
                    type="password"
                    autoComplete="off"
                    required
                    minLength={10}
                    maxLength={8000}
                  />
                </label>
                <label>
                  Segredo do aplicativo Meta
                  <input
                    name="app_secret"
                    type="password"
                    autoComplete="off"
                    required
                    minLength={16}
                    maxLength={500}
                  />
                </label>
                <p className="inline-notice">
                  <ShieldCheck size={15} />A conexão começa em teste. Nenhuma mensagem será enviada
                  pelo sistema.
                </p>
              </>
            ) : (
              <label>
                Telefone com DDI
                <input
                  name="phone"
                  type="tel"
                  required
                  pattern="\+?[1-9][0-9]{7,14}"
                  placeholder="5511999999999"
                />
                <small>
                  Inclua 55 para números brasileiros e informe somente números, com + opcional.
                </small>
              </label>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <Spinner />}Salvar
              </button>
            </div>
          </form>
        </Modal>
      )}
      {setupId && (
        <Modal
          title="Configuração e entregas do WhatsApp"
          subtitle="Valide o acesso, configure o webhook e confira uma mensagem de teste."
          wide
          onClose={() => setSetupId(null)}
        >
          {!setup ? (
            <Spinner />
          ) : (
            <div className="wa-setup">
              <div className="wa-setup-status">
                <Badge tone={setup.test_mode ? 'amber' : 'green'}>
                  {setup.test_mode ? 'Modo de teste' : 'Coleta real'}
                </Badge>
                <button
                  className="button secondary"
                  disabled={busy || !setup.active}
                  onClick={() =>
                    void run(
                      () =>
                        mutate(`/whatsapp/connections/${setup.id}/check`, 'POST', {
                          project_id: project,
                        }),
                      'Número e conta confirmados na Meta.',
                    )
                  }
                >
                  <ShieldCheck size={14} />
                  {setup.api_checked_at ? 'Validar acesso novamente' : 'Validar acesso na Meta'}
                </button>
              </div>
              <label>URL do webhook</label>
              <div className="wa-copy">
                <code>{setup.webhook_url}</code>
                <button
                  className="icon-button"
                  aria-label="Copiar URL do webhook"
                  onClick={() => void copy(setup.webhook_url)}
                >
                  <Copy size={16} />
                </button>
              </div>
              <label>Token de verificação</label>
              <div className="wa-copy">
                <code>{setup.verify_token}</code>
                <button
                  className="icon-button"
                  aria-label="Copiar token de verificação"
                  onClick={() => void copy(setup.verify_token)}
                >
                  <Copy size={16} />
                </button>
              </div>
              <p className="muted">
                No aplicativo Meta, configure Webhooks → WhatsApp Business Account com os campos
                messages e smb_message_echoes. O botão abaixo inscreve o aplicativo na conta e
                configura esta URL para este número. A Meta verifica a URL antes de entregar
                eventos.
              </p>
              <button
                className="button secondary"
                disabled={busy || !setup.active || !setup.api_checked_at}
                onClick={() =>
                  void run(
                    () =>
                      mutate(`/whatsapp/connections/${setup.id}/subscribe`, 'POST', {
                        project_id: project,
                      }),
                    'Entregas conectadas. Confira a verificação da URL e envie uma mensagem de teste.',
                  )
                }
              >
                <Link2 size={14} />
                Conectar entregas deste número
              </button>
              <div className="wa-checklist">
                <span>
                  {setup.api_checked_at && <Check size={14} />}
                  {setup.api_checked_at ? 'Acesso ao número validado' : 'Acesso ao número pendente'}
                </span>
                <span>
                  {setup.subscribed_at && <Check size={14} />}
                  {setup.subscribed_at ? 'Entregas conectadas' : 'Entregas pendentes'}
                </span>
                <span>
                  {setup.verified_at && <Check size={14} />}
                  {setup.verified_at
                    ? 'URL verificada pela Meta'
                    : 'URL aguardando verificação da Meta'}
                </span>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!setup.test_mode}
                  disabled={
                    busy ||
                    !setup.active ||
                    !setup.api_checked_at ||
                    !setup.subscribed_at ||
                    !setup.verified_at
                  }
                  onChange={(e) =>
                    void run(
                      () =>
                        mutate(`/whatsapp/connections/${setup.id}`, 'PATCH', {
                          project_id: project,
                          test_mode: !e.target.checked,
                        }),
                      'Modo de coleta atualizado.',
                    )
                  }
                />
                Ativar coleta real de contatos e conversas
              </label>
              <p className="muted">
                Entregas de teste não serão importadas retroativamente. Envie uma nova mensagem
                depois de ativar.
              </p>
              <h3>Últimas entregas</h3>
              {setup.receipts.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Recebido</th>
                        <th>Modo</th>
                        <th>Aceitos</th>
                        <th>Ignorados / repetidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {setup.receipts.map((r, i) => (
                        <tr key={i}>
                          <td>{dateTime(r.received_at)}</td>
                          <td>{r.test_mode ? 'Teste' : 'Real'}</td>
                          <td>{r.accepted}</td>
                          <td>{r.ignored}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">
                  Aguardando a primeira entrega assinada. Teste com uma mensagem enviada de outro
                  número.
                </p>
              )}
              <button className="button secondary" onClick={reload}>
                <RefreshCw size={14} />
                Atualizar entregas
              </button>
              <details>
                <summary>Atualizar credenciais</summary>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const token = String(form.get('access_token') || ''),
                      secret = String(form.get('app_secret') || '');
                    await run(
                      () =>
                        mutate(`/whatsapp/connections/${setup.id}`, 'PATCH', {
                          project_id: project,
                          ...(token ? { access_token: token } : {}),
                          ...(secret ? { app_secret: secret } : {}),
                        }),
                      'Credenciais atualizadas. Valide a conexão novamente.',
                    );
                  }}
                >
                  <label>
                    Novo token de acesso
                    <input
                      type="password"
                      name="access_token"
                      autoComplete="off"
                      minLength={10}
                      maxLength={8000}
                    />
                  </label>
                  <label>
                    Novo segredo do aplicativo
                    <input
                      type="password"
                      name="app_secret"
                      autoComplete="off"
                      minLength={16}
                      maxLength={500}
                    />
                  </label>
                  <button className="button secondary" disabled={busy}>
                    Salvar novas credenciais
                  </button>
                </form>
                <p className="muted">
                  Campos vazios preservam a credencial atual. Atualizar credenciais retorna a
                  conexão ao modo de teste.
                </p>
              </details>
            </div>
          )}
        </Modal>
      )}
      {selected && (
        <Modal
          title={detail?.contact.name || 'Contato WhatsApp'}
          subtitle={detail ? '+' + detail.contact.wa_id : 'Carregando…'}
          wide
          onClose={() => setSelected(null)}
        >
          {!detail ? (
            <Spinner />
          ) : (
            <div className="wa-detail">
              <label>
                Etapa do contato
                <select
                  aria-label="Etapa do contato"
                  value={detail.contact.stage}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () =>
                        mutate(`/whatsapp/contacts/${selected}`, 'PATCH', {
                          project_id: project,
                          stage: e.target.value,
                        }),
                      'Etapa atualizada.',
                    )
                  }
                >
                  {Object.entries(stages).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <h3>Conversas recebidas</h3>
              {detail.conversations.length ? (
                detail.conversations.map((v) => (
                  <article className="wa-conversation" key={v.id}>
                    <strong>
                      {dateTime(v.started_at)} · {v.connection_name}
                    </strong>
                    <p>
                      {origins[v.attribution_method]} · {sourceName(v.utm_source)}
                      {v.utm_campaign ? ' · Campanha ' + v.utm_campaign : ''}
                      {v.ad_reference ? ' · Anúncio ' + v.ad_reference : ''}
                    </p>
                    <small>
                      {number(v.inbound)} mensagens recebidas · {number(v.outbound)} ecos de
                      resposta disponíveis · Última recebida {dateTime(v.last_message_at)}
                    </small>
                  </article>
                ))
              ) : (
                <p className="muted">
                  Contato manual: nenhuma conversa recebida pela conexão oficial.
                </p>
              )}
              <h3>Pedidos vinculados</h3>
              {detail.sales.length ? (
                detail.sales.map((s) => (
                  <article className="wa-order" key={s.id}>
                    <div>
                      <strong>
                        {s.external_id} · {s.product}
                      </strong>
                      <small>
                        {statusLabels[s.status] || s.status} · {dateTime(s.created_at)} · Vínculo{' '}
                        {(
                          {
                            manual: 'manual',
                            phone: 'por telefone',
                            visitor: 'por visitante',
                          } as Record<string, string>
                        )[s.method || ''] || s.method}
                      </small>
                    </div>
                    <strong>{brl(s.amount, s.currency)}</strong>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            mutate(
                              `/whatsapp/contacts/${selected}/sales/${s.id}?project=${encodeURIComponent(project)}`,
                              'DELETE',
                            ),
                          'Vínculo removido; pedido preservado.',
                        )
                      }
                    >
                      Desvincular
                    </button>
                  </article>
                ))
              ) : (
                <p className="muted">
                  Nenhum pedido vinculado. O checkout deve informar telefone com DDI ou o visitante
                  rastreado. Mensagens não criam faturamento.
                </p>
              )}
              <details>
                <summary>Vincular um pedido existente</summary>
                <p className="muted">
                  Selecione o pedido correto. Isso não muda valor, status ou atribuição de campanha
                  da venda. Pedidos pendentes e reembolsados não entram como compra aprovada.
                </p>
                <SearchBox
                  value={saleQuery}
                  onChange={setSaleQuery}
                  placeholder="Buscar pedido, cliente ou e-mail…"
                />
                {orders.map((s) => (
                  <article className="wa-order" key={s.id}>
                    <div>
                      <strong>
                        {s.external_id} · {s.product}
                      </strong>
                      <small>
                        {s.customer_name} · {statusLabels[s.status] || s.status} ·{' '}
                        {brl(s.amount, s.currency)}
                      </small>
                    </div>
                    <button
                      className="button secondary"
                      disabled={busy || Boolean(s.contact_id)}
                      onClick={() =>
                        void run(
                          () =>
                            mutate(`/whatsapp/contacts/${selected}/sales`, 'POST', {
                              project_id: project,
                              sale_id: s.id,
                            }),
                          'Pedido vinculado ao contato.',
                        )
                      }
                    >
                      {s.contact_id ? 'Já vinculado' : 'Vincular pedido'}
                    </button>
                  </article>
                ))}
              </details>
              {detail.history.length > 0 && (
                <details>
                  <summary>Histórico de etapas</summary>
                  {detail.history.map((h, i) => (
                    <p className="muted" key={i}>
                      {dateTime(h.created_at)} · {stages[h.stage]}
                    </p>
                  ))}
                </details>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

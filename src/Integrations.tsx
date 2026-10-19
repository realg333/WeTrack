import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  Code2,
  Copy,
  Globe,
  Link2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Trash2,
  Unplug,
  Webhook,
  Zap,
} from 'lucide-react';
import { api, dateTime, mutate, number } from './lib';
import { Badge, Empty, Modal, SearchBox, Spinner, Toggle } from './components';
import type { Integrations, Pixel, Toast, PlatformConnectionData } from './types';
import PlatformConnection from './PlatformConnection';
import { platformGuides, type Provider } from './platform-guides';

const tabs = ['Visão geral', 'Meta Ads', 'Pixel de rastreio', 'UTMs', 'Webhook API'];
const metaUtmTemplate =
  'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}';
const sample = {
  order_id: 'PEDIDO-1001',
  status: 'approved',
  amount: 97,
  customer_name: 'Cliente de exemplo',
  product: 'Meu produto',
  payment_method: 'pix',
  utm_source: 'facebook',
  utm_campaign: 'minha-campanha',
};

export default function IntegrationsPage({
  project,
  notify,
  onDataChange,
}: {
  project: string;
  notify: Toast;
  onDataChange: () => void;
}) {
  const [tab, setTab] = useState('Meta Ads');
  const [data, setData] = useState<Integrations | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<
    | 'pixel'
    | 'platforms'
    | 'token'
    | 'meta'
    | 'oauth'
    | 'docs'
    | 'events'
    | 'delete'
    | 'capi'
    | 'pixel-capi'
    | null
  >(null);
  const [selectedPixel, setSelectedPixel] = useState<Pixel | null>(null);
  const [events, setEvents] = useState<
    { event_name: string; page_url: string; utm_source: string; created_at: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [oauthLink, setOauthLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [capiEnabled, setCapiEnabled] = useState(false);
  const [deliveries, setDeliveries] = useState<
    {
      id: string;
      status: string;
      attempts: number;
      last_error: string | null;
      created_at: string;
      pixel_name: string;
    }[]
  >([]);
  const [platformQuery, setPlatformQuery] = useState('');
  const [native, setNative] = useState<{
    provider: Provider;
    connection?: PlatformConnectionData;
    tab?: string;
  } | null>(null);
  const [newToken, setNewToken] = useState<{ token: string; url: string } | null>(null);
  const [deletion, setDeletion] = useState<{
    id: string;
    kind: 'pixels' | 'tokens';
    name: string;
  } | null>(null);
  const [utm, setUtm] = useState({
    url: 'https://seusite.com.br',
    source: 'facebook',
    medium: 'paid',
    campaign: '',
    content: '',
    term: '',
  });
  const generation = useRef(0);
  const oauthGeneration = useRef(0);
  const load = useCallback(async () => {
    const v = ++generation.current;
    try {
      const result = await api<Integrations>(`/integrations?project=${project}`);
      if (v === generation.current) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (v === generation.current) setError((e as Error).message);
    }
  }, [project]);
  useEffect(() => {
    oauthGeneration.current++;
    setBusy(false);
    setData(null);
    setOauthLink(null);
    setModal(null);
    setNative(null);
    void load();
    return () => {
      oauthGeneration.current++;
    };
  }, [load]);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify('Copiado para a área de transferência.');
    } catch {
      notify('Não foi possível copiar. Selecione o texto e copie manualmente.', true);
    }
  };
  const closeOAuth = () => {
    oauthGeneration.current++;
    setBusy(false);
    setModal(null);
    setOauthLink(null);
  };
  const prepareOAuth = async (copyLink = false) => {
    const request = ++oauthGeneration.current;
    setModal('oauth');
    setOauthLink(null);
    if (!data?.meta.oauth.configured) return;
    setBusy(true);
    try {
      const link = await mutate<{ url: string; expires_at: string }>('/meta/oauth/links', 'POST', {
        project_id: project,
      });
      if (request !== oauthGeneration.current) return;
      setOauthLink(link);
      if (copyLink) await copy(link.url);
    } catch (e) {
      if (request === oauthGeneration.current) notify((e as Error).message, true);
    } finally {
      if (request === oauthGeneration.current) setBusy(false);
    }
  };
  const snippet = (pixel: Pixel) => {
    let checkout = '';
    try {
      checkout = ` data-checkout-origin="${new URL(pixel.checkout_url).origin}"`;
    } catch {
      /* Optional checkout. */
    }
    return `<script async src="${data?.base_url}/pixel.js" data-pixel="${pixel.id}"${checkout}></script>`;
  };
  const savePixel = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      await mutate('/pixels', 'POST', { ...form, project_id: project });
      setModal(null);
      setTab('Pixel de rastreio');
      await load();
      notify('Pixel criado. Instale o script no domínio cadastrado.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const createToken = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      const token = await mutate<{ token: string; url: string }>('/tokens', 'POST', {
        ...form,
        project_id: project,
        platform: 'API personalizada',
      });
      setNewToken(token);
      await load();
      notify('Integração criada. Guarde a URL em um local seguro.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  let utmUrl = '';
  try {
    const url = new URL(utm.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
    Object.entries(utm)
      .filter(([key, v]) => key !== 'url' && v.trim())
      .forEach(([key, value]) => url.searchParams.set(`utm_${key}`, value.trim()));
    utmUrl = url.href;
  } catch {
    /* Invalid URL is described next to the field. */
  }
  const openToken = () => {
    setNewToken(null);
    setModal('token');
  };
  if (error)
    return (
      <div className="error-panel">
        <p>{error}</p>
        <button className="button secondary" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="loading-page">
        <Spinner />
        <p>Carregando suas conexões…</p>
      </div>
    );
  return (
    <>
      <div className="integration-tabs" role="tablist" aria-label="Integrações">
        {tabs.map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            key={t}
            className={tab === t ? 'selected' : ''}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Pixel de rastreio' && <span>{data.pixels.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'Visão geral' && (
        <>
          <div className="integration-hero">
            <div className="integration-hero-icon">
              <Link2 size={28} />
            </div>
            <div>
              <span className="eyebrow">SUA OPERAÇÃO, CONECTADA</span>
              <h2>Menos abas. Mais clareza.</h2>
              <p>Reúna anúncios, visitas e vendas em uma única visão.</p>
            </div>
            <button className="button secondary" onClick={() => setModal('docs')}>
              <BookOpen size={16} />
              Guia de integração
              <ArrowUpRight size={15} />
            </button>
            <div className="connection-decoration">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="section-heading">
            <div>
              <h2>Suas conexões</h2>
              <p>Escolha por onde quer começar.</p>
            </div>
            <span className="muted">{data.pixels.length + data.tokens.length} configurada(s)</span>
          </div>
          <div className="integration-card-grid">
            {[
              {
                title: 'Meta Ads',
                text: 'Conecte suas contas de anúncios para centralizar campanhas e investimento.',
                mark: '∞',
                className: 'meta',
                status: data.meta.connected
                  ? 'Conectada'
                  : data.meta.oauth.configured
                    ? 'Pronta para conectar'
                    : 'Configuração pendente',
                tone: data.meta.connected ? 'green' : 'neutral',
                action: data.meta.connected ? 'Gerenciar contas' : 'Conectar com Facebook',
                click: () => (data.meta.connected ? setTab('Meta Ads') : void prepareOAuth()),
              },
              {
                title: 'Pixel de rastreio',
                text: 'Entenda cada visita e preserve as UTMs do primeiro clique até a compra.',
                mark: <Code2 size={25} />,
                className: 'pixel',
                status: data.pixels.length ? `${data.pixels.length} pixel(s)` : 'Disponível',
                tone: 'green',
                action: 'Gerenciar pixels',
                click: () => setTab('Pixel de rastreio'),
              },
              {
                title: 'Webhook de vendas',
                text: 'Receba pedidos, atualize pagamentos e atribua suas conversões.',
                mark: <Webhook size={25} />,
                className: 'webhook',
                status: data.tokens.length ? `${data.tokens.length} conexão(ões)` : 'Disponível',
                tone: 'green',
                action: 'Conectar plataforma',
                click: () => setModal('platforms'),
              },
            ].map((c) => (
              <section className="panel integration-card" key={c.title}>
                <div className="integration-card-top">
                  <span className={`integration-logo ${c.className}`}>{c.mark}</span>
                  <Badge tone={c.tone}>{c.status}</Badge>
                </div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <button className="integration-card-action" onClick={c.click}>
                  {c.action}
                  <ArrowRight size={16} />
                </button>
              </section>
            ))}
          </div>
          <section className="panel utm-shortcut">
            <span className="utm-shortcut-icon">
              <Link2 size={22} />
            </span>
            <div>
              <h3>Um bom rastreamento começa com um bom link.</h3>
              <p>Crie URLs com UTMs e saiba exatamente de onde veio cada resultado.</p>
            </div>
            <button className="button secondary" onClick={() => setTab('UTMs')}>
              Criar link rastreável
              <ArrowRight size={15} />
            </button>
          </section>
          <div className="security-note">
            <ShieldCheck size={16} />
            <span>Suas conexões ficam protegidas no servidor.</span>
          </div>
        </>
      )}
      {tab === 'Meta Ads' && (
        <>
          <section className="panel meta-connection">
            <div className="panel-heading">
              <div>
                <h2>Contas de anúncios</h2>
                <p>Investimento de campanhas Meta em reais</p>
              </div>
              <span className="integration-logo meta">∞</span>
            </div>
            <div className="oauth-connect-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void prepareOAuth()}
              >
                <Link2 size={15} />
                Conectar com Facebook
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void prepareOAuth(true)}
              >
                <Copy size={15} />
                Copiar link de conexão
              </button>
              <button className="button secondary" disabled={busy} onClick={() => void load()}>
                Atualizar contas
              </button>
              <span className="muted">
                {data.meta.accounts.filter((a) => a.enabled).length} de {data.meta.accounts.length}{' '}
                contas selecionadas
              </span>
            </div>
            {data.meta.connected ? (
              <>
                <div className="meta-connected-actions">
                  <Badge>Conexão autorizada</Badge>
                  <span className="muted">
                    {data.meta.last_sync
                      ? `Sincronizado em ${dateTime(data.meta.last_sync)}`
                      : 'Aguardando primeira sincronização'}
                  </span>
                  <button
                    className="button primary"
                    disabled={busy || !data.meta.accounts.some((a) => a.enabled)}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const end = new Date();
                        const start = new Date();
                        start.setDate(start.getDate() - 29);
                        const result = await mutate<{ campaigns: number }>('/meta/sync', 'POST', {
                          project_id: project,
                          start: start.toISOString().slice(0, 10),
                          end: end.toISOString().slice(0, 10),
                        });
                        await load();
                        onDataChange();
                        notify(
                          `${result.campaigns} campanha(s) sincronizada(s) nos últimos 30 dias.`,
                        );
                      } catch (e) {
                        notify((e as Error).message, true);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? <Spinner /> : <Activity size={15} />}Sincronizar 30 dias
                  </button>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Conta de anúncios</th>
                        <th>ID</th>
                        <th>Moeda</th>
                        <th>Status Meta</th>
                        <th>Incluir nesta operação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.meta.accounts.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.name}</strong>
                          </td>
                          <td>
                            <code>{a.id}</code>
                          </td>
                          <td>{a.currency}</td>
                          <td>
                            <Badge tone={a.account_status === 1 ? 'green' : 'amber'}>
                              {a.account_status === 1 ? 'Ativa' : `Status ${a.account_status}`}
                            </Badge>
                          </td>
                          <td>
                            <div className="account-selection">
                              <Toggle
                                checked={a.enabled}
                                disabled={busy || !a.supported}
                                label={`${a.enabled ? 'Desativar' : 'Ativar'} conta ${a.name} nesta operação`}
                                onChange={async () => {
                                  setBusy(true);
                                  try {
                                    await mutate(
                                      `/meta/accounts/${encodeURIComponent(a.id)}`,
                                      'PUT',
                                      { project_id: project, enabled: !a.enabled },
                                    );
                                    await load();
                                    onDataChange();
                                    notify(
                                      a.enabled
                                        ? 'Conta retirada dos relatórios. Histórico preservado.'
                                        : 'Conta selecionada. Sincronize para importar os dados.',
                                    );
                                  } catch (e) {
                                    notify((e as Error).message, true);
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              />
                              <span>
                                {!a.supported
                                  ? 'Moeda ainda não suportada'
                                  : a.enabled
                                    ? 'Selecionada'
                                    : 'Desativada'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="meta-connected-footer">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void prepareOAuth()}
                  >
                    Reconectar com Facebook
                  </button>
                  <button
                    className="text-button text-red"
                    onClick={async () => {
                      try {
                        await mutate(`/meta/${project}`, 'DELETE');
                        await load();
                        notify('Perfil Meta desconectado. Histórico de métricas preservado.');
                      } catch (e) {
                        notify((e as Error).message, true);
                      }
                    }}
                  >
                    Desconectar
                  </button>
                </div>
              </>
            ) : (
              <Empty
                icon={<Unplug size={29} />}
                title="Conecte seu perfil do Facebook"
                text="Copie o link de conexão e abra no perfil desejado do Multilogin, ou conecte neste navegador. Depois da autorização, atualize a lista e escolha as contas de anúncios desta operação."
              />
            )}
          </section>
          <div className="inline-notice">
            <CircleHelp size={16} />
            Contas novas começam desativadas. Apenas as selecionadas entram na sincronização e nos
            relatórios. Esta versão calcula valores em BRL; contas em outras moedas ficam
            disponíveis na lista. A gestão de campanhas, conjuntos e anúncios exige ads_management e
            acesso suficiente à conta na Meta.
          </div>
        </>
      )}
      {tab === 'Pixel de rastreio' && (
        <>
          <div className="section-heading">
            <div>
              <h2>
                Pixels de rastreio<span className="count-label">{data.pixels.length}</span>
              </h2>
              <p>Seu primeiro clique, sempre no radar.</p>
            </div>
            <button className="button primary" onClick={() => setModal('pixel')}>
              <Plus size={16} />
              Novo pixel
            </button>
          </div>
          {data.pixels.length ? (
            <div className="pixel-list">
              {data.pixels.map((p) => (
                <section className="panel pixel-card" key={p.id}>
                  <div className="pixel-card-heading">
                    <div>
                      <span className="integration-logo pixel">
                        <Code2 size={22} />
                      </span>
                      <div>
                        <h3>{p.name}</h3>
                        <span>
                          <Globe size={12} />
                          {p.domain}
                        </span>
                      </div>
                      <Badge tone={p.active ? 'green' : 'neutral'}>
                        {p.active ? 'Ativo' : 'Pausado'}
                      </Badge>
                    </div>
                    <div>
                      <button
                        className="button secondary"
                        onClick={async () => {
                          setSelectedPixel(p);
                          setEvents([]);
                          setBusy(true);
                          setModal('events');
                          try {
                            setEvents(await api(`/pixels/${p.id}/events`));
                          } catch (e) {
                            notify((e as Error).message, true);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Activity size={14} />
                        Ver eventos
                      </button>
                      <Toggle
                        checked={Boolean(p.active)}
                        label={`Ativar pixel ${p.name}`}
                        onChange={async () => {
                          try {
                            await mutate(`/pixels/${p.id}`, 'PATCH', { active: !p.active });
                            await load();
                          } catch (e) {
                            notify((e as Error).message, true);
                          }
                        }}
                      />
                      <button
                        className="icon-button"
                        aria-label={`Excluir pixel ${p.name}`}
                        onClick={() => {
                          setDeletion({ id: p.id, kind: 'pixels', name: p.name });
                          setModal('delete');
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="pixel-details">
                    <div>
                      <small>IDENTIFICADOR</small>
                      <code>{p.id}</code>
                    </div>
                    <div>
                      <small>EVENTOS RECEBIDOS</small>
                      <strong>{number(p.events)}</strong>
                    </div>
                    <div>
                      <small>ÚLTIMO EVENTO</small>
                      <strong>
                        {p.last_event ? dateTime(p.last_event) : 'Aguardando instalação'}
                      </strong>
                    </div>
                  </div>
                  <div className="capi-pixel-label">
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelectedPixel(p);
                        setModal('pixel-capi');
                      }}
                    >
                      Configurar CAPI
                      <ArrowRight size={12} />
                    </button>
                    <Badge tone={p.capi_configured ? 'green' : 'neutral'}>
                      {p.capi_configured ? 'CAPI configurada' : 'Somente coleta WeTrack'}
                    </Badge>
                    {p.meta_pixel_id && (
                      <span className="muted capi-meta-id">Pixel Meta: {p.meta_pixel_id}</span>
                    )}
                    {p.test_event_code && (
                      <Badge tone="amber">Modo de teste · {p.test_event_code}</Badge>
                    )}
                  </div>
                  <div className="snippet-label">
                    Instale este código no <code>&lt;head&gt;</code> do seu site:
                  </div>
                  <div className="code-copy">
                    <code>{snippet(p)}</code>
                    <button className="button secondary" onClick={() => void copy(snippet(p))}>
                      <Copy size={13} />
                      Copiar
                    </button>
                  </div>
                  <div className="pixel-tip">
                    <ShieldCheck size={14} />O pixel registra páginas, seções identificadas, cliques
                    e intenção de checkout. Veja o trajeto em Visitas. As UTMs são preservadas por 7
                    dias; sessões expiram após 30 minutos de inatividade.
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="panel">
              <Empty
                icon={<Code2 size={28} />}
                title="Dê visibilidade a cada visita"
                text="Cadastre seu domínio e instale o pixel em uma linha de código."
                action={
                  <button className="button primary" onClick={() => setModal('pixel')}>
                    <Plus size={16} />
                    Criar meu primeiro pixel
                  </button>
                }
              />
            </section>
          )}
          <div className="inline-notice">
            <CircleHelp size={16} />
            Este pixel coleta eventos na WeTrack. O envio CAPI de compras exige um pixel Meta com
            token e a associação da conexão de vendas ao pixel. Instale o script conforme o
            consentimento aplicável ao seu site.
          </div>
        </>
      )}
      {tab === 'UTMs' && (
        <>
          <section className="panel meta-utm-template">
            <div className="panel-heading">
              <div>
                <h2>Padrão para Facebook Ads</h2>
                <p>Pronto para reutilizar em todos os anúncios da sua operação.</p>
              </div>
              <Badge tone="green">Configurado</Badge>
            </div>
            <div className="utm-result">
              <span>PARÂMETROS DE URL DO ANÚNCIO</span>
              <code>{metaUtmTemplate}</code>
              <button className="button primary" onClick={() => void copy(metaUtmTemplate)}>
                <Copy size={15} />
                Copiar padrão Facebook
              </button>
            </div>
            <div className="form-content">
              <p>
                No Gerenciador de Anúncios, abra o anúncio e cole este código no campo{' '}
                <strong>Parâmetros de URL</strong>, na seção de rastreamento. Use o código sem “?” e
                mantenha a URL do site no campo de destino.
              </p>
              <p>
                A Meta preenche os IDs de campanha, conjunto e anúncio quando o anúncio é veiculado.
                Sincronize a estrutura em Meta Ads para a WeTrack reconhecer esses IDs.
              </p>
              <p>
                Instale o pixel WeTrack na página e conecte o webhook do checkout para preservar e
                receber a origem da compra. Se uma venda ficar sem atribuição, abra{' '}
                <strong>Vendas → detalhes do pedido</strong>, confira as UTMs e selecione campanha,
                conjunto e anúncio.
              </p>
              <dl className="sale-utm-values">
                <div>
                  <dt>utm_campaign</dt>
                  <dd>ID da campanha</dd>
                </div>
                <div>
                  <dt>utm_term</dt>
                  <dd>ID do conjunto</dd>
                </div>
                <div>
                  <dt>utm_content</dt>
                  <dd>ID do anúncio</dd>
                </div>
              </dl>
            </div>
          </section>
          <div className="utm-builder-layout">
            <section className="panel utm-builder">
              <div className="panel-heading">
                <div>
                  <h2>O começo de uma boa atribuição</h2>
                  <p>Monte um link e acompanhe a origem das conversões.</p>
                </div>
                <Link2 size={21} className="text-blue" />
              </div>
              <div className="form-content">
                <label>
                  URL da página de destino<span className="field-required">*</span>
                  <input
                    type="url"
                    value={utm.url}
                    onChange={(e) => setUtm((v) => ({ ...v, url: e.target.value }))}
                    placeholder="https://seusite.com.br"
                  />
                </label>
                <div className="form-grid">
                  {[
                    ['source', 'Origem', 'facebook'],
                    ['medium', 'Mídia', 'paid'],
                    ['campaign', 'Campanha', 'lancamento_outubro'],
                    ['content', 'Conteúdo', 'video_depoimento'],
                  ].map(([key, title, placeholder]) => (
                    <label key={key}>
                      {title}
                      <small>utm_{key}</small>
                      <input
                        value={utm[key as keyof typeof utm]}
                        placeholder={placeholder}
                        onChange={(e) => setUtm((v) => ({ ...v, [key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Termo <small>utm_term · opcional</small>
                  <input
                    value={utm.term}
                    placeholder="palavra_chave"
                    onChange={(e) => setUtm((v) => ({ ...v, term: e.target.value }))}
                  />
                </label>
              </div>
              <div className="utm-result">
                <span>SEU LINK RASTREÁVEL</span>
                <code>{utmUrl || 'Informe uma URL válida começando com https:// ou http://'}</code>
                <button
                  className="button primary"
                  disabled={!utmUrl}
                  onClick={() => void copy(utmUrl)}
                >
                  <Copy size={15} />
                  Copiar link
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </section>
            <aside className="panel utm-guide">
              <span className="large-icon">
                <SparkIcon />
              </span>
              <h2>Cada parâmetro conta.</h2>
              <p>Padronize seus links para ler os resultados com facilidade.</p>
              <dl>
                <dt>Origem</dt>
                <dd>De onde veio o clique. Ex.: facebook, google.</dd>
                <dt>Mídia</dt>
                <dd>O tipo de tráfego. Ex.: paid, email, organic.</dd>
                <dt>Campanha</dt>
                <dd>O nome ou ID que conecta o clique à sua campanha.</dd>
                <dt>Conteúdo</dt>
                <dd>Qual anúncio ou criativo gerou a visita.</dd>
              </dl>
              <div className="pixel-tip">
                <CircleHelp size={15} />
                Use o mesmo nome ou ID cadastrado em Campanhas para atribuir as vendas.
              </div>
            </aside>
          </div>
        </>
      )}
      {tab === 'Webhook API' && (
        <>
          <div className="capi-summary">
            <span>
              <ShieldCheck size={16} />
              Compras CAPI
            </span>
            <Badge tone="green">
              {data.capi.find((s) => s.status === 'sent')?.count || 0} confirmada(s) pela Meta
            </Badge>
            <Badge tone="neutral">
              {data.capi.find((s) => s.status === 'pending')?.count || 0} na fila
            </Badge>
            <Badge tone="amber">
              {data.capi.find((s) => s.status === 'failed')?.count || 0} com falha
            </Badge>
            <button
              className="text-button"
              onClick={async () => {
                setModal('capi');
                setBusy(true);
                try {
                  setDeliveries(await api(`/capi?project=${project}`));
                } catch (e) {
                  notify((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ver envios
              <ArrowRight size={13} />
            </button>
          </div>
          <section className="panel webhook-intro">
            <span className="integration-logo webhook">
              <Webhook size={24} />
            </span>
            <div>
              <h2>Suas vendas, direto na WeTrack.</h2>
              <p>
                Conecte Cakto, Hotmart e Blackcat com seus formatos nativos ou use a API
                personalizada. Cada conexão inclui instruções e validação de entrega.
              </p>
            </div>
            <button className="button secondary" onClick={() => setModal('docs')}>
              <BookOpen size={15} />
              Documentação
            </button>
          </section>
          <section className="panel native-platforms-panel">
            <div className="panel-heading">
              <div>
                <h2>Plataformas da operação</h2>
                <p>Configuração, tutorial e histórico de webhooks</p>
              </div>
              <button className="button primary" onClick={() => setModal('platforms')}>
                <Plus size={15} />
                Conectar plataforma
              </button>
            </div>
            <div className="native-platform-grid">
              {(data.providers || []).map((c) => (
                <article className="native-platform-card" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <small>{platformGuides[c.provider].name}</small>
                  </div>
                  <Badge tone={!c.configured ? 'amber' : c.test_mode ? 'blue' : 'green'}>
                    {!c.configured
                      ? 'Falta credencial'
                      : c.test_mode
                        ? 'Modo de teste'
                        : 'Vendas reais liberadas'}
                  </Badge>
                  {c.last_event && (
                    <p className="panel-footnote">
                      Última entrega: {dateTime(c.last_event.received_at)}
                      {c.last_event.last_error ? ` · ${c.last_event.last_error}` : ''}
                    </p>
                  )}
                  <div className="native-platform-actions">
                    <button
                      className="button secondary"
                      onClick={() => setNative({ provider: c.provider, connection: c })}
                    >
                      Configurar
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        setNative({ provider: c.provider, connection: c, tab: 'Tutorial' })
                      }
                    >
                      Tutorial
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        setNative({ provider: c.provider, connection: c, tab: 'Entregas' })
                      }
                    >
                      Entregas
                    </button>
                    <button
                      className="text-button text-red"
                      onClick={() => {
                        setDeletion({ id: c.id, kind: 'tokens', name: c.name });
                        setModal('delete');
                      }}
                    >
                      Revogar
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!(data.providers || []).length && (
              <p className="panel-footnote">
                Escolha Conectar plataforma para gerar a URL e abrir o tutorial.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  API personalizada
                  <span className="count-label">
                    {
                      data.tokens.filter((t) => !(data.providers || []).some((c) => c.id === t.id))
                        .length
                    }
                  </span>
                </h2>
                <p>Tokens para receber pedidos e atualizações de pagamento</p>
              </div>
              <button className="button secondary" onClick={openToken}>
                <Plus size={15} />
                Criar conexão API
              </button>
            </div>
            {data.tokens.some((t) => !(data.providers || []).some((c) => c.id === t.id)) ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Integração</th>
                      <th>Formato</th>
                      <th>Token</th>
                      <th>Status</th>
                      <th>Último pedido</th>
                      <th>Criado em</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokens
                      .filter((t) => !(data.providers || []).some((c) => c.id === t.id))
                      .map((t) => (
                        <tr key={t.id}>
                          <td>
                            <strong>{t.name}</strong>
                          </td>
                          <td>{t.platform}</td>
                          <td>
                            <code>wt_••••{t.token_hint}</code>
                          </td>
                          <td>
                            <Badge>Ativa</Badge>
                          </td>
                          <td>{t.last_used ? dateTime(t.last_used) : 'Aguardando pedido'}</td>
                          <td>{dateTime(t.created_at)}</td>
                          <td>
                            <button
                              className="icon-button text-red"
                              aria-label={`Revogar ${t.name}`}
                              onClick={() => {
                                setDeletion({ id: t.id, kind: 'tokens', name: t.name });
                                setModal('delete');
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={<Webhook size={27} />}
                title="A próxima venda merece ser rastreada"
                text="Crie uma conexão para receber pedidos do seu checkout ou sistema de vendas."
                action={
                  <button className="button secondary" onClick={openToken}>
                    <Plus size={15} />
                    Criar conexão API
                  </button>
                }
              />
            )}
          </section>
        </>
      )}
      {modal === 'pixel' && (
        <Modal
          title="Novo pixel de rastreio"
          subtitle="Conecte as visitas do seu site à sua operação."
          onClose={() => setModal(null)}
        >
          <form onSubmit={(e) => void savePixel(e)}>
            <label>
              Nome do pixel
              <input
                name="name"
                required
                minLength={3}
                maxLength={80}
                placeholder="Ex.: Pixel da loja principal"
              />
            </label>
            <label>
              Domínio autorizado
              <input name="domain" type="url" required placeholder="https://minhaloja.com.br" />
              <small>Inclua https://. O domínio é usado para autorizar os eventos.</small>
            </label>
            <label>
              URL do checkout <small>Opcional · referência para instalação</small>
              <input
                name="checkout_url"
                type="url"
                placeholder="https://minhaloja.com.br/checkout"
              />
            </label>
            <div className="settings-switch">
              <div>
                <strong>Enviar compras para a Meta (CAPI)</strong>
                <p>Configure um pixel oficial e seu token de acesso.</p>
              </div>
              <Toggle
                checked={capiEnabled}
                label="Configurar CAPI"
                onChange={() => setCapiEnabled((v) => !v)}
              />
            </div>
            {capiEnabled && (
              <>
                <label>
                  ID do pixel Meta
                  <input
                    name="meta_pixel_id"
                    required
                    pattern="[0-9]{5,30}"
                    placeholder="123456789012345"
                  />
                </label>
                <label>
                  Token da Conversions API
                  <input
                    name="capi_token"
                    type="password"
                    autoComplete="off"
                    required
                    minLength={15}
                    placeholder="Token gerado no Gerenciador de Eventos"
                  />
                </label>
                <label>
                  Código de evento de teste{' '}
                  <small>Opcional, recomendado na primeira validação</small>
                  <input name="test_event_code" maxLength={100} placeholder="TEST12345" />
                </label>
                <div className="inline-notice">
                  <ShieldCheck size={15} />O token fica criptografado. Associe o pixel à conexão de
                  vendas para enviar compras. META_GRAPH_VERSION deve estar configurada no servidor.
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <Spinner />}Criar pixel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'platforms' && (
        <Modal
          wide
          title="Conectar plataforma"
          subtitle="Escolha como suas vendas chegam até a WeTrack."
          onClose={() => setModal(null)}
        >
          <SearchBox
            value={platformQuery}
            onChange={setPlatformQuery}
            placeholder="Buscar plataforma…"
          />
          <div className="platform-grid">
            {['API personalizada', 'Cakto', 'Hotmart', 'Blackcat']
              .filter((p) => p.toLowerCase().includes(platformQuery.toLowerCase()))
              .map((p, i) => (
                <button
                  className="platform-card available"
                  key={p}
                  onClick={() =>
                    p === 'API personalizada'
                      ? openToken()
                      : (() => {
                          setModal(null);
                          setNative({ provider: p.toLowerCase() as Provider });
                        })()
                  }
                >
                  <span className={`platform-letter platform-color-${i % 4}`}>
                    {p === 'API personalizada' ? <Code2 size={20} /> : p[0]}
                  </span>
                  <div>
                    <strong>{p}</strong>
                    <small>Conectar agora</small>
                  </div>
                  <ArrowRight size={15} />
                </button>
              ))}
          </div>
          <div className="inline-notice">
            <CircleHelp size={16} />
            Os conectores recebem o formato da própria plataforma. Comece em modo de teste e escolha
            quem envia Purchase para evitar compras duplicadas na Meta.
          </div>
        </Modal>
      )}
      {native && (
        <PlatformConnection
          key={`${project}:${native.connection?.id || native.provider}`}
          project={project}
          provider={native.provider}
          initial={native.connection}
          initialTab={native.tab}
          pixels={data.pixels}
          notify={notify}
          onChanged={() => {
            void load();
            onDataChange();
          }}
          onClose={() => {
            setNative(null);
            setTab('Webhook API');
          }}
        />
      )}
      {modal === 'token' && (
        <Modal
          title={newToken ? 'Sua conexão está pronta.' : 'Criar conexão de vendas'}
          subtitle={
            newToken
              ? 'Guarde a URL agora. O token não será exibido novamente.'
              : 'Receba vendas usando o formato da API WeTrack.'
          }
          onClose={() => {
            setModal(null);
            setTab('Webhook API');
          }}
        >
          {newToken ? (
            <>
              <div className="token-success">
                <span>
                  <Check size={27} />
                </span>
                <h3>Um novo caminho para suas vendas.</h3>
                <p>Use esta URL para enviar pedidos por POST.</p>
              </div>
              <div className="code-copy token-url">
                <code>{newToken.url}</code>
                <button
                  className="icon-button"
                  aria-label="Copiar URL do webhook"
                  onClick={() => void copy(newToken.url)}
                >
                  <Copy size={17} />
                </button>
              </div>
              <div className="inline-notice">
                <LockKeyhole size={16} />
                Esta URL permite registrar pedidos. Compartilhe apenas com seu sistema de
                integração.
              </div>
              <button
                className="button primary full-width"
                onClick={() => {
                  setNewToken(null);
                  setModal(null);
                  setTab('Webhook API');
                }}
              >
                Já guardei, continuar
                <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <form onSubmit={(e) => void createToken(e)}>
              <label>
                Nome da integração
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Ex.: Checkout principal"
                />
              </label>
              <label>
                Pixel para enviar compras CAPI
                <select name="pixel_id">
                  <option value="">Somente registrar vendas na WeTrack</option>
                  {data.pixels
                    .filter((p) => p.capi_configured)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <small>Para CAPI, envie customer_email ou customer_phone no pedido.</small>
              </label>
              <div className="format-preview">
                <span>FORMATO DE ENVIO</span>
                <pre>{JSON.stringify(sample, null, 2)}</pre>
              </div>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setModal(null)}>
                  Cancelar
                </button>
                <button className="button primary" disabled={busy}>
                  {busy && <Spinner />}Gerar conexão
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
      {modal === 'oauth' && (
        <Modal
          title="Conectar Meta Ads"
          subtitle="Abra no Multilogin e autorize o perfil que administra suas contas."
          onClose={closeOAuth}
        >
          <div className="meta-modal-logo">∞</div>
          {data.meta.oauth.configured ? (
            <>
              <p className="modal-description">
                Copie o link para abrir no Multilogin ou continue com o Facebook neste navegador. O
                link vale por 15 minutos e permite uma autorização.
              </p>
              {!oauthLink ? (
                <button
                  className="button primary full-width"
                  disabled={busy}
                  onClick={() => void prepareOAuth()}
                >
                  {busy ? <Spinner /> : <Link2 size={16} />}
                  {busy ? 'Preparando link de conexão…' : 'Tentar gerar link novamente'}
                </button>
              ) : (
                <>
                  <label>
                    Link de autorização
                    <input readOnly value={oauthLink.url} onFocus={(e) => e.target.select()} />
                  </label>
                  <p className="muted">
                    Válido até {dateTime(oauthLink.expires_at)}. Compartilhe apenas com quem
                    administrará esta operação.
                  </p>
                  <div className="oauth-connect-actions">
                    <button className="button primary" onClick={() => void copy(oauthLink.url)}>
                      <Copy size={15} />
                      Copiar link de conexão
                    </button>
                    <a
                      className="button secondary"
                      href={oauthLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Conectar com Facebook <ArrowUpRight size={15} />
                    </a>
                  </div>
                </>
              )}
              <p className="panel-footnote">
                Depois de autorizar, volte à WeTrack, atualize a lista e selecione as contas que
                deseja sincronizar.
              </p>
            </>
          ) : (
            <>
              <Badge tone="amber">Preparado · aguardando configuração</Badge>
              <p className="modal-description">
                O fluxo por link está implementado. Para o Facebook exibir “WeTrack quer se
                conectar”, configure um aplicativo Meta com esse nome e hospede a WeTrack em um
                endereço HTTPS público.
              </p>
              <div className="meta-requirements">
                <h3>Configuração no servidor</h3>
                <p>
                  <code>PUBLIC_URL</code> — endereço HTTPS da WeTrack
                </p>
                <p>
                  <code>META_APP_ID</code> e <code>META_APP_SECRET</code> — credenciais do
                  aplicativo
                </p>
                <p>
                  <code>META_LOGIN_CONFIG_ID</code> — configuração do Login para Empresas, se
                  utilizada
                </p>
                <p>
                  Cadastre o retorno OAuth no aplicativo:{' '}
                  <code>https://seu-dominio/api/meta/oauth/callback</code>. Configure a permissão{' '}
                  <code>ads_read</code> e os acessos exigidos pela Meta.
                </p>
              </div>
              <p className="panel-footnote">
                A instalação local permanece preparada. O token do pixel/CAPI é independente da
                autorização para ler contas de anúncios.
              </p>
            </>
          )}
          <details className="meta-manual-option">
            <summary>Conexão manual · avançado</summary>
            <p>Use um token com acesso às contas de anúncios. A CAPI é configurada no pixel.</p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                closeOAuth();
                setModal('meta');
              }}
            >
              Informar token de anúncios
            </button>
          </details>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                await load();
                onDataChange();
                closeOAuth();
              }}
            >
              Concluí, atualizar contas
            </button>
          </div>
        </Modal>
      )}
      {modal === 'meta' && (
        <Modal
          title="Conectar Meta Ads por token"
          subtitle="Alternativa avançada para autorizar suas contas de anúncios."
          onClose={() => setModal(null)}
        >
          <div className="meta-modal-logo">∞</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const access_token = new FormData(e.currentTarget).get('access_token');
              setBusy(true);
              try {
                const result = await mutate<{ skipped: number }>('/meta/connect', 'POST', {
                  project_id: project,
                  access_token,
                });
                await load();
                setModal(null);
                setTab('Meta Ads');
                notify(
                  `Perfil conectado. Selecione as contas que deseja incluir.${result.skipped ? ` ${result.skipped} conta(s) usam outra moeda e não podem ser ativadas nesta versão.` : ''}`,
                );
              } catch (e) {
                notify((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Token de acesso às contas de anúncios
              <input
                name="access_token"
                type="password"
                autoComplete="off"
                required
                minLength={15}
                placeholder="Token de usuário ou usuário do sistema"
              />
            </label>
            <div className="meta-requirements">
              <h3>Antes de conectar</h3>
              {[
                'Gere o token no ambiente oficial da Meta',
                'Conceda ads_read e ads_management e acesso às suas contas de anúncios',
                'Configure META_GRAPH_VERSION no arquivo .env',
                'A gestão de anúncios permite alterações nas contas em BRL selecionadas',
              ].map((t) => (
                <div key={t}>
                  <span className="requirement-dot" />
                  {t}
                </div>
              ))}
            </div>
            {!data.meta.configured && (
              <div className="inline-notice">
                <CircleHelp size={16} />
                Defina META_GRAPH_VERSION no servidor e reinicie a API antes de conectar.
              </div>
            )}
            <div className="inline-notice">
              <ShieldCheck size={16} />O token é criptografado no servidor. Nunca informe sua senha
              do Facebook. A conexão por link está disponível quando o aplicativo Meta e o domínio
              HTTPS estiverem configurados.
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy || !data.meta.configured}>
                {busy && <Spinner />}Validar e conectar
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'pixel-capi' && selectedPixel && (
        <Modal
          title={`CAPI · ${selectedPixel.name}`}
          subtitle="Configure ou substitua o token da Conversions API."
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              try {
                await mutate(`/pixels/${selectedPixel.id}/capi`, 'PUT', form);
                await load();
                setModal(null);
                notify('CAPI configurada. Associe este pixel a uma conexão de vendas.');
              } catch (e) {
                notify((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              ID do pixel Meta
              <input
                name="meta_pixel_id"
                defaultValue={selectedPixel.meta_pixel_id || ''}
                pattern="[0-9]{5,30}"
                required
                placeholder="123456789012345"
              />
            </label>
            <label>
              Token CAPI
              <input name="capi_token" type="password" autoComplete="off" required minLength={15} />
            </label>
            <label>
              Código de evento de teste
              <input
                name="test_event_code"
                defaultValue={selectedPixel.test_event_code || ''}
                maxLength={100}
                placeholder="Opcional · TEST12345"
              />
            </label>
            <div className="inline-notice">
              <ShieldCheck size={16} />
              Os segredos ficam criptografados no servidor. META_GRAPH_VERSION precisa estar
              configurada. Informe código de teste para validar sem atribuir conversões de produção.
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <Spinner />}Salvar CAPI
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'capi' && (
        <Modal
          wide
          title="Envios para a Meta"
          subtitle="Os últimos 50 eventos. Confirmação significa recebimento pela API, não uma nota de qualidade."
          onClose={() => setModal(null)}
        >
          {busy ? (
            <div className="loading-page">
              <Spinner />
            </div>
          ) : deliveries.length ? (
            <div className="delivery-list">
              {deliveries.map((d) => (
                <div key={d.id}>
                  <div>
                    <strong>{d.pixel_name}</strong>
                    <small>
                      {dateTime(d.created_at)} · {d.attempts} tentativa(s)
                    </small>
                    {d.last_error && <p>{d.last_error}</p>}
                  </div>
                  <Badge
                    tone={d.status === 'sent' ? 'green' : d.status === 'failed' ? 'red' : 'neutral'}
                  >
                    {d.status === 'sent'
                      ? 'Confirmado'
                      : d.status === 'failed'
                        ? 'Falha'
                        : 'Na fila'}
                  </Badge>
                  {d.status === 'failed' && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await mutate(`/capi/${d.id}/retry`, 'POST');
                          setDeliveries(await api(`/capi?project=${project}`));
                          await load();
                          notify('Evento reenfileirado para a próxima tentativa.');
                        } catch (e) {
                          notify((e as Error).message, true);
                        }
                      }}
                    >
                      Tentar novamente
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<ShieldCheck size={27} />}
              title="Os próximos envios aparecerão aqui"
              text="Associe um pixel com CAPI configurada a uma conexão de vendas."
            />
          )}
        </Modal>
      )}
      {modal === 'events' && (
        <Modal
          wide
          title={`Eventos · ${selectedPixel?.name}`}
          subtitle="Os 15 eventos mais recentes recebidos pela WeTrack."
          onClose={() => setModal(null)}
        >
          {busy ? (
            <div className="loading-page">
              <Spinner />
            </div>
          ) : events.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Página</th>
                    <th>Origem</th>
                    <th>Recebido em</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={i}>
                      <td>
                        <Badge tone="blue">{e.event_name}</Badge>
                      </td>
                      <td className="event-url">{e.page_url}</td>
                      <td>{e.utm_source}</td>
                      <td>{dateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={<Activity size={25} />}
              title="Aguardando o primeiro evento"
              text="Instale o script e visite o domínio cadastrado. Os eventos aparecerão aqui."
            />
          )}
          <button
            className="button secondary full-width"
            onClick={async () => {
              if (selectedPixel) {
                setBusy(true);
                try {
                  setEvents(await api(`/pixels/${selectedPixel.id}/events`));
                } catch (e) {
                  notify((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }
            }}
          >
            Atualizar eventos
          </button>
        </Modal>
      )}
      {modal === 'delete' && deletion && (
        <Modal
          title={deletion.kind === 'pixels' ? 'Excluir pixel?' : 'Revogar conexão?'}
          subtitle={deletion.name}
          onClose={() => setModal(null)}
        >
          <p className="modal-description">
            {deletion.kind === 'pixels'
              ? 'O pixel e seu histórico de eventos serão excluídos. O script instalado deixará de coletar visitas.'
              : 'Novos pedidos enviados com este token serão recusados. As vendas já registradas serão preservadas.'}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await mutate(`/${deletion.kind}/${deletion.id}`, 'DELETE');
                  setModal(null);
                  await load();
                  notify('Exclusão concluída.');
                } catch (e) {
                  notify((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />}
              {deletion.kind === 'pixels' ? 'Excluir pixel' : 'Revogar token'}
            </button>
          </div>
        </Modal>
      )}
      {modal === 'docs' && (
        <Modal
          wide
          title="API WeTrack"
          subtitle="Conecte pedidos do seu checkout com uma requisição HTTP."
          onClose={() => setModal(null)}
        >
          <div className="docs-content">
            <div className="endpoint">
              <Badge tone="blue">POST</Badge>
              <code>/api/webhooks/SEU_TOKEN</code>
            </div>
            <p>
              Envie JSON com <code>Content-Type: application/json</code>. O valor de{' '}
              <code>amount</code> é em reais (97 = R$ 97,00). Cada pedido é identificado por{' '}
              <code>order_id</code> dentro da integração.
            </p>
            <div className="format-preview">
              <pre>{JSON.stringify(sample, null, 2)}</pre>
              <button
                className="button secondary"
                onClick={() => void copy(JSON.stringify(sample, null, 2))}
              >
                <Copy size={13} />
                Copiar exemplo
              </button>
            </div>
            <h3>Status aceitos</h3>
            <div className="docs-status">
              <code>approved</code>
              <code>pending</code>
              <code>refunded</code>
              <code>chargeback</code>
            </div>
            <p>
              Reenviar o mesmo pedido atualiza o valor e status, sem duplicar a venda. Use{' '}
              <code>utm_campaign</code> com o nome ou ID de uma campanha cadastrada. Para recuperar
              um clique pago dos últimos sete dias, envie <code>visitor_id</code> igual ao valor de{' '}
              <code>window.WeTrack.visitorId</code>.
            </p>
            <h3>Eventos no navegador</h3>
            <div className="format-preview">
              <pre>{`window.WeTrack.track('InitiateCheckout');\nwindow.WeTrack.track('Purchase');`}</pre>
            </div>
            <p>
              O pixel envia PageView automaticamente. Eventos Purchase do navegador não geram
              faturamento: apenas vendas confirmadas pelo webhook entram na receita.
            </p>
            <div className="inline-notice">
              <CircleHelp size={16} />O envio CAPI é opcional: configure o pixel Meta, associe-o ao
              token e envie os identificadores do comprador. Para instalar em outro site, configure
              PUBLIC_URL com o endereço HTTPS público do servidor.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function SparkIcon() {
  return <Zap size={27} />;
}

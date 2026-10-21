import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Globe,
  MousePointer2,
  Route,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { api, brl, dateTime, decimal, number, sourceName } from './lib';
import { Badge, Empty, Modal, SearchBox, Spinner } from './components';
import type { Dashboard, Journey, Visitor } from './types';

const labels: Record<string, string> = {
  PageView: 'Visitou a página',
  ViewContent: 'Visualizou conteúdo',
  SectionView: 'Visualizou uma seção',
  Click: 'Clicou em um link',
  InitiateCheckout: 'Clicou para iniciar checkout (IC)',
  Purchase: 'Evento Purchase do navegador',
  PageExit: 'Saiu da página',
  PageReturn: 'Voltou à página/aba',
  CheckoutReturn: 'Voltou após clique no checkout',
  ScrollDepth: 'Rolou a página',
  AddToCart: 'Adicionou ao carrinho',
  AddPaymentInfo: 'Informou pagamento',
  AddToWishlist: 'Adicionou à lista de desejos',
  Lead: 'Lead confirmado',
  Contact: 'Contato confirmado',
  WhatsAppClick: 'Clicou no WhatsApp',
  FormSubmit: 'Tentou enviar formulário',
  CompleteRegistration: 'Concluiu cadastro',
  Schedule: 'Agendamento registrado',
  Subscribe: 'Assinatura registrada',
  StartTrial: 'Iniciou teste',
  VideoPlay: 'Reproduziu vídeo',
  VideoProgress: 'Avançou no vídeo',
  VideoComplete: 'Concluiu vídeo',
  LinkClick: 'Abriu smart link',
};
const durationLabel = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}min ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
};
const pathLabel = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname + decodeURI(u.pathname);
  } catch {
    return url;
  }
};
export default function VisitorsPage({
  data,
  onConnect,
}: {
  data: Dashboard;
  onConnect: () => void;
}) {
  const [tab, setTab] = useState('visitors'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const [result, setResult] = useState<{ visitors: Visitor[]; total: number; size: number }>({
    visitors: [],
    total: 0,
    size: 20,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null),
    [journey, setJourney] = useState<Journey | null>(null),
    [journeyError, setJourneyError] = useState('');
  const generation = useRef(0);
  const project = data.project.id,
    start = data.start,
    end = data.end;
  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [project, start, end, query]);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ project, start, end, q: query, page: String(page) });
      api<typeof result>(`/visitors?${params}`)
        .then((r) => {
          if (version === generation.current) setResult(r);
        })
        .catch((e) => {
          if (version === generation.current) setError(e.message);
        })
        .finally(() => {
          if (version === generation.current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [project, start, end, query, page, revision]);
  useEffect(() => {
    let valid = true;
    setJourney(null);
    setJourneyError('');
    if (!selected) return;
    const params = new URLSearchParams({ project, start, end });
    api<Journey>(`/visitors/${encodeURIComponent(selected)}?${params}`)
      .then((r) => {
        if (valid) setJourney(r);
      })
      .catch((e) => {
        if (valid) setJourneyError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [selected, project, start, end]);
  const pages = Math.max(1, Math.ceil(result.total / result.size));
  return (
    <>
      <div className="visits-summary">
        {[
          { icon: Users, title: 'Visitantes únicos', value: number(data.metrics.visits) },
          { icon: MousePointer2, title: 'Cliques em anúncios', value: number(data.metrics.clicks) },
          { icon: ShoppingBag, title: 'Vendas aprovadas', value: number(data.metrics.sales) },
          {
            icon: Route,
            title: 'Taxa de conversão',
            value: decimal(data.metrics.conversion, 1) + '%',
          },
        ].map((m) => (
          <article className="metric-card" key={m.title}>
            <m.icon size={20} />
            <span>{m.title}</span>
            <strong>{m.value}</strong>
          </article>
        ))}
      </div>
      <section className="panel visitors-panel">
        <div className="panel-heading">
          <div>
            <h2>Jornada dos visitantes</h2>
            <p>Veja o caminho, o tempo na página, a rolagem e os retornos de cada visitante</p>
          </div>
          <div className="segmented small">
            <button
              className={tab === 'visitors' ? 'selected' : ''}
              onClick={() => setTab('visitors')}
            >
              Visitantes
            </button>
            <button className={tab === 'pages' ? 'selected' : ''} onClick={() => setTab('pages')}>
              Páginas
            </button>
          </div>
        </div>
        {tab === 'visitors' ? (
          <>
            <div className="table-toolbar">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Buscar visitante, página ou origem…"
              />
              <span className="muted">{number(result.total)} visitantes no período</span>
            </div>
            {error ? (
              <div className="error-panel">
                <p>{error}</p>
                <button className="button secondary" onClick={() => setRevision((v) => v + 1)}>
                  Tentar novamente
                </button>
              </div>
            ) : loading ? (
              <div className="loading-page">
                <Spinner />
                <p>Carregando visitantes…</p>
              </div>
            ) : result.visitors.length ? (
              <div className="table-scroll">
                <table className="data-table visitor-table">
                  <thead>
                    <tr>
                      <th>Visitante</th>
                      <th>Origem</th>
                      <th>Páginas</th>
                      <th>Sessões</th>
                      <th>Última atividade</th>
                      <th>Checkout</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.visitors.map((v) => (
                      <tr key={v.visitor_id}>
                        <td>
                          <button className="entity-link" onClick={() => setSelected(v.visitor_id)}>
                            <span className="visitor-avatar">
                              <Users size={16} />
                            </span>
                            <strong title={v.visitor_id}>{v.visitor_id.slice(0, 14)}</strong>
                          </button>
                          <small>Primeira visita no período: {dateTime(v.first_seen)}</small>
                        </td>
                        <td>{sourceName(v.source)}</td>
                        <td>{v.pages}</td>
                        <td>{v.sessions || '—'}</td>
                        <td>{dateTime(v.last_seen)}</td>
                        <td>
                          <Badge tone={v.checkout ? 'blue' : 'neutral'}>
                            {v.checkout ? 'Iniciado' : 'Não registrado'}
                          </Badge>
                        </td>
                        <td>
                          <button className="text-button" onClick={() => setSelected(v.visitor_id)}>
                            Ver trajeto <ChevronRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={<Route size={27} />}
                title={query ? 'Nenhum visitante encontrado' : 'Aguardando os primeiros visitantes'}
                text={
                  query
                    ? 'Experimente outra busca.'
                    : 'Instale o pixel atualizado no site para registrar os trajetos a partir de agora.'
                }
                action={
                  !query ? (
                    <button className="button primary" onClick={onConnect}>
                      Configurar pixel <ArrowRight size={15} />
                    </button>
                  ) : undefined
                }
              />
            )}
            <div className="visitor-pagination">
              <span className="muted">
                Página {page} de {pages}
              </span>
              <div>
                <button
                  className="button secondary"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </button>
                <button
                  className="button secondary"
                  disabled={loading || page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        ) : data.pages.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Página</th>
                  <th>Visualizações</th>
                  <th>Visitantes</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((p) => (
                  <tr key={p.page_url}>
                    <td>
                      <span className="page-url">
                        <Globe size={15} />
                        {p.page_url}
                      </span>
                    </td>
                    <td>{number(p.views)}</td>
                    <td>{number(p.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Globe size={26} />}
            title="Nenhuma página registrada"
            text="As páginas visitadas aparecerão aqui depois da instalação do pixel."
          />
        )}
        <p className="panel-footnote">
          O histórico depende do pixel em cada site. Um clique para o checkout registra intenção; a
          volta após esse clique é identificada no seu site. O tempo ativo é estimado e pausa após
          60 segundos sem interação ou com a aba oculta. A venda é confirmada pelo webhook.
          Bloqueios do navegador e troca de dispositivo podem separar visitantes.
        </p>
      </section>
      {selected && (
        <Modal
          wide
          title="Trajeto do visitante"
          subtitle={selected}
          onClose={() => setSelected(null)}
        >
          {journeyError ? (
            <p className="text-red" role="alert">
              {journeyError}
            </p>
          ) : !journey ? (
            <div className="loading-page">
              <Spinner />
              <p>Carregando trajeto…</p>
            </div>
          ) : (
            <>
              <div className="journey-summary">
                <Badge tone="blue">{sourceName(journey.events[0].utm_source)}</Badge>
                <span>{journey.events.length} eventos no período</span>
                <span>
                  <Clock3 size={14} /> Brasília
                </span>
              </div>
              <ol className="journey-timeline">
                {journey.events.map((event, i) => {
                  const newSession =
                    i === 0 || event.session_id !== journey.events[i - 1].session_id;
                  return (
                    <li key={event.id} className={newSession ? 'session-start' : ''}>
                      {newSession && (
                        <div className="journey-session">
                          {event.session_id
                            ? `Sessão ${event.session_id.slice(0, 10)}`
                            : 'Sessão não identificada'}{' '}
                          · {dateTime(event.occurred_at || event.created_at)}
                        </div>
                      )}
                      <div
                        className={`journey-event ${event.event_name === 'InitiateCheckout' ? 'checkout-event' : ''}`}
                      >
                        <span className="journey-dot">
                          {event.event_name === 'InitiateCheckout' ? (
                            <ShoppingBag size={15} />
                          ) : (
                            <MousePointer2 size={15} />
                          )}
                        </span>
                        <div>
                          <strong>{labels[event.event_name] || event.event_name}</strong>
                          <p>{event.page_title || pathLabel(event.page_url)}</p>
                          <small className="journey-url">{pathLabel(event.page_url)}</small>
                          {event.channel && (
                            <small>
                              Coleta:{' '}
                              {(
                                {
                                  browser: 'pixel',
                                  server: 'API / CRM',
                                  manual: 'manual',
                                  smart_link: 'smart link',
                                } as Record<string, string>
                              )[event.channel] || event.channel}
                            </small>
                          )}
                          {(event.content_name || event.content_id) && (
                            <p className="journey-detail">
                              Conteúdo: {event.content_name || event.content_id}
                            </p>
                          )}
                          {event.value != null && (
                            <p className="journey-detail">
                              Valor do evento: {brl(event.value, event.currency || 'BRL')} (não compõe
                              faturamento)
                            </p>
                          )}
                          {event.first_source && (
                            <p className="journey-detail">
                              Primeira origem: {sourceName(event.first_source)}
                              {event.first_campaign ? ` · ${event.first_campaign}` : ''}
                            </p>
                          )}
                          {event.click_ids && event.click_ids !== '{}' && (
                            <details>
                              <summary>Identificadores de clique</summary>
                              <small className="journey-url">{event.click_ids}</small>
                            </details>
                          )}
                          {event.event_name === 'PageView' && event.duration_ms != null && (
                            <p className="journey-detail">
                              Tempo visível: {durationLabel(event.duration_ms)} · Ativo estimado:{' '}
                              {durationLabel(event.active_ms || 0)} · Rolagem:{' '}
                              {event.scroll_depth || 0}%
                            </p>
                          )}
                          {event.event_name === 'PageView' && event.duration_ms == null && (
                            <small>Tempo e rolagem indisponíveis nesta visita.</small>
                          )}
                          {event.event_name === 'CheckoutReturn' && event.away_ms != null && (
                            <p className="journey-detail">
                              Retorno {durationLabel(event.away_ms)} após o clique no checkout.
                            </p>
                          )}
                          {event.section && (
                            <p className="journey-detail">
                              {event.event_name === 'ScrollDepth' ? 'Rolagem' : 'Seção'}:{' '}
                              {event.section}
                            </p>
                          )}
                          {event.target_url && (
                            <p className="journey-detail">Destino: {pathLabel(event.target_url)}</p>
                          )}
                          {i === 0 && event.referrer && (
                            <p className="journey-detail">
                              Referência: {pathLabel(event.referrer)}
                            </p>
                          )}
                          {event.event_name === 'Purchase' && (
                            <small>Evento do navegador; não confirma uma venda.</small>
                          )}
                        </div>
                        <time dateTime={event.occurred_at || event.created_at}>
                          {dateTime(event.occurred_at || event.created_at)}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {journey.limited && (
                <p className="inline-notice">
                  Exibindo os primeiros 500 eventos. Selecione um período menor para detalhar.
                </p>
              )}
              <div className="journey-sales">
                <h3>
                  <ShoppingBag size={16} /> Pedidos vinculados pelo webhook
                </h3>
                {journey.sales.length ? (
                  journey.sales.map((s) => (
                    <div key={s.id}>
                      <div>
                        <strong>{s.product}</strong>
                        <small>
                          {s.external_id} · {dateTime(s.created_at)}
                        </small>
                      </div>
                      <Badge tone={s.status === 'approved' ? 'green' : 'amber'}>
                        {s.status === 'approved'
                          ? 'Aprovada'
                          : s.status === 'pending'
                            ? 'Pendente'
                            : s.status === 'refunded'
                              ? 'Reembolsada'
                              : 'Chargeback'}
                      </Badge>
                      <b>{brl(s.amount, s.currency)}</b>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Nenhum pedido com este visitor_id no período. A integração de vendas precisa
                    enviar o identificador para vincular a compra.
                  </p>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

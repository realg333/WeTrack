import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Copy, Link2, Plus, RefreshCw } from 'lucide-react';
import { api, dateTime, localDay, mutate, number } from './lib';
import { Badge, Empty, Modal, Spinner, Toggle } from './components';
import type { Toast } from './types';

type Tracking = {
  events: {
    event_name: string;
    channel: string;
    count: number;
    visitors: number;
    last_seen: string;
  }[];
  links: {
    id: string;
    name: string;
    destination: string;
    event_name: string;
    active: number;
    url: string;
  }[];
  pixels: {
    id: string;
    name: string;
    domain: string;
    active: number;
    capi_events: number;
    capi_configured: number;
  }[];
  start: string;
  end: string;
};
const events = [
  'Lead',
  'Contact',
  'CompleteRegistration',
  'ViewContent',
  'AddToCart',
  'AddToWishlist',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Search',
  'Schedule',
  'Subscribe',
  'StartTrial',
  'SubmitApplication',
  'Donate',
  'CustomizeProduct',
  'FindLocation',
];
const channels: Record<string, string> = {
  browser: 'Pixel do site',
  server: 'API / CRM',
  manual: 'Manual',
  smart_link: 'Smart link',
  whatsapp: 'WhatsApp oficial',
};
export default function TrackingCenter({ project, notify }: { project: string; notify: Toast }) {
  const [data, setData] = useState<Tracking | null>(null),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0),
    [modal, setModal] = useState<'link' | 'event' | null>(null);
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  const [eventName, setEventName] = useState('Lead');
  useEffect(() => {
    let live = true;
    setError('');
    setData(null);
    setModal(null);
    const end = new Date(),
      start = new Date();
    start.setDate(start.getDate() - 29);
    api<Tracking>(
      `/tracking?${new URLSearchParams({ project, start: localDay(start), end: localDay(end) })}`,
    )
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [project, revision]);
  const reload = () => setRevision((v) => v + 1);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify('Copiado.');
    } catch {
      notify('Não foi possível copiar. Selecione o texto do link.', true);
    }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (modal === 'link') await mutate('/smart-links', 'POST', { ...form, project_id: project });
      else
        await mutate('/tracking/events', 'POST', {
          ...form,
          project_id: project,
          event_id: crypto.randomUUID(),
          event_name: eventName === 'custom' ? form.custom_event : eventName,
          send_capi: form.send_capi === 'on',
          ...(form.value !== '' ? { value: Number(form.value) } : { value: undefined }),
        });
      notify(modal === 'link' ? 'Smart link criado.' : 'Evento registrado.');
      setModal(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
  if (!data)
    return (
      <div className="loading-page">
        <Spinner />
      </div>
    );
  const activePixels = data.pixels.filter((p) => p.active);
  return (
    <div className="tracking-center">
      <section className="panel tracking-intro">
        <div>
          <span className="eyebrow">DO CLIQUE À CONVERSÃO</span>
          <h2>Central de rastreamento</h2>
          <p>Site, comércio, leads, WhatsApp e eventos do seu CRM na mesma operação.</p>
          <p className="muted">
            Atividade dos últimos 30 dias · {data.start.split('-').reverse().join('/')} a{' '}
            {data.end.split('-').reverse().join('/')}
          </p>
        </div>
        <button className="button secondary" onClick={reload}>
          <RefreshCw size={14} />
          Atualizar
        </button>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Eventos recebidos</h3>
            <p className="muted">Contagem real por evento e origem de coleta.</p>
          </div>
          <button
            className="button secondary"
            disabled={!activePixels.length}
            onClick={() => {
              setFormError('');
              setModal('event');
            }}
          >
            <Plus size={14} />
            Registrar evento
          </button>
        </div>
        {data.events.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Coleta</th>
                  <th>Eventos</th>
                  <th>Visitantes</th>
                  <th>Último recebimento</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={`${e.channel}:${e.event_name}`}>
                    <td>
                      <strong>{e.event_name}</strong>
                    </td>
                    <td>{channels[e.channel] || e.channel}</td>
                    <td>{number(e.count)}</td>
                    <td>{number(e.visitors)}</td>
                    <td>{dateTime(e.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Activity size={24} />}
            title="Aguardando eventos"
            text="Cadastre um pixel, instale o script no site ou envie eventos pela API."
          />
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Smart links e WhatsApp</h3>
            <p className="muted">
              Preserve UTMs e associe um código à jornada até o atendimento ou checkout.
            </p>
          </div>
          <button
            className="button primary"
            disabled={!activePixels.length}
            onClick={() => {
              setFormError('');
              setModal('link');
            }}
          >
            <Plus size={14} />
            Criar smart link
          </button>
        </div>
        {data.links.length ? (
          <div className="tracking-links">
            {data.links.map((l) => (
              <article key={l.id}>
                <div>
                  <strong>{l.name}</strong>
                  <small>
                    {l.event_name} · {l.destination}
                  </small>
                  <code>{l.url}</code>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Copiar link ${l.name}`}
                  onClick={() => void copy(l.url)}
                >
                  <Copy size={16} />
                </button>
                <Toggle
                  checked={Boolean(l.active)}
                  label={`Ativar link ${l.name}`}
                  onChange={async () => {
                    try {
                      await mutate(`/smart-links/${l.id}`, 'PATCH', {
                        project_id: project,
                        active: !l.active,
                      });
                      reload();
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                />
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={<Link2 size={23} />}
            title="Nenhum smart link"
            text="Crie um link para o site, checkout ou WhatsApp. É necessário cadastrar um pixel ativo primeiro."
          />
        )}
        <p className="panel-footnote">
          O clique no WhatsApp não confirma conversa. O link acrescenta uma referência à mensagem;
          seu CRM deve preservá-la e devolver o evento ou venda pela API. O redirecionamento pode
          registrar acessos de robôs e prévias de links.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>CAPI para o funil do site</h3>
            <p className="muted">
              Envio opcional dos eventos padrão. Compras continuam vindo do webhook aprovado.
            </p>
          </div>
        </div>
        {data.pixels.map((p) => (
          <div className="tracking-pixel" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>{p.domain}</small>
              <Badge tone={p.capi_configured ? 'green' : 'gray'}>
                {p.capi_configured ? 'CAPI configurada' : 'Configure a CAPI na aba Pixel'}
              </Badge>
            </div>
            <Toggle
              checked={Boolean(p.capi_events)}
              disabled={!p.capi_configured || !p.active}
              label={`Enviar funil CAPI de ${p.name}`}
              onChange={async () => {
                try {
                  await mutate(`/pixels/${p.id}/tracking`, 'PUT', {
                    project_id: project,
                    capi_events: !p.capi_events,
                  });
                  reload();
                } catch (e) {
                  notify((e as Error).message, true);
                }
              }}
            />
          </div>
        ))}
        <p className="panel-footnote">
          Ative quando a WeTrack for responsável pelo envio desses eventos. Se outro pixel já envia
          o mesmo evento à Meta, use o mesmo event_id para deduplicação ou desative o envio
          duplicado. Recebimento da API não comprova atribuição nem qualidade de correspondência.
        </p>
      </section>
      <section className="panel tracking-guide">
        <div className="panel-heading">
          <div>
            <h3>Instrumentar sua jornada</h3>
            <p className="muted">O script instalado recebe as melhorias automaticamente.</p>
          </div>
        </div>
        <details open>
          <summary>Comércio e eventos personalizados</summary>
          <p>
            Dispare após confirmar a ação. O retorno é o ID para deduplicação. Purchase no navegador
            registra apenas um evento; faturamento exige webhook de venda.
          </p>
          <pre>{`const eventId = window.WeTrack.track('AddToCart', {\n  value: 97, content_id: 'curso-01', content_name: 'Curso'\n});\nwindow.WeTrack.track('Lead'); // após confirmar o cadastro\nwindow.WeTrack.track('MinhaConversao', { value: 97 });`}</pre>
        </details>
        <details>
          <summary>Formulários, botões e vídeo</summary>
          <p>
            Marque os elementos que deseja acompanhar. FormSubmit registra a tentativa de envio e
            não lê nenhum campo. Confirme Lead no retorno de sucesso do seu formulário. Vídeos
            incorporados em iframe exigem integração com o player.
          </p>
          <pre>{`<form data-wetrack-form="contato">...</form>\n<button data-wetrack-event="AddToCart"\n  data-wetrack-content-id="curso-01" data-wetrack-value="97">Adicionar</button>\n<video data-wetrack-video="apresentacao" controls src="video.mp4"></video>`}</pre>
        </details>
        <details>
          <summary>API de eventos para CRM e conversões offline</summary>
          <p>
            Use um token da aba Webhook API no seu servidor. Envie um event_id estável e o
            visitor_id original para relacionar a jornada. Não exponha o token no site. Eventos
            personalizados também podem ser enviados à CAPI com send_capi: true.
          </p>
          <pre>{`POST /api/track-events\nAuthorization: Bearer SEU_TOKEN\nContent-Type: application/json\n\n${JSON.stringify({ pixel_id: activePixels[0]?.id || 'px_SEU_ID', event_id: 'crm-lead-1001', visitor_id: 'ID_ORIGINAL_DO_VISITANTE', event_name: 'Contact', utm_source: 'facebook', utm_campaign: 'ID_DA_CAMPANHA', utm_term: 'ID_DO_CONJUNTO', utm_content: 'ID_DO_ANUNCIO', send_capi: false }, null, 2)}`}</pre>
          <p>
            Compras, reembolsos e chargebacks devem usar a API de vendas e seus conectores. Cada
            cobrança recorrente usa um order_id único.
          </p>
        </details>
        <details>
          <summary>Receber vendas no formato UTMify</summary>
          <p>
            Seu checkout ou adaptador pode enviar o formato de pedidos UTMify para o endereço
            abaixo, usando um token WeTrack da API personalizada no cabeçalho x-api-token. O
            endereço de envio precisa ser configurável na plataforma de origem.
          </p>
          <pre>{`POST ${window.location.origin}/api/compat/utmify\nx-api-token: SEU_TOKEN_WETRACK`}</pre>
          <p>
            Aceita pedidos em BRL, valores em centavos, produtos, UTMs e status waiting_payment,
            paid, refused, refunded e chargedback. isTest: true valida o pedido sem gerar receita.
            Datas sem fuso seguem UTC. A receita usa totalPriceInCents; taxas e comissões não são
            descontadas do lucro sobre mídia.
          </p>
          <p>
            Envie attribution_code no webhook de vendas ou na API de eventos para recuperar o código
            [wt...] da mensagem de WhatsApp. O formato compatível também aceita esse código em
            trackingParameters.sck ou src. A integração não conecta sua conta UTMify nem importa seu
            histórico.
          </p>
        </details>
        <details>
          <summary>Origem, click IDs e limites de atribuição</summary>
          <p>
            O pixel preserva o último clique por 7 dias e a primeira origem por 30 dias para
            consulta, além de UTMs, fbclid, gclid, ttclid, msclkid, gbraid, wbraid e kwai_click_id.
            A atribuição financeira continua usando a última origem disponível em 7 dias; a primeira
            origem não altera os relatórios.
          </p>
          <p>
            Os identificadores de clique de outras redes são armazenados e propagados; envio de
            conversões para Google, TikTok e Kwai depende dos conectores dessas redes. Não há
            sincronização entre dispositivos. Instale o script após o consentimento aplicável.
            Conversas do WhatsApp exigem que o seu CRM devolva os eventos; não há leitura automática
            de mensagens.
          </p>
        </details>
      </section>
      {modal && (
        <Modal
          title={modal === 'link' ? 'Criar smart link' : 'Registrar evento'}
          subtitle={
            modal === 'event'
              ? 'Use o identificador original do visitante para manter a atribuição.'
              : 'O destino fica fixo e somente as UTMs são propagadas.'
          }
          onClose={() => setModal(null)}
        >
          <form onSubmit={submit}>
            <label>
              Pixel
              <select name="pixel_id" aria-label="Pixel" required>
                {activePixels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {modal === 'link' ? (
              <>
                <label>
                  Nome
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="WhatsApp · Consultoria"
                  />
                </label>
                <label>
                  URL de destino
                  <input
                    name="destination"
                    type="url"
                    required
                    maxLength={2000}
                    placeholder="https://wa.me/5511999999999?text=Olá"
                  />
                </label>
                <label>
                  Evento de clique
                  <select name="event_name" aria-label="Evento de clique">
                    <option value="WhatsAppClick">Clique no WhatsApp</option>
                    <option value="LinkClick">Clique no link</option>
                    <option value="InitiateCheckout">Intenção de checkout</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Evento
                  <select
                    aria-label="Evento"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                  >
                    {events.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                    <option value="custom">Personalizado</option>
                  </select>
                </label>
                {eventName === 'custom' && (
                  <label>
                    Nome personalizado
                    <input
                      name="custom_event"
                      required
                      pattern="[A-Za-z][A-Za-z0-9_]{1,63}"
                      placeholder="MinhaConversao"
                    />
                  </label>
                )}
                <label>
                  ID original do visitante
                  <input name="visitor_id" required minLength={8} maxLength={100} />
                </label>
                <label>
                  Campanha (ID ou nome único)
                  <input name="utm_campaign" maxLength={200} />
                </label>
                <label>
                  Origem
                  <input name="utm_source" maxLength={100} defaultValue="direct" />
                </label>
                <label>
                  Valor do evento em R$ (opcional)
                  <input name="value" type="number" min="0" max="10000000" step="0.01" />
                </label>
                <label className="check-label">
                  <input type="checkbox" name="send_capi" />
                  Enviar à CAPI se configurada
                </label>
                <p className="muted">O valor é uma propriedade do evento e não gera faturamento.</p>
              </>
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
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, RefreshCw } from 'lucide-react';
import { api, dateTime, mutate } from './lib';
import { Badge, Modal, Spinner } from './components';
import { platformGuides, purchaseGuidance, type Provider } from './platform-guides';
import type { Pixel, PlatformConnectionData, PlatformReceipt, Toast } from './types';

const receiptStatus: Record<string, string> = {
  pending: 'Na fila',
  processing: 'Processando',
  processed: 'Processada',
  test: 'Teste validado',
  ignored: 'Ignorada',
  failed: 'Falha',
};
export default function PlatformConnection({
  project,
  provider,
  initial,
  initialTab = 'Configuração',
  pixels,
  notify,
  onChanged,
  onClose,
}: {
  project: string;
  provider: Provider;
  initial?: PlatformConnectionData;
  initialTab?: string;
  pixels: Pixel[];
  notify: Toast;
  onChanged: () => void;
  onClose: () => void;
}) {
  const guide = platformGuides[provider];
  const [connection, setConnection] = useState(initial);
  const [tab, setTab] = useState(initialTab),
    [name, setName] = useState(initial?.name || (guide.name as string));
  const [secret, setSecret] = useState(''),
    [testMode, setTestMode] = useState(initial?.test_mode ?? true);
  const [owner, setOwner] = useState(initial?.purchase_owner || 'checkout'),
    [pixel, setPixel] = useState(initial?.pixel_id || '');
  const [receipts, setReceipts] = useState<PlatformReceipt[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [ackOwner, setAckOwner] = useState(false),
    [ackLive, setAckLive] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  async function loadReceipts(id: string) {
    setBusy(true);
    setError('');
    try {
      setReceipts(
        await api(`/platform-connections/${id}/receipts?project=${encodeURIComponent(project)}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (tab === 'Entregas' && connection) void loadReceipts(connection.id);
  }, [tab, connection?.id]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(connection!.url);
      notify('URL copiada. Cole no webhook da plataforma.');
    } catch {
      notify('Selecione a URL e copie manualmente.', true);
    }
  }
  return (
    <Modal
      wide
      title={`${guide.name} · Conexão de vendas`}
      subtitle="Configure o recebimento e acompanhe cada entrega nesta operação."
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
    >
      <div className="integration-tabs" role="tablist" aria-label="Configuração da plataforma">
        {['Configuração', 'Tutorial', 'Entregas'].map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'selected' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Configuração' && (
        <>
          {connection && (
            <div className="platform-webhook-url">
              <label>
                URL do webhook
                <input
                  aria-label="URL do webhook da plataforma"
                  value={connection.url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button className="button secondary" onClick={() => void copy()}>
                <Copy size={15} />
                Copiar URL
              </button>
            </div>
          )}
          <form
            className="platform-config-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                if (!connection) {
                  const created = await mutate<PlatformConnectionData>(
                    '/platform-connections',
                    'POST',
                    { project_id: project, provider, name },
                  );
                  setConnection(created);
                  onChanged();
                  notify(
                    'URL criada em modo de teste. Agora configure a credencial da plataforma.',
                  );
                } else {
                  const saved = await mutate<PlatformConnectionData>(
                    `/platform-connections/${connection.id}`,
                    'PATCH',
                    {
                      project_id: project,
                      name,
                      ...(secret ? { secret } : {}),
                      test_mode: testMode,
                      purchase_owner: owner,
                      pixel_id: owner === 'wetrack' ? pixel : '',
                      confirm_purchase_owner: ackOwner,
                      confirm_live: ackLive,
                    },
                  );
                  setConnection(saved);
                  setSecret('');
                  onChanged();
                  notify(
                    testMode
                      ? 'Configuração salva em modo de teste.'
                      : 'Recebimento de vendas reais liberado.',
                  );
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nome da conexão
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
              />
            </label>
            {connection && (
              <>
                <label>
                  {guide.credential}
                  <input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={1000}
                    required={!connection.configured}
                    placeholder={
                      connection.configured
                        ? 'Credencial salva · deixe vazio para manter'
                        : 'Cole a credencial da plataforma'
                    }
                  />
                  <small>{guide.credentialHint}</small>
                </label>
                <label className="platform-check">
                  <input
                    type="checkbox"
                    checked={testMode}
                    onChange={(e) => {
                      setTestMode(e.target.checked);
                      setAckLive(false);
                    }}
                  />
                  <span>
                    Modo de teste: validar entregas sem registrar vendas nem enviar Purchase.
                  </span>
                </label>
                {!testMode && (
                  <label className="platform-check">
                    <input
                      type="checkbox"
                      checked={ackLive}
                      onChange={(e) => setAckLive(e.target.checked)}
                      required
                    />
                    <span>
                      Conferi uma entrega de teste e quero liberar vendas reais nesta operação.
                    </span>
                  </label>
                )}
                <label>
                  Responsável pelo Purchase na Meta
                  <select
                    value={owner}
                    onChange={(e) => {
                      setOwner(e.target.value as 'checkout' | 'wetrack');
                      setAckOwner(false);
                    }}
                  >
                    <option value="checkout">
                      Checkout / outra integração · WeTrack registra as vendas
                    </option>
                    <option value="wetrack">WeTrack · enviar compras pela CAPI</option>
                  </select>
                </label>
                <p className="panel-footnote">{purchaseGuidance}</p>
                {owner === 'wetrack' && (
                  <>
                    <label>
                      Pixel para enviar compras
                      <select value={pixel} onChange={(e) => setPixel(e.target.value)} required>
                        <option value="">Selecione um pixel com CAPI</option>
                        {pixels
                          .filter((p) => p.capi_configured)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                              {p.test_event_code ? ' · CAPI em teste' : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    {pixels.find((p) => p.id === pixel)?.test_event_code && (
                      <p className="inline-notice">
                        Este pixel possui código de teste da Meta. A CAPI continuará enviando para
                        Eventos de teste até esse código ser removido em Configurar CAPI.
                      </p>
                    )}
                    <label className="platform-check">
                      <input
                        type="checkbox"
                        checked={ackOwner}
                        onChange={(e) => setAckOwner(e.target.checked)}
                        required
                      />
                      <span>
                        Desativei o envio de Purchase do checkout e de outros rastreadores para este
                        mesmo pixel e estas compras.
                      </span>
                    </label>
                  </>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-red">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setTab('Tutorial')}
              >
                <BookOpen size={15} />
                Ver tutorial
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <Spinner />}
                {connection ? 'Salvar configuração' : 'Gerar URL de conexão'}
              </button>
            </div>
          </form>
        </>
      )}
      {tab === 'Tutorial' && (
        <div className="platform-tutorial">
          <a className="button secondary" href={guide.panel} target="_blank" rel="noreferrer">
            Abrir {provider === 'blackcat' ? 'documentação Blackcat' : `painel ${guide.name}`} ↗
          </a>
          <ol>
            {guide.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <h3>Atribuição de campanhas</h3>
          <p>{guide.attribution}</p>
          <h3>Pixel, CAPI e compras duplicadas</h3>
          <p>{purchaseGuidance}</p>
          <h3>Como as vendas são contadas</h3>
          <p>{guide.notes}</p>
          <p className="panel-footnote">
            O webhook passa a receber eventos após o cadastro na plataforma. Não há importação
            automática de todo o histórico anterior. Webhook recebido é confirmado após gravação
            durável; a venda só aparece depois da validação e do processamento.
          </p>
          <h3>Documentação oficial</h3>
          <ul>
            {guide.sources.map(([label, url]) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {label} ↗
                </a>
              </li>
            ))}
          </ul>
          <a
            href="https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events"
            target="_blank"
            rel="noreferrer"
          >
            Deduplicação de eventos na Meta ↗
          </a>
          <p className="panel-footnote">
            Revisado em 18/10/2026. Menus e contratos das plataformas podem mudar.
          </p>
        </div>
      )}
      {tab === 'Entregas' && (
        <>
          {connection ? (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void loadReceipts(connection.id)}
              >
                <RefreshCw size={15} />
                Atualizar entregas
              </button>
              {provider === 'blackcat' && (
                <button
                  className="button secondary"
                  disabled={busy || !connection.configured}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const result = await mutate<{ queued: number }>(
                        `/platform-connections/${connection.id}/reconcile`,
                        'POST',
                        { project_id: project },
                      );
                      notify(
                        `${result.queued} transação(ões) agendada(s) para conferência na Blackcat.`,
                      );
                      await loadReceipts(connection.id);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Conferir últimas 20 transações
                </button>
              )}
              <p className="panel-footnote">
                Últimas 50 entregas registradas. Segredos e dados do comprador não são exibidos
                neste histórico.
              </p>
              {busy && <Spinner />}
              {error && (
                <p role="alert" className="text-red">
                  {error}
                </p>
              )}
              {!busy && !receipts.length && (
                <p>Nenhuma entrega recebida. Configure a URL e envie o teste pela plataforma.</p>
              )}
              <div className="platform-deliveries">
                {receipts.map((r) => (
                  <article key={r.id}>
                    <div>
                      <strong>{r.event_name}</strong>
                      <small>
                        {dateTime(r.received_at)} · {r.attempts} tentativa(s)
                      </small>
                      {r.last_error && <p>{r.last_error}</p>}
                    </div>
                    <Badge
                      tone={
                        r.status === 'failed'
                          ? 'red'
                          : r.status === 'test' || r.status === 'processed'
                            ? 'green'
                            : 'neutral'
                      }
                    >
                      {receiptStatus[r.status] || r.status}
                    </Badge>
                    {r.can_retry && ['pending', 'failed'].includes(r.status) ? (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await mutate(`/platform-receipts/${r.id}/retry`, 'POST', {
                              project_id: project,
                            });
                            await loadReceipts(connection.id);
                            notify('Nova tentativa agendada.');
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Tentar novamente
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p>Gere uma URL na aba Configuração para acompanhar as entregas.</p>
          )}
        </>
      )}
    </Modal>
  );
}

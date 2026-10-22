import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal, Spinner } from './components';
import { mutate } from './lib';

export type WhatsAppSignupConfig = {
  configured: boolean;
  app_id?: string;
  config_id?: string;
  graph_version?: string;
  session_info_version?: string;
  feature_type?: string;
  webhook_url?: string;
  verify_token?: string;
};
type FacebookSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>,
  ) => void;
};
const facebookWindow = window as Window & { FB?: FacebookSdk };
let sdkPromise: Promise<FacebookSdk> | undefined;
function loadSdk(config: WhatsAppSignupConfig) {
  if (!sdkPromise)
    sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
      const failed = () => {
        clearInterval(poll);
        clearTimeout(timeout);
        document.getElementById('wetrack-facebook-sdk')?.remove();
        reject(new Error('Não foi possível carregar a Meta. Confira a conexão e tente novamente.'));
      };
      const initialize = () => {
        if (!facebookWindow.FB) return;
        clearInterval(poll);
        clearTimeout(timeout);
        try {
          facebookWindow.FB.init({
            appId: config.app_id,
            version: config.graph_version,
            xfbml: false,
            autoLogAppEvents: false,
          });
          resolve(facebookWindow.FB);
        } catch {
          failed();
        }
      };
      const poll = setInterval(initialize, 100);
      const timeout = setTimeout(failed, 15000);
      if (facebookWindow.FB) {
        initialize();
        return;
      }
      if (!document.getElementById('wetrack-facebook-sdk')) {
        const script = document.createElement('script');
        script.id = 'wetrack-facebook-sdk';
        script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
        script.async = true;
        script.defer = true;
        script.onload = initialize;
        script.onerror = failed;
        document.head.append(script);
      }
      initialize();
    }).catch((error) => {
      sdkPromise = undefined;
      throw error;
    });
  return sdkPromise;
}

export default function WhatsAppSignup({
  config,
  project,
  pixels,
  onClose,
  onConnected,
}: {
  config: WhatsAppSignupConfig;
  project: string;
  pixels: { id: string; name: string }[];
  onClose: () => void;
  onConnected: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [session, setSession] = useState<{ nonce: string; expires_at: string } | null>(null);
  const alive = useRef(true),
    cleanup = useRef<() => void>(() => {}),
    sdk = useRef<FacebookSdk | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cleanup.current();
    };
  }, []);
  async function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const [facebook, prepared] = await Promise.all([
        loadSdk(config),
        mutate<{ nonce: string; expires_at: string }>('/whatsapp/onboarding/session', 'POST', {
          ...form,
          project_id: project,
        }),
      ]);
      if (!alive.current) return;
      sdk.current = facebook;
      setSession(prepared);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function launch() {
    if (!sdk.current || !session) return;
    if (Date.parse(session.expires_at) <= Date.now()) {
      setSession(null);
      setError('A preparação expirou. Prepare a conexão novamente.');
      return;
    }
    cleanup.current();
    setBusy(true);
    setError('');
    let stopped = false,
      exchanged = false,
      completing = false;
    let ids: { waba_id: string; phone_number_id: string } | null = null;
    const finish = (message?: string) => {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('message', receive);
      clearTimeout(timeout);
      if (message && alive.current) {
        setError(message);
        setBusy(false);
        setSession(null);
      }
    };
    const complete = async () => {
      if (!exchanged || !ids || stopped || completing) return;
      completing = true;
      try {
        const result = await mutate<{ id: string }>('/whatsapp/onboarding/complete', 'POST', {
          project_id: project,
          nonce: session.nonce,
          ...ids,
        });
        if (stopped || !alive.current) return;
        finish();
        onConnected(result.id);
      } catch (e) {
        finish((e as Error).message);
      }
    };
    function receive(event: MessageEvent) {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      let payload = event.data;
      try {
        if (typeof payload === 'string') {
          if (payload.length > 16000) return;
          payload = JSON.parse(payload);
        }
      } catch {
        return;
      }
      if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP' || stopped) return;
      if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
        finish('A autorização foi cancelada ou recusada pela Meta. Você pode tentar novamente.');
        return;
      }
      if (payload.event === 'FINISH') {
        finish(
          'Selecione o fluxo de WhatsApp Business com coexistência para manter o atendimento no celular.',
        );
        return;
      }
      if (payload.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') return;
      const { waba_id, phone_number_id } = payload.data || {};
      if (!/^\d{5,30}$/.test(waba_id || '') || !/^\d{5,30}$/.test(phone_number_id || '')) return;
      ids = { waba_id, phone_number_id };
      void complete();
    }
    window.addEventListener('message', receive);
    const timeout = setTimeout(
      () => finish('O tempo de autorização acabou. Prepare a conexão e tente novamente.'),
      Math.min(540000, Date.parse(session.expires_at) - Date.now()),
    );
    cleanup.current = () => finish();
    try {
      // Keep this call inside the click event so browsers can open Meta's popup.
      sdk.current.login(
        (response) => {
          if (stopped) return;
          const code = response.authResponse?.code;
          if (!code) {
            finish(
              'A Meta não autorizou a conexão. Confira a janela de autorização e tente novamente.',
            );
            return;
          }
          // Codes expire quickly: exchange now, even if session logging has not arrived yet.
          void mutate('/whatsapp/onboarding/exchange', 'POST', {
            project_id: project,
            nonce: session.nonce,
            code,
          }).then(
            () => {
              exchanged = true;
              void complete();
            },
            (e: Error) => finish(e.message),
          );
        },
        {
          config_id: config.config_id,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: config.feature_type,
            sessionInfoVersion: config.session_info_version,
          },
        },
      );
    } catch {
      finish('Não foi possível abrir a Meta. Permita pop-ups e prepare a conexão novamente.');
    }
  }
  return (
    <Modal
      title="Conectar WhatsApp com a Meta"
      subtitle="Autorize sua empresa e escolha o número Business no ambiente da Meta."
      onClose={onClose}
    >
      {session ? (
        <div>
          <p className="inline-notice">
            Mantenha o aplicativo WhatsApp Business por perto para confirmar o número. A conexão
            começa em teste; depois você confere as entregas e ativa a coleta real.
          </p>
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setSession(null)}>
              Voltar
            </button>
            <button className="button primary" disabled={busy} onClick={launch}>
              {busy && <Spinner />}
              {busy ? 'Aguardando autorização…' : 'Continuar com a Meta'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={prepare}>
          <label>
            Nome da conexão
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              placeholder="Atendimento principal"
            />
          </label>
          <label>
            Pixel da operação
            <select name="pixel_id" required>
              {pixels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="inline-notice">
            A disponibilidade da coexistência depende da Meta e do seu número. Nenhuma conversa
            antiga será contada como um novo contato ou uma nova venda.
          </p>
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              {busy && <Spinner />}Preparar conexão
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

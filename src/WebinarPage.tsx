import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api, mutate, dateTime } from './lib';
import { Badge, Empty, Modal, Pagination, SearchBox, Spinner } from './components';
import type { Dashboard } from './types';

type Person = {
  id: string;
  name: string;
  email: string;
  phone: string;
  webinar_id: string;
  watched_sec: number;
  returns: number;
  purchased: number;
  sends: number;
  last_seen: string;
};
type Result = {
  people: Person[];
  total: number;
  size: number;
  connections: { id: string; active: number; last_used: string | null; token_hint: string }[];
};
type Journey = {
  person: Person;
  events: {
    id: string;
    event: string;
    occurred_at: string;
    sec: number;
    details: {
      dispatch?: { trigger: string; status: string };
      purchase?: { status: string; transaction: string };
    };
  }[];
  orders: { transaction_id: string; status: string }[];
};
const labels: Record<string, string> = {
  registered: 'Inscreveu-se',
  confirmed: 'Confirmou presença',
  opened: 'Abriu a sala',
  joined: 'Entrou na aula',
  left: 'Saiu da aula',
  rejoined: 'Voltou à aula',
  completed: 'Concluiu a aula',
  noshow: 'Não entrou',
  offer: 'Clicou na oferta',
  offer_reached: 'Assistiu à oferta',
  watch_progress: 'Tempo assistido atualizado',
  timeline_sent: 'Mensagem da aula enviada',
  recovery_sent: 'Recuperação enviada',
  recovery_failed: 'Falha no envio',
  recovery_uncertain: 'Envio sem confirmação',
  member_access_sent: 'Link da área de membros enviado',
  member_accessed: 'Acessou a área de membros',
  purchase: 'Compra Hotmart',
};
const duration = (s: number) => `${Math.floor(s / 60)}min ${s % 60}s`;
export default function WebinarPage({ data }: { data: Dashboard }) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<{ token: string; url: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [journey, setJourney] = useState<Journey | null>(null),
    [journeyError, setJourneyError] = useState('');
  const project = data.project.id;
  useEffect(() => {
    let active = true;
    setError('');
    setResult(null);
    const params = new URLSearchParams({
      project,
      start: data.start,
      end: data.end,
      q,
      page: String(page),
    });
    api<Result>(`/webinar?${params}`)
      .then((v) => {
        if (active) setResult(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project, data.start, data.end, q, page, revision]);
  useEffect(() => {
    let active = true;
    setJourney(null);
    setJourneyError('');
    if (selected)
      api<Journey>(`/webinar/people/${selected}?project=${encodeURIComponent(project)}`)
        .then((v) => {
          if (active) setJourney(v);
        })
        .catch((e) => {
          if (active) setJourneyError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected, project]);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      setConnection(await mutate('/webinar/connections', 'POST', { project_id: project }));
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Webinar Meet</h2>
            <p>
              Presença, disparos e compra reunidos por e-mail. O tempo considera todas as sessões
              registradas.
            </p>
          </div>
          <button
            className="button primary"
            disabled={busy || !!data.project.demo}
            onClick={connect}
          >
            {busy ? 'Conectando…' : 'Criar conexão'}
          </button>
        </div>
        {result?.connections.map((c) => (
          <p className="panel-footnote" key={c.id}>
            Conexão …{c.token_hint} · {c.active ? 'Ativa' : 'Revogada'} ·{' '}
            {c.last_used ? `Último evento ${dateTime(c.last_used)}` : 'Aguardando eventos'}{' '}
            {c.active === 1 && (
              <button
                className="button"
                onClick={async () => {
                  try {
                    await mutate(`/tokens/${c.id}`, 'DELETE');
                    setRevision((v) => v + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Revogar
              </button>
            )}
          </p>
        ))}
      </section>
      {error && <p role="alert">{error}</p>}
      <section className="panel">
        <div className="table-toolbar">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Buscar nome ou e-mail"
          />
          <button className="button" onClick={() => setRevision((v) => v + 1)}>
            Atualizar
          </button>
        </div>
        {!result && !error ? (
          <Spinner />
        ) : !result?.people.length ? (
          <Empty
            icon={<Radio />}
            title="Aguardando participantes"
            text="Conecte o Webinar Meet para acompanhar os eventos da aula nesta operação."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Participante</th>
                    <th>Tempo assistido</th>
                    <th>Retornos</th>
                    <th>Disparos</th>
                    <th>Compra</th>
                    <th>Último evento</th>
                  </tr>
                </thead>
                <tbody>
                  {result.people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <button className="button" onClick={() => setSelected(p.id)}>
                          {p.name || p.email}
                        </button>
                        <small className="muted">{p.email}</small>
                      </td>
                      <td>{duration(p.watched_sec)}</td>
                      <td>{p.returns}</td>
                      <td>{p.sends}</td>
                      <td>
                        <Badge tone={p.purchased ? 'green' : 'neutral'}>
                          {p.purchased ? 'Aprovada' : 'Sem compra aprovada'}
                        </Badge>
                      </td>
                      <td>{dateTime(p.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={result.total} size={20} onChange={setPage} />
          </>
        )}
      </section>
      {connection && (
        <Modal
          title="Conectar o Webinar Meet"
          subtitle="Guarde o token: ele é exibido somente agora."
          onClose={() => setConnection(null)}
        >
          <label>
            WETRACK_WEBHOOK_URL
            <input readOnly value={connection.url} />
          </label>
          <label>
            WETRACK_TOKEN
            <input readOnly value={connection.token} />
          </label>
          <p>
            Configure essas duas variáveis no servidor do Webinar Meet. O envio começa após
            reiniciar o serviço.
          </p>
        </Modal>
      )}
      {selected && (
        <Modal
          wide
          title={journey?.person.name || 'Histórico do participante'}
          subtitle={journey?.person.email}
          onClose={() => setSelected(null)}
        >
          {journeyError ? (
            <p role="alert">{journeyError}</p>
          ) : !journey ? (
            <Spinner />
          ) : (
            <>
              <p>
                Telefone: {journey.person.phone || 'Não informado'} · Webinar:{' '}
                {journey.person.webinar_id}
              </p>
              {journey.orders.map((o) => (
                <p key={o.transaction_id}>
                  Hotmart {o.transaction_id}: {o.status}
                </p>
              ))}
              <p>Histórico completo deste participante, em ordem de ocorrência.</p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Evento</th>
                      <th>Posição na aula</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journey.events.map((e) => (
                      <tr key={e.id}>
                        <td>{dateTime(e.occurred_at)}</td>
                        <td>{labels[e.event] || e.event}</td>
                        <td>{duration(e.sec)}</td>
                        <td>{e.details.purchase?.status || e.details.dispatch?.trigger || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

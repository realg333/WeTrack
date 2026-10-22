import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Layers3, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { Modal, Spinner } from './components';
import { mutate } from './lib';
import type { Project, Toast } from './types';

export default function WorkspacesDialog({
  mode,
  projects,
  current,
  onClose,
  onSaved,
  onSelect,
  notify,
}: {
  mode: 'create' | 'manage';
  projects: Project[];
  current: string;
  onClose: () => void;
  onSaved: (project: Project, created: boolean) => void;
  onSelect: (id: string) => void;
  notify: Toast;
}) {
  const [creating, setCreating] = useState(mode === 'create');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [reuseMeta, setReuseMeta] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const source = projects.find((p) => p.id === current && !p.demo);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await mutate<Project>(
        editing ? `/projects/${editing.id}` : '/projects',
        editing ? 'PATCH' : 'POST',
        {
          name: name.trim(),
          ...(!editing && reuseMeta && source ? { reuse_meta_from: source.id } : {}),
        },
      );
      onSaved(result, !editing);
      notify(
        editing
          ? 'Nome do workspace atualizado.'
          : 'Workspace criado. Seu dashboard começa do zero.',
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={editing ? 'Renomear workspace' : creating ? 'Criar workspace' : 'Seus workspaces'}
      subtitle="Cada operação tem seu próprio dashboard, vendas e rastreamento."
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
    >
      {creating || editing ? (
        <form onSubmit={save}>
          <label>
            Nome do workspace
            <input
              autoFocus
              required
              minLength={2}
              maxLength={80}
              value={name}
              placeholder="Ex.: Minha nova operação"
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          {!editing && (
            <>
              <div className="workspace-isolation">
                <ShieldCheck size={21} />
                <div>
                  <strong>Uma operação nova, com dados zerados</strong>
                  <p>
                    Vendas, campanhas, visitas, regras e taxas começam do zero. O histórico dos
                    outros workspaces fica preservado.
                  </p>
                </div>
              </div>
              {source && (
                <label className="workspace-reuse">
                  <input
                    type="checkbox"
                    checked={reuseMeta}
                    onChange={(e) => setReuseMeta(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    Reutilizar autorização Meta de {source.name}
                    <small>
                      Se houver uma conexão, as contas ficam disponíveis, todas desativadas. Ative
                      só as que pertencem à nova operação ou conecte outro perfil.
                    </small>
                  </span>
                </label>
              )}
              <p className="workspace-hint">
                Pixels e webhooks têm identificadores próprios em cada workspace. Configure-os em
                Integrações para receber dados no lugar certo.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-red">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary" disabled={busy || name.trim().length < 2}>
              {busy ? <Spinner /> : editing ? <Check size={15} /> : <Plus size={15} />}
              {editing ? 'Salvar nome' : 'Criar workspace'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <input
            aria-label="Buscar workspaces"
            placeholder="Buscar workspaces…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="workspace-directory">
            {projects
              .filter((p) =>
                p.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')),
              )
              .map((p) => (
                <div className="workspace-directory-row" key={p.id}>
                  <span className="workspace-avatar">
                    <Layers3 size={18} />
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.demo
                        ? 'Demonstração'
                        : p.id === current
                          ? 'Workspace atual'
                          : 'Operação independente'}
                    </small>
                  </div>
                  {p.id === current ? (
                    <Check size={17} className="text-green" />
                  ) : (
                    <button
                      className="icon-button"
                      aria-label={`Abrir ${p.name}`}
                      onClick={() => {
                        onSelect(p.id);
                        onClose();
                      }}
                    >
                      <ArrowRight size={17} />
                    </button>
                  )}
                  {!p.demo && (
                    <button
                      className="icon-button"
                      aria-label={`Renomear ${p.name}`}
                      onClick={() => {
                        setEditing(p);
                        setName(p.name);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
              ))}
            {!projects.some((p) =>
              p.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')),
            ) && <p className="workspace-hint">Nenhum workspace encontrado.</p>}
          </div>
          <div className="modal-actions">
            <button className="button primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              Novo workspace
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

import { useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Modal, SearchBox } from './components';
import { columns, templates } from './report-columns';

export type ColumnConfig = { selected: string[]; presets: { name: string; columns: string[] }[] };
export default function ColumnPicker({
  config,
  onSave,
  onClose,
}: {
  config: ColumnConfig;
  onSave: (v: ColumnConfig) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config.selected);
  const [presets, setPresets] = useState(config.presets);
  const [query, setQuery] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const toggle = (id: string) =>
    setDraft((v) => (v.includes(id) ? v.filter((k) => k !== id) : [...v, id]));
  const move = (index: number, delta: number) =>
    setDraft((v) => {
      const next = [...v];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  return (
    <Modal
      title="Personalizar colunas"
      subtitle="Escolha as métricas e a ordem para campanhas, conjuntos e anúncios."
      wide
      onClose={onClose}
    >
      <div className="column-templates">
        {Object.entries(templates).map(([label, ids]) => (
          <button key={label} className="button secondary" onClick={() => setDraft(ids)}>
            {label}
          </button>
        ))}
      </div>
      {presets.length > 0 && (
        <div className="column-templates">
          {presets.map((p) => (
            <span className="column-preset" key={p.name}>
              <button className="text-button" onClick={() => setDraft(p.columns)}>
                {p.name}
              </button>
              <button
                className="icon-button"
                aria-label={`Excluir modelo ${p.name}`}
                onClick={() => setPresets((v) => v.filter((x) => x.name !== p.name))}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="column-picker-grid">
        <div className="column-catalog">
          <SearchBox value={query} onChange={setQuery} placeholder="Buscar métrica ou fórmula…" />
          {[...new Set(columns.map((c) => c.group))].map((group) => {
            const items = columns.filter(
              (c) =>
                c.group === group &&
                `${c.label} ${c.description}`
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
            );
            return items.length ? (
              <section key={group}>
                <h3>{group}</h3>
                {items.map((c) => (
                  <label className="column-option" key={c.id}>
                    <input
                      type="checkbox"
                      checked={draft.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span>
                      <strong>{c.label}</strong>
                      <small>{c.description}</small>
                    </span>
                  </label>
                ))}
              </section>
            ) : null;
          })}
        </div>
        <div className="column-selection">
          <h3>{draft.length} colunas selecionadas</h3>
          <p className="muted">Status, nome e ações ficam fixos.</p>
          <ol>
            {draft.map((id, i) => (
              <li key={id}>
                <span>{columns.find((c) => c.id === id)?.label}</span>
                <button
                  className="icon-button"
                  disabled={!i}
                  aria-label={`Mover ${columns.find((c) => c.id === id)?.label} para cima`}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  disabled={i === draft.length - 1}
                  aria-label={`Mover ${columns.find((c) => c.id === id)?.label} para baixo`}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remover ${columns.find((c) => c.id === id)?.label}`}
                  onClick={() => toggle(id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="column-save-model">
        <label>
          Salvar como modelo
          <input
            value={name}
            maxLength={50}
            placeholder="Ex.: Minha análise diária"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={!name.trim() || !draft.length || presets.length >= 20}
          onClick={() => {
            setPresets((v) => [
              ...v.filter((p) => p.name !== name.trim()),
              { name: name.trim(), columns: draft },
            ]);
            setName('');
          }}
        >
          Salvar modelo
        </button>
      </div>
      <p className="panel-footnote">
        — indica ausência de dados ou divisão sem denominador. Métricas Meta exigem sincronização.
        As taxas do total são recalculadas; visitantes podem aparecer em mais de uma entidade.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="button primary"
          disabled={busy || !draft.length}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onSave({ selected: draft, presets });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Aplicar colunas
        </button>
      </div>
    </Modal>
  );
}

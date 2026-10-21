import { useEffect, useState } from 'react';
import { api, brl, mutate } from './lib';
import { Modal, Spinner } from './components';

type Entity = {
  name: string;
  account_id: string;
  account_name: string;
  currency: string;
  external_id: string;
  status: string;
  effective_status: string;
  active: boolean;
  editable: boolean;
  budget_type: 'daily' | 'lifetime' | 'inherited' | 'none';
  budget: number;
  can_edit_budget: boolean;
  revision: string;
};
const statusName = (status: string) =>
  ({
    ACTIVE: 'Ativo',
    PAUSED: 'Pausado',
    CAMPAIGN_PAUSED: 'Campanha pausada',
    ADSET_PAUSED: 'Conjunto pausado',
    PENDING_REVIEW: 'Em análise',
    WITH_ISSUES: 'Com pendências',
    DISAPPROVED: 'Reprovado',
  })[status] || status;

export default function MetaEntityEditor({
  project,
  level,
  id,
  desiredActive,
  onClose,
  onSaved,
}: {
  project: string;
  level: 'campaigns' | 'adsets' | 'ads';
  id: string;
  desiredActive?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [name, setName] = useState(''),
    [active, setActive] = useState(false),
    [budget, setBudget] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setEntity(null);
    setError('');
    api<Entity>(
      `/meta/entities/${level}/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
    )
      .then((result) => {
        if (!current) return;
        setEntity(result);
        setName(result.name);
        setActive(desiredActive ?? result.active);
        setBudget(String(result.budget));
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [project, level, id, desiredActive, revision]);
  const changed =
    entity &&
    (name.trim() !== entity.name ||
      active !== entity.active ||
      (entity.can_edit_budget && Number(budget) !== entity.budget));
  return (
    <Modal
      title="Editar na Meta"
      subtitle="Confira a conta e os valores antes de confirmar a alteração."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {!entity && !error && (
        <div className="loading-page">
          <Spinner />
          <p>Consultando os valores atuais na Meta…</p>
        </div>
      )}
      {entity && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const changes: { name?: string; active?: boolean; budget?: number } = {};
              if (name.trim() !== entity.name) changes.name = name.trim();
              if (active !== entity.active) changes.active = active;
              if (entity.can_edit_budget && Number(budget) !== entity.budget)
                changes.budget = Number(budget);
              const result = await mutate<{ confirmed: boolean }>(
                `/meta/entities/${level}/${encodeURIComponent(id)}`,
                'PATCH',
                { project_id: project, expected_revision: entity.revision, ...changes },
              );
              if (!result.confirmed)
                throw new Error('Atualize o item para conferir o resultado na Meta.');
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="inline-notice">
            <div>
              <strong>{entity.account_name}</strong>
              <br />
              Conta {entity.account_id} · {entity.currency || 'BRL'} · Item {entity.external_id}
            </div>
          </div>
          <fieldset disabled={busy || !entity.editable} className="meta-edit-fields">
            <label>
              Nome
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </label>
            <label>
              Status
              <select value={String(active)} onChange={(e) => setActive(e.target.value === 'true')}>
                <option value="true">Ativo</option>
                <option value="false">Pausado</option>
              </select>
            </label>
            <p className="panel-footnote">
              Veiculação atual na Meta: {statusName(entity.effective_status)}. A veiculação também
              depende da campanha, do conjunto e da aprovação do anúncio.
            </p>
            {entity.can_edit_budget && (
              <label>
                {entity.budget_type === 'daily' ? 'Orçamento diário' : 'Orçamento total'} (
                {entity.currency === 'USD' ? 'US$' : 'R$'})
                <input
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
                <small>
                  Atual: {brl(entity.budget, entity.currency)} ·{' '}
                  {entity.budget_type === 'daily' ? 'por dia' : 'total do período'}
                </small>
              </label>
            )}
            {entity.budget_type === 'inherited' && (
              <p className="panel-footnote">
                {level === 'campaigns'
                  ? 'Esta campanha utiliza orçamento nos conjuntos. Abra o conjunto para editar o valor.'
                  : 'O orçamento deste conjunto é gerido pela campanha. Abra a campanha para editar o valor.'}
              </p>
            )}
            <label className="meta-edit-confirm">
              <input type="checkbox" required />
              Conferi a conta e confirmo as alterações na Meta.
            </label>
          </fieldset>
          {!entity.editable && (
            <p role="alert">Este item está arquivado ou excluído na Meta e não pode ser editado.</p>
          )}
          {error && (
            <p className="text-red" role="alert">
              {error}
            </p>
          )}
          {error && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setRevision((v) => v + 1)}
            >
              Consultar valores atuais novamente
            </button>
          )}
          <div className="modal-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary" disabled={busy || !changed || !entity.editable}>
              {busy && <Spinner />}Salvar na Meta
            </button>
          </div>
        </form>
      )}
      {!entity && error && (
        <div className="error-panel">
          <p role="alert">{error}</p>
          <button className="button secondary" onClick={() => setRevision((v) => v + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
    </Modal>
  );
}

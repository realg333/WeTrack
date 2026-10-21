import { useState, type FormEvent } from 'react';
import { mutate } from './lib';
import { Modal, Spinner } from './components';
import type { Dashboard } from './types';

export default function FeeSettings({
  project,
  fees,
  revenue,
  spend,
  currency = 'BRL',
  onClose,
  onSaved,
}: {
  project: string;
  fees: Dashboard['fees'];
  revenue: number;
  spend: number;
  currency?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [gateway, setGateway] = useState(String(fees.gateway_percent));
  const [tax, setTax] = useState(String(fees.tax_percent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const format = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  const percent = (value: string) => Number(value.replace(',', '.'));
  const valid = [gateway, tax].every(
    (value) => Number.isFinite(percent(value)) && percent(value) >= 0 && percent(value) <= 100,
  );
  const gatewayCost = Math.round(revenue * percent(gateway)) / 100;
  const taxCost = Math.round(revenue * percent(tax)) / 100;
  const close = () => {
    if (!saving) onClose();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await mutate('/fees', 'PUT', {
        project_id: project,
        gateway_percent: percent(gateway),
        tax_percent: percent(tax),
      });
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Configurar taxas"
      subtitle="Ajuste as taxas desta operação para calcular seu lucro."
      onClose={close}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <label>
            <span id="gateway-fee-label">Taxa do gateway (%)</span>
            <input
              aria-labelledby="gateway-fee-label"
              aria-describedby="gateway-fee-hint"
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="any"
              value={gateway}
              onChange={(event) => setGateway(event.target.value)}
              disabled={saving}
            />
            <small id="gateway-fee-hint" className="fee-field-hint">
              Percentual cobrado sobre as vendas aprovadas.
            </small>
          </label>
          <label>
            <span id="tax-fee-label">Imposto (%) · opcional</span>
            <input
              aria-labelledby="tax-fee-label"
              aria-describedby="tax-fee-hint"
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="any"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
              disabled={saving}
            />
            <small id="tax-fee-hint" className="fee-field-hint">
              Deixe em 0% se não houver imposto.
            </small>
          </label>
        </div>
        <div className="fee-preview" aria-live="polite">
          <h3>Prévia no período selecionado</h3>
          <dl>
            <div>
              <dt>Faturamento aprovado</dt>
              <dd>{format(revenue)}</dd>
            </div>
            <div>
              <dt>Investimento em anúncios</dt>
              <dd>− {format(spend)}</dd>
            </div>
            <div>
              <dt>Taxa do gateway</dt>
              <dd>{valid ? `− ${format(gatewayCost)}` : '—'}</dd>
            </div>
            <div>
              <dt>Imposto</dt>
              <dd>{valid ? `− ${format(taxCost)}` : '—'}</dd>
            </div>
            <div className="fee-preview-total">
              <dt>Lucro estimado</dt>
              <dd>{valid ? format(revenue - spend - gatewayCost - taxCost) : '—'}</dd>
            </div>
          </dl>
        </div>
        <p className="fee-field-hint">
          Os dois percentuais incidem sobre o faturamento aprovado, antes dos descontos. A
          configuração se aplica a todos os períodos desta operação. Custos do produto não estão
          incluídos.
        </p>
        {error && (
          <p role="alert" className="text-red">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close} disabled={saving}>
            Cancelar
          </button>
          <button className="button primary" disabled={saving || !valid}>
            {saving && <Spinner />}Salvar taxas
          </button>
        </div>
      </form>
    </Modal>
  );
}

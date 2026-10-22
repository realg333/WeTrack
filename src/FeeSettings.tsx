import { useState, type FormEvent } from 'react';
import { mutate } from './lib';
import { Modal, Spinner } from './components';
import type { Dashboard, Sale } from './types';

type FeeKey = keyof Dashboard['fees'];

export default function FeeSettings({
  project,
  fees,
  sales,
  revenue,
  spend,
  currency = 'BRL',
  onClose,
  onSaved,
}: {
  project: string;
  fees: Dashboard['fees'];
  sales: Sale[];
  revenue: number;
  spend: number;
  currency?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<FeeKey, string>>({
    gateway_percent: String(fees.gateway_percent),
    tax_percent: String(fees.tax_percent),
    gateway_fixed: String(fees.gateway_fixed ?? 0),
    credit_card_percent: String(fees.credit_card_percent ?? 0),
    pix_percent: String(fees.pix_percent ?? 0),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const format = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  const amount = (key: FeeKey) => Number(values[key].replace(',', '.'));
  const round = (value: number) => Math.round(value * 100) / 100;
  const fields: { key: FeeKey; label: string; hint: string }[] = [
    {
      key: 'gateway_percent',
      label: 'Taxa do gateway (%)',
      hint: 'Percentual geral sobre todas as vendas aprovadas.',
    },
    {
      key: 'gateway_fixed',
      label: `Taxa fixa do gateway (${currency === 'BRL' ? 'R$' : 'US$'}) · opcional`,
      hint: 'Valor fixo por venda aprovada, na moeda do relatório.',
    },
    {
      key: 'credit_card_percent',
      label: 'Taxa de cartão de crédito (%) · opcional',
      hint: 'Percentual adicional apenas sobre vendas aprovadas no crédito.',
    },
    {
      key: 'pix_percent',
      label: 'Taxa de Pix (%) · opcional',
      hint: 'Percentual adicional apenas sobre vendas aprovadas no Pix.',
    },
    {
      key: 'tax_percent',
      label: 'Imposto (%) · opcional',
      hint: 'Sobre o faturamento aprovado. Deixe em 0% se não houver.',
    },
  ];
  const valid = fields.every(
    ({ key }) =>
      Number.isFinite(amount(key)) &&
      amount(key) >= 0 &&
      amount(key) <= (key === 'gateway_fixed' ? 1000000 : 100),
  );
  const approved = sales.filter((sale) => sale.status === 'approved');
  const methodRevenue = (method: string) =>
    round(
      approved
        .filter((sale) => sale.payment_method === method)
        .reduce((sum, sale) => sum + sale.amount, 0),
    );
  const costs = [
    { label: 'Taxa do gateway', value: round((revenue * amount('gateway_percent')) / 100) },
    {
      label: `Taxa fixa · ${approved.length} vendas`,
      value: round(approved.length * amount('gateway_fixed')),
    },
    {
      label: 'Cartão de crédito',
      value: round((methodRevenue('credit_card') * amount('credit_card_percent')) / 100),
    },
    { label: 'Pix', value: round((methodRevenue('pix') * amount('pix_percent')) / 100) },
    { label: 'Imposto', value: round((revenue * amount('tax_percent')) / 100) },
  ];
  const totalFees = round(costs.reduce((sum, cost) => sum + cost.value, 0));
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
        ...Object.fromEntries(fields.map(({ key }) => [key, amount(key)])),
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
        <div className="form-grid fee-settings-fields">
          {fields.map(({ key, label, hint }) => (
            <label key={key}>
              <span id={`fee-${key}-label`}>{label}</span>
              <input
                aria-labelledby={`fee-${key}-label`}
                aria-describedby={`fee-${key}-hint`}
                type="number"
                inputMode="decimal"
                min="0"
                max={key === 'gateway_fixed' ? '1000000' : '100'}
                step={key === 'gateway_fixed' ? '0.01' : 'any'}
                value={values[key]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                disabled={saving}
              />
              <small id={`fee-${key}-hint`} className="fee-field-hint">
                {hint}
              </small>
            </label>
          ))}
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
            {costs.map((cost) => (
              <div key={cost.label}>
                <dt>{cost.label}</dt>
                <dd>{valid ? `− ${format(cost.value)}` : '—'}</dd>
              </div>
            ))}
            <div className="fee-preview-total">
              <dt>Lucro estimado</dt>
              <dd>{valid ? format(revenue - spend - totalFees) : '—'}</dd>
            </div>
          </dl>
        </div>
        <p className="fee-field-hint">
          As taxas são somadas: gateway geral + valor fixo por venda + taxa da forma de pagamento +
          imposto. Todos os percentuais usam o valor bruto aprovado. Deixe em 0 as taxas que não se
          aplicam. A configuração vale para todos os períodos desta operação. Custos do produto não
          estão incluídos.
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

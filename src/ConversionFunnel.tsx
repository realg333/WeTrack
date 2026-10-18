import { useState } from 'react';
import { Filter, Clock3 } from 'lucide-react';
import { decimal, number } from './lib';
import type { Dashboard } from './types';

export default function ConversionFunnel({ data }: { data: Dashboard }) {
  const [mode, setMode] = useState<'meta' | 'site'>(data.funnel.meta_available ? 'meta' : 'site');
  const stages = data.funnel[mode];
  const highest = Math.max(...stages.map((s) => s.value), 1);
  const maxHourly = Math.max(...data.funnel.hourly.map((h) => h.sales), 1);
  return (
    <div className="funnel-layout">
      <section className="panel funnel-panel">
        <div className="panel-heading">
          <div>
            <h2>
              <Filter size={16} /> Funil de conversão
            </h2>
            <p>Do primeiro clique à venda aprovada</p>
          </div>
          <div className="segmented small" aria-label="Origem do funil">
            <button className={mode === 'meta' ? 'selected' : ''} onClick={() => setMode('meta')}>
              Meta Ads
            </button>
            <button className={mode === 'site' ? 'selected' : ''} onClick={() => setMode('site')}>
              Site
            </button>
          </div>
        </div>
        {mode === 'meta' && !data.funnel.meta_available && (
          <p className="funnel-empty">
            Selecione uma conta Meta em Integrações e sincronize o período para ver os cliques e as
            etapas do anúncio.
          </p>
        )}
        <div className="funnel-scroll">
          <div
            className="conversion-funnel"
            role="list"
            aria-label={`Etapas do funil ${mode === 'meta' ? 'Meta Ads' : 'Site'}`}
          >
            {stages.map((stage, index) => {
              const h = Math.max(7, (stage.value / highest) * 100);
              const next = Math.max(7, ((stages[index + 1]?.value ?? stage.value) / highest) * 100);
              return (
                <div className="funnel-stage" role="listitem" key={stage.label}>
                  <span className="funnel-label">{stage.label}</span>
                  <div className="funnel-shape">
                    <svg viewBox="0 0 150 120" preserveAspectRatio="none" aria-hidden="true">
                      <polygon
                        points={`0,${60 - h / 2} 150,${60 - next / 2} 150,${60 + next / 2} 0,${60 + h / 2}`}
                        fill={`var(--funnel-${index})`}
                      />
                    </svg>
                    <strong>{decimal(stage.rate, 1)}%</strong>
                  </div>
                  <b>{number(stage.value)}</b>
                  <small>
                    {index === 0
                      ? 'Base do funil'
                      : `${decimal(stage.step_rate, 1)}% da etapa anterior`}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
        <p className="panel-footnote">
          {mode === 'meta'
            ? 'Cliques, visitas e checkout: Meta. Pedidos e aprovações: webhooks atribuídos às campanhas das contas selecionadas.'
            : 'Sessões, visitantes e intenção de checkout: pixel WeTrack. Pedidos e aprovações: webhooks da operação.'}{' '}
          Totais do período; as etapas podem envolver pessoas diferentes.
        </p>
      </section>
      <section className="panel hourly-panel">
        <div className="panel-heading">
          <div>
            <h2>
              <Clock3 size={16} /> Vendas por horário
            </h2>
            <p>Aprovadas · horário de Brasília</p>
          </div>
        </div>
        <div
          className="hourly-chart"
          role="img"
          aria-label={data.funnel.hourly.map((h) => `${h.hour}h: ${h.sales} vendas`).join(', ')}
        >
          {data.funnel.hourly.map((h) => (
            <div className="hourly-column" key={h.hour} title={`${h.hour}h — ${h.sales} vendas`}>
              <div className="hourly-track">
                <span style={{ height: `${(h.sales / maxHourly) * 100}%` }} />
                <b>{h.sales || ''}</b>
              </div>
              <small>{String(h.hour).padStart(2, '0')}</small>
            </div>
          ))}
        </div>
        {!data.metrics.sales && (
          <p className="panel-footnote">
            As vendas aprovadas aparecerão aqui ao receber os webhooks.
          </p>
        )}
      </section>
    </div>
  );
}

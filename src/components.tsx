import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { brl, decimal, number } from './lib';
import type { Dashboard, Metrics } from './types';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <svg viewBox="0 0 40 40">
          <path d="m7 13 6 15 7-12 6 12 7-15" />
        </svg>
      </span>
      {!small && (
        <span>
          we<span className="brand-light">track</span>
          <i />
        </span>
      )}
    </div>
  );
}
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href]',
          ) || [],
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        }
        if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', listener);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button className="icon-button" aria-label="Limpar busca" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </label>
  );
}
export function Pagination({
  page,
  total,
  size = 8,
  onChange,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        Mostrando{' '}
        <b>
          {total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)}
        </b>{' '}
        de <b>{number(total)}</b> resultados
      </span>
      <div>
        <button
          className="icon-button"
          disabled={page === 1}
          aria-label="Página anterior"
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="icon-button"
          disabled={page >= pages}
          aria-label="Próxima página"
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
const metricDefinitions: { key: keyof Metrics; title: string; type: string; tip: string }[] = [
  {
    key: 'revenue',
    title: 'Faturamento',
    type: 'money',
    tip: 'Soma das vendas aprovadas no período.',
  },
  {
    key: 'spend',
    title: 'Investimento',
    type: 'money',
    tip: 'Investimento registrado em mídia no período.',
  },
  {
    key: 'profit',
    title: 'Lucro sobre mídia',
    type: 'money',
    tip: 'Faturamento aprovado menos investimento, taxas do gateway, cartão, Pix e imposto configurados. Não inclui custos do produto.',
  },
  {
    key: 'roas',
    title: 'ROAS',
    type: 'ratio',
    tip: 'Faturamento dividido pelo investimento em anúncios.',
  },
];
export function MetricCards({
  metrics,
  currency = 'BRL',
  onConfigureFees,
}: {
  metrics: Metrics;
  currency?: string;
  onConfigureFees?: () => void;
}) {
  return (
    <div className="metrics-grid">
      {metricDefinitions.map((m, i) => (
        <article className={`metric-card metric-${m.key}`} key={m.key}>
          <div className="metric-label">
            {m.title}
            <span className="tip" tabIndex={0} aria-label={m.tip}>
              <CircleHelp size={13} />
              <span>{m.tip}</span>
            </span>
            <span className={`metric-symbol symbol-${i}`}>
              {i === 0 ? (
                '$'
              ) : i === 1 ? (
                <ArrowUpRight size={16} />
              ) : i === 2 ? (
                <ArrowDownLeft size={16} />
              ) : (
                <svg viewBox="0 0 20 20">
                  <path d="m3 14 4-5 4 3 6-8M13 4h4v4" />
                </svg>
              )}
            </span>
          </div>
          <strong className="metric-value">
            {m.type === 'ratio' ? `${decimal(metrics[m.key])}x` : brl(metrics[m.key], currency)}
          </strong>
          <div className="metric-foot">
            {i === 0 ? (
              <>
                <span className="metric-positive">
                  <Check size={12} />
                  {number(metrics.sales)} vendas
                </span>
                <span>aprovadas no período</span>
              </>
            ) : i === 1 ? (
              <>
                <span className="tiny-dot blue" />
                <span>Investimento em anúncios</span>
              </>
            ) : i === 2 ? (
              <>
                <span className={metrics.margin >= 0 ? 'metric-positive' : 'text-red'}>
                  {decimal(metrics.margin, 1)}%
                </span>
                <span>de margem sobre mídia</span>
              </>
            ) : (
              <>
                <span className="tiny-dot green" />
                <span>
                  {metrics.roas >= 1
                    ? 'Retorno positivo'
                    : metrics.spend
                      ? 'Abaixo do ponto de equilíbrio'
                      : 'Aguardando investimento'}
                </span>
              </>
            )}
          </div>
          {m.key === 'profit' && onConfigureFees && (
            <button type="button" className="metric-fees-button" onClick={onConfigureFees}>
              <Settings2 size={12} /> Configurar taxas
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
export function RevenueChart({
  data,
  display,
  currency = 'BRL',
}: {
  data: Dashboard['daily'];
  display: 'revenue' | 'profit';
  currency?: string;
}) {
  const [w, h, pad] = [1000, 224, 25];
  const values = data.map((d) => (display === 'profit' ? d.profit : d.revenue));
  const max = Math.max(100, ...values, ...data.map((d) => d.spend)) * 1.15;
  const min = Math.min(0, ...values);
  const range = max - min;
  const x = (i: number) => pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2);
  const y = (v: number) => h - 15 - ((v - min) / range) * (h - 30);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const spendPoints = data.map((d, i) => `${x(i)},${y(d.spend)}`).join(' ');
  const baseline = y(0);
  return (
    <div className="chart-wrap">
      <div className="chart-y">
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <span key={v}>{brl(min + range * v, currency).replace(',00', '')}</span>
        ))}
      </div>
      <div className="chart-main">
        <svg
          className="revenue-chart"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Gráfico diário de faturamento e investimento"
        >
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4c87ff" stopOpacity=".27" />
              <stop offset="100%" stopColor="#4c87ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <line
              key={v}
              x1="0"
              x2={w}
              y1={15 + v * (h - 30)}
              y2={15 + v * (h - 30)}
              className="chart-grid"
            />
          ))}
          {data.length > 0 && (
            <>
              <polygon
                points={`${pad},${baseline} ${points} ${x(data.length - 1)},${baseline}`}
                fill="url(#area)"
              />
              <polyline points={spendPoints} className="spend-line" />
              <polyline points={points} className="revenue-line" />
              {data.map((d, i) => (
                <g key={d.day} className="chart-point">
                  <circle cx={x(i)} cy={y(values[i])} r="4" fill="#6c9bff" />
                  <rect x={x(i) - 10} y="0" width="20" height={h} fill="transparent">
                    <title>
                      {d.day.split('-').reverse().join('/')}:{' '}
                      {display === 'profit' ? 'Lucro' : 'Faturamento'} {brl(values[i], currency)} ·
                      Investimento {brl(d.spend, currency)}
                    </title>
                  </rect>
                </g>
              ))}
            </>
          )}
        </svg>
        <div className="chart-x">
          {data
            .filter(
              (_, i) =>
                data.length <= 8 || i % Math.ceil(data.length / 7) === 0 || i === data.length - 1,
            )
            .map((d) => (
              <span key={d.day}>
                {d.day.slice(8)}/{d.day.slice(5, 7)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={18} className="spin" />;
}

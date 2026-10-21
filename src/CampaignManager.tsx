import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronRight,
  Layers,
  Megaphone,
  MonitorPlay,
  Plus,
  Wallet,
  Columns3,
} from 'lucide-react';
import { api, brl, downloadCsv, localDay, mutate, number } from './lib';
import { Badge, Empty, Modal, SearchBox, Spinner, Toggle } from './components';
import type { Dashboard, HierarchyRow, Toast } from './types';
import MetaEntityEditor from './MetaEntityEditor';
import ColumnPicker, { type ColumnConfig } from './ColumnPicker';
import { columns, templates, metric, formatMetric, totalMetric } from './report-columns';

type Level = 'campaigns' | 'adsets' | 'ads';
const levels = [
  { id: 'campaigns', label: 'Campanhas', icon: Megaphone },
  { id: 'adsets', label: 'Conjuntos de anúncios', icon: Layers },
  { id: 'ads', label: 'Anúncios', icon: MonitorPlay },
] as const;
export default function CampaignManager({
  data,
  onToggle,
  onCreate,
  onExport,
  onReload,
}: {
  data: Dashboard;
  onToggle: (id: string, active: boolean) => void;
  onCreate: () => void;
  onExport: Toast;
  onReload: () => Promise<void>;
}) {
  const [level, setLevel] = useState<Level>('campaigns');
  const [columnConfig, setColumnConfig] = useState<ColumnConfig>({
    selected: templates.Desempenho,
    presets: [],
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sort, setSort] = useState<{ id: string; direction: number } | null>(null);
  const [columnsReady, setColumnsReady] = useState(false);
  useEffect(() => {
    let current = true;
    setColumnsReady(false);
    setColumnsOpen(false);
    setColumnConfig({ selected: templates.Desempenho, presets: [] });
    api<ColumnConfig | null>(`/report-columns?project=${encodeURIComponent(data.project.id)}`)
      .then((saved) => {
        if (!current) return;
        if (saved) {
          const valid = new Set(columns.map((c) => c.id));
          setColumnConfig({
            selected: saved.selected.filter((id) => valid.has(id)),
            presets: saved.presets.map((p) => ({
              ...p,
              columns: p.columns.filter((id) => valid.has(id)),
            })),
          });
        }
        setColumnsReady(true);
      })
      .catch((e) => {
        if (current) onExport(e.message, true);
      });
    return () => {
      current = false;
    };
  }, [data.project.id]);
  const visibleColumns = columnConfig.selected
    .map((id) => columns.find((c) => c.id === id)!)
    .filter(Boolean);
  const [campaign, setCampaign] = useState<HierarchyRow | null>(null);
  const [adset, setAdset] = useState<HierarchyRow | null>(null);
  const [selected, setSelected] = useState<HierarchyRow | null>(null);
  const [editing, setEditing] = useState<{
    row: HierarchyRow;
    level: Level;
    desiredActive?: boolean;
  } | null>(null);
  const [rows, setRows] = useState<HierarchyRow[]>([]);
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [spendOpen, setSpendOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [spendError, setSpendError] = useState('');
  const generation = useRef(0);
  const parent = level === 'adsets' ? campaign?.id : level === 'ads' ? adset?.id : undefined;
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      project: data.project.id,
      start: data.start,
      end: data.end,
      level,
      currency: data.currency || 'BRL',
    });
    if (parent) params.set('parent', parent);
    api<{ rows: HierarchyRow[] }>(`/ad-hierarchy?${params}`)
      .then((result) => {
        if (version === generation.current) setRows(result.rows);
      })
      .catch((e) => {
        if (version === generation.current) setError(e.message);
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [data, level, parent, revision]);
  useEffect(() => {
    setLevel('campaigns');
    setCampaign(null);
    setAdset(null);
    setSelected(null);
    setEditing(null);
  }, [data.project.id, data.currency]);
  const changeLevel = (value: Level) => {
    setLevel(value);
    setQuery('');
  };
  const open = (row: HierarchyRow) => {
    if (level === 'campaigns') {
      setCampaign(row);
      setAdset(null);
      changeLevel('adsets');
    } else if (level === 'adsets') {
      setAdset(row);
      changeLevel('ads');
    } else setSelected(row);
  };
  const filtered = rows.filter(
    (row) =>
      (status === 'all' || row.active === Number(status)) &&
      `${row.name} ${row.external_id || row.id} ${row.campaign_name || ''}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      !(level === 'ads' && !adset && campaign && row.campaign_id !== campaign.id),
  );
  if (sort)
    filtered.sort((a, b) => {
      const x = metric(a, sort.id),
        y = metric(b, sort.id);
      return x == null ? (y == null ? 0 : 1) : y == null ? -1 : (x - y) * sort.direction;
    });
  const title = levels.find((l) => l.id === level)!.label;
  const manualCampaigns = data.campaigns.filter((c) => !('account_id' in c && c.account_id));
  return (
    <>
      <section className="panel hierarchy-panel">
        <div className="hierarchy-tabs" role="tablist" aria-label="Níveis da estrutura de anúncios">
          {levels.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={level === item.id}
              className={level === item.id ? 'active' : ''}
              onClick={() => changeLevel(item.id)}
            >
              <item.icon size={18} />
              <span>
                {item.label}
                <small>
                  {item.id === 'campaigns'
                    ? 'Todas as campanhas'
                    : item.id === 'adsets'
                      ? campaign?.name || 'Todos os conjuntos'
                      : adset?.name || campaign?.name || 'Todos os anúncios'}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
        {(campaign || adset) && (
          <div className="hierarchy-context">
            <button
              className="text-button"
              onClick={() => {
                setCampaign(null);
                setAdset(null);
                changeLevel('campaigns');
              }}
            >
              Todas as campanhas
            </button>
            {campaign && (
              <>
                <ChevronRight size={13} />
                <button
                  className="text-button"
                  onClick={() => {
                    setAdset(null);
                    changeLevel('adsets');
                  }}
                >
                  {campaign.name}
                </button>
              </>
            )}
            {adset && (
              <>
                <ChevronRight size={13} />
                <span>{adset.name}</span>
              </>
            )}
            <button
              className="text-button clear-context"
              onClick={() => {
                setCampaign(null);
                setAdset(null);
              }}
            >
              Limpar seleção
            </button>
          </div>
        )}
        <div className="table-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={`Buscar em ${title.toLowerCase()}…`}
          />
          <div className="toolbar-actions">
            <button
              className="button secondary"
              disabled={!columnsReady}
              onClick={() => setColumnsOpen(true)}
            >
              <Columns3 size={14} />
              Colunas
            </button>
            {level === 'campaigns' && (
              <button
                className="button secondary"
                disabled={!manualCampaigns.length}
                onClick={() => setSpendOpen(true)}
              >
                <Wallet size={14} />
                Investimento
              </button>
            )}
            <select
              aria-label="Filtrar por status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Todos os status</option>
              <option value="1">Ativos</option>
              <option value="0">Pausados</option>
            </select>
            <button
              className="button secondary"
              disabled={loading || !filtered.length}
              onClick={() => {
                downloadCsv(`wetrack-${level}-${data.currency}.csv`, [
                  [
                    'Nome',
                    'Campanha',
                    'Conjunto',
                    'ID Meta',
                    'Moeda',
                    ...visibleColumns.map((c) => c.label),
                  ],
                  ...filtered.map((c) => [
                    c.name,
                    c.campaign_name || c.name,
                    c.adset_name || '',
                    c.external_id || c.id,
                    c.currency,
                    ...visibleColumns.map((column) => metric(c, column.id) ?? ''),
                  ]),
                ]);
                onExport(`${title} exportados.`);
              }}
            >
              <ArrowDownToLine size={14} />
              Exportar
            </button>
          </div>
        </div>
        {error ? (
          <div className="error-panel">
            <p>{error}</p>
            <button className="button secondary" onClick={() => setRevision((v) => v + 1)}>
              Tentar novamente
            </button>
          </div>
        ) : loading ? (
          <div className="loading-page">
            <Spinner />
            <p>Carregando {title.toLowerCase()}…</p>
          </div>
        ) : filtered.length ? (
          <div className="table-scroll">
            <table className="data-table campaign-table">
              <thead>
                <tr>
                  <th>Status configurado</th>
                  <th>{title}</th>
                  {visibleColumns.map((c) => (
                    <th
                      key={c.id}
                      aria-sort={
                        sort?.id === c.id
                          ? sort.direction === 1
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        className="column-sort"
                        aria-label={`Ordenar por ${c.label}`}
                        title={c.description}
                        onClick={() =>
                          setSort({ id: c.id, direction: sort?.id === c.id ? -sort.direction : -1 })
                        }
                      >
                        {c.label}
                        {sort?.id === c.id ? (sort.direction === 1 ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Toggle
                        checked={Boolean(row.active)}
                        label={`${row.active ? 'Pausar' : 'Ativar'} ${row.name}${row.account_id ? ' na Meta' : ' localmente'}`}
                        onChange={async () => {
                          if (row.account_id && row.external_id) {
                            setEditing({ row, level, desiredActive: !row.active });
                            return;
                          }
                          if (level === 'campaigns') {
                            onToggle(row.id, !row.active);
                            return;
                          }
                          try {
                            await mutate(`/ad-entities/${level}/${row.id}`, 'PATCH', {
                              project_id: data.project.id,
                              active: !row.active,
                            });
                            setRevision((v) => v + 1);
                          } catch (e) {
                            onExport((e as Error).message, true);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <button className="entity-link" onClick={() => open(row)}>
                        <strong>{row.name}</strong>
                        <ChevronRight size={15} />
                      </button>
                      <small>
                        {row.adset_name || row.campaign_name || row.source}
                        <span className="campaign-id">{row.external_id || row.id}</span>
                      </small>
                    </td>
                    {visibleColumns.map((c) => (
                      <td key={c.id} className={c.id === 'revenue' ? 'amount-cell' : ''}>
                        {c.id === 'roas' ? (
                          <span
                            className={`roas-badge ${(metric(row, c.id) || 0) >= 2 ? 'positive' : ''}`}
                          >
                            {formatMetric(metric(row, c.id), c, row.currency)}
                          </span>
                        ) : (
                          formatMetric(
                            c.id === 'budget' && (level === 'ads' || !row.budget)
                              ? null
                              : metric(row, c.id),
                            c,
                            row.currency,
                          )
                        )}
                      </td>
                    ))}
                    <td>
                      {row.account_id && row.external_id && (
                        <button
                          className="button secondary"
                          aria-label={`Editar ${row.name} na Meta`}
                          onClick={() => setEditing({ row, level })}
                        >
                          Editar na Meta
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Total exibido · {filtered.length}</td>
                  {visibleColumns.map((c) => (
                    <td key={c.id}>
                      {formatMetric(totalMetric(filtered, c.id), c, data.currency)}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Layers size={26} />}
            title={`Nenhum ${level === 'campaigns' ? 'registro' : level === 'adsets' ? 'conjunto' : 'anúncio'} encontrado`}
            text={
              query
                ? 'Experimente outra busca ou limpe os filtros.'
                : level === 'campaigns'
                  ? 'Selecione as contas em Integrações e sincronize a Meta ou cadastre uma campanha manual.'
                  : 'A sincronização Meta importa a estrutura desta conta. Campanhas manuais não possuem conjuntos nem anúncios.'
            }
            action={
              level === 'campaigns' ? (
                <button className="button primary" onClick={onCreate}>
                  <Plus size={16} />
                  Criar campanha
                </button>
              ) : undefined
            }
          />
        )}
        <p className="panel-footnote">
          Clique no nome para abrir o próximo nível. A receita de conjuntos e anúncios exige o ID
          correspondente no webhook ou nas UTMs. Valores sem esse vínculo permanecem na campanha.
        </p>
      </section>
      {columnsOpen && (
        <ColumnPicker
          config={columnConfig}
          onClose={() => setColumnsOpen(false)}
          onSave={async (config) => {
            await mutate(
              `/report-columns?project=${encodeURIComponent(data.project.id)}`,
              'PUT',
              config,
            );
            setColumnConfig(config);
            setColumnsOpen(false);
            onExport('Colunas salvas para esta operação.');
          }}
        />
      )}
      {editing && (
        <MetaEntityEditor
          key={`${data.project.id}:${editing.level}:${editing.row.id}`}
          project={data.project.id}
          level={editing.level}
          id={editing.row.id}
          desiredActive={editing.desiredActive}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRevision((v) => v + 1);
            onExport('Alteração confirmada na Meta.');
            void onReload();
          }}
        />
      )}
      {selected && (
        <Modal
          title={selected.name}
          subtitle="Detalhes do anúncio no período selecionado"
          onClose={() => setSelected(null)}
        >
          <Badge tone={selected.active ? 'green' : 'neutral'}>
            {selected.active ? 'Configurado como ativo' : 'Configurado como pausado'}
          </Badge>
          <dl className="entity-details">
            {[
              ['ID Meta', selected.external_id || selected.id],
              ['Campanha', selected.campaign_name],
              ['Conjunto', selected.adset_name],
              ['Investimento', brl(selected.spend, selected.currency)],
              ['Faturamento atribuído', brl(selected.revenue, selected.currency)],
              ['Vendas aprovadas', number(selected.sales)],
              ['Cliques', number(selected.clicks)],
              ['Impressões', number(selected.impressions)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
      {spendOpen && (
        <Modal
          title="Registrar investimento"
          subtitle="Substitui o valor da campanha manual na data escolhida."
          onClose={() => setSpendOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              setSpendError('');
              try {
                await mutate(`/campaigns/${values.campaign}/spend`, 'PUT', {
                  day: values.day,
                  amount: Number(values.amount),
                  clicks: Number(values.clicks),
                  impressions: Number(values.impressions),
                });
                await onReload();
                setSpendOpen(false);
                onExport('Investimento registrado.');
              } catch (e) {
                setSpendError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Campanha
              <select name="campaign">
                {manualCampaigns.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Data
                <input type="date" name="day" defaultValue={localDay()} max={localDay()} required />
              </label>
              <label>
                Valor investido ({data.currency === 'USD' ? 'US$' : 'R$'})
                <input type="number" name="amount" min="0" max="10000000" step="0.01" required />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Impressões
                <input
                  type="number"
                  name="impressions"
                  min="0"
                  step="1"
                  defaultValue={0}
                  required
                />
              </label>
              <label>
                Cliques
                <input type="number" name="clicks" min="0" step="1" defaultValue={0} required />
              </label>
            </div>
            {spendError && (
              <p className="text-red" role="alert">
                {spendError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setSpendOpen(false)}
              >
                Cancelar
              </button>
              <button className="button primary" disabled={busy}>
                {busy && <Spinner />}Salvar investimento
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

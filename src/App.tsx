import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Ellipsis,
  FlaskConical,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Megaphone,
  MousePointer2,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sun,
  Target,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  api,
  brl,
  dateTime,
  decimal,
  downloadCsv,
  localDay,
  mutate,
  number,
  sourceName,
} from './lib';
import {
  Badge,
  Brand,
  Empty,
  MetricCards,
  Modal,
  Pagination,
  RevenueChart,
  SearchBox,
  Spinner,
  Toggle,
} from './components';
import IntegrationsPage from './Integrations';
import RulesPage from './RulesPage';
import CampaignManager from './CampaignManager';
import VisitorsPage from './VisitorsPage';
import ConversionFunnel from './ConversionFunnel';
import SaleAttribution from './SaleAttribution';
import type { Dashboard, Page, Project, Sale } from './types';

const navigation = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campanhas', icon: Megaphone },
  { id: 'sales', label: 'Vendas', icon: ShoppingBag },
  { id: 'visits', label: 'Visitas e atribuição', icon: MousePointer2 },
  { id: 'rules', label: 'Regras e alertas', icon: Zap },
  { id: 'integrations', label: 'Integrações', icon: Link2 },
] as const;
const titles: Record<Page, string> = {
  overview: 'Visão geral',
  campaigns: 'Campanhas',
  sales: 'Vendas',
  visits: 'Visitas e atribuição',
  rules: 'Regras e alertas',
  integrations: 'Integrações',
  notifications: 'Notificações',
  settings: 'Configurações',
};
const descriptions: Record<Page, string> = {
  overview: 'Seus números, conectados. Suas decisões, mais claras.',
  campaigns: 'Entenda o que performa e encontre sua próxima escala.',
  sales: 'Cada venda tem uma história. Saiba de onde ela veio.',
  visits: 'Acompanhe o caminho entre o primeiro clique e a conversão.',
  rules: 'Seus indicadores certos, sempre no seu radar.',
  integrations: 'Conecte sua operação. A WeTrack cuida dos dados.',
  notifications: 'As novidades e os sinais da sua operação.',
  settings: 'Deixe sua operação do seu jeito.',
};
const readPage = (): Page => {
  const value = window.location.hash.slice(1);
  return Object.hasOwn(titles, value) ? (value as Page) : 'overview';
};
const statusLabel: Record<string, string> = {
  approved: 'Aprovada',
  pending: 'Pendente',
  refunded: 'Reembolsada',
  chargeback: 'Chargeback',
  canceled: 'Cancelada',
  disputed: 'Em disputa',
};
const statusTone: Record<string, string> = {
  approved: 'green',
  pending: 'amber',
  refunded: 'neutral',
  chargeback: 'red',
  canceled: 'neutral',
  disputed: 'amber',
};
const paymentName: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão',
  boleto: 'Boleto',
  debit_card: 'Débito',
  other: 'Outro',
};

export default function App() {
  const [page, setPage] = useState<Page>(readPage);
  const [project, setProject] = useState(() => localStorage.getItem('wt_project') || 'workspace');
  const [projects, setProjects] = useState<Project[]>([]);
  const [period, setPeriod] = useState('7');
  const [customDates, setCustomDates] = useState({ start: localDay(), end: localDay() });
  const [customOpen, setCustomOpen] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [localMode, setLocalMode] = useState(true);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('wt_theme') || 'dark');
  const [chartDisplay, setChartDisplay] = useState<'revenue' | 'profit'>('revenue');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [modal, setModal] = useState<'campaign' | 'rule' | 'help' | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const generation = useRef(0);
  const previousPage = useRef(page);
  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener('wt:session-expired', expired);
    return () => window.removeEventListener('wt:session-expired', expired);
  }, []);
  const notify = useCallback(
    (message: string, isError = false) => setToast({ message, error: isError }),
    [],
  );
  const navigate = useCallback((next: Page) => {
    location.hash = next;
    setPage(next);
    setMobileOpen(false);
    setSearchOpen(false);
  }, []);
  useEffect(() => {
    const handler = () => setPage(readPage());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('wt_theme', theme);
  }, [theme]);
  useEffect(() => {
    document.title = `WeTrack · ${titles[page]}`;
  }, [page]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    api<{ authenticated: boolean; local: boolean }>('/session')
      .then((s) => {
        setAuthenticated(s.authenticated);
        setLocalMode(s.local);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (authenticated)
      api<Project[]>('/projects')
        .then((available) => {
          setProjects(available);
          setProject((current) =>
            available.some((p) => p.id === current)
              ? current
              : available.find((p) => !p.demo)?.id || available[0]?.id || 'workspace',
          );
        })
        .catch((e) => notify(e.message, true));
  }, [authenticated, notify]);
  const load = useCallback(
    async (quiet = false) => {
      const version = ++generation.current;
      if (!quiet) setLoading(true);
      const endDate = new Date(`${localDay()}T12:00:00Z`);
      if (period === 'yesterday') endDate.setUTCDate(endDate.getUTCDate() - 1);
      const startDate = new Date(endDate);
      if (period === '7' || period === '30')
        startDate.setUTCDate(startDate.getUTCDate() - Number(period) + 1);
      const start = period === 'custom' ? customDates.start : startDate.toISOString().slice(0, 10);
      const end = period === 'custom' ? customDates.end : endDate.toISOString().slice(0, 10);
      try {
        const result = await api<Dashboard>(
          `/dashboard?${new URLSearchParams({ project, start, end })}`,
        );
        if (version !== generation.current) return;
        setData(result);
        setError('');
        setLastUpdated(
          new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        );
      } catch (e) {
        if (version === generation.current) setError((e as Error).message);
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [period, project, customDates],
  );
  useEffect(() => {
    if (authenticated) {
      setData(null);
      void load();
      const timer = setInterval(() => void load(true), 60000);
      return () => clearInterval(timer);
    }
  }, [authenticated, load]);
  useEffect(() => {
    if (previousPage.current !== page && authenticated) void load(true);
    previousPage.current = page;
  }, [page, authenticated, load]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const changeProject = (value: string) => {
    setSelectedSale(null);
    setProject(value);
    localStorage.setItem('wt_project', value);
  };
  const exportReport = () => {
    if (data) {
      downloadCsv(`wetrack-${data.start}-${data.end}.csv`, [
        ['Indicador', 'Valor'],
        ['Faturamento', data.metrics.revenue],
        ['Investimento', data.metrics.spend],
        ['Lucro sobre mídia', data.metrics.profit],
        ['ROAS', data.metrics.roas],
        ['Vendas aprovadas', data.metrics.sales],
        ['CPA', data.metrics.cpa],
        ['Visitantes', data.metrics.visits],
      ]);
      notify('Relatório exportado.');
    }
  };
  const saveForm = async (e: FormEvent<HTMLFormElement>, kind: 'campaign' | 'rule') => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    setSaving(true);
    try {
      await mutate(kind === 'campaign' ? '/campaigns' : '/rules', 'POST', {
        ...fields,
        project_id: project,
        ...(kind === 'campaign'
          ? { budget: Number(fields.budget) }
          : { threshold: Number(fields.threshold) }),
      });
      setModal(null);
      notify(kind === 'campaign' ? 'Campanha local criada.' : 'Regra de alerta criada.');
      await load();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const updateCampaign = async (id: string, active: boolean) => {
    try {
      await mutate(`/campaigns/${id}`, 'PATCH', { active });
      notify(active ? 'Campanha ativada na WeTrack.' : 'Campanha pausada na WeTrack.');
      await load(true);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  if (authenticated === false) return <Login onLogin={() => setAuthenticated(true)} />;
  const currentProject = projects.find((p) => p.id === project);
  return (
    <div className="app-shell">
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button collapse-side"
            aria-label="Fechar navegação"
            onClick={() => setMobileOpen(false)}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        <div className="workspace-select">
          <span className="workspace-avatar">W</span>
          <div>
            <small>SEU WORKSPACE</small>
            <strong>WeTrack Workspace</strong>
          </div>
          <ChevronDown size={14} />
          <select
            aria-label="Selecionar operação"
            value={project}
            onChange={(e) => changeProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.demo ? ' (demonstração)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="nav-caption">ANÁLISE E GESTÃO</div>
        <nav aria-label="Navegação principal">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {page === item.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-project">
          <div className="nav-caption">OPERAÇÃO ATUAL</div>
          <div className="project-indicator">
            <span className={`project-square ${currentProject?.demo ? '' : 'green-square'}`} />
            {currentProject?.name || 'Carregando…'}
            <ChevronRight size={13} />
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-icon">
              <Activity size={17} />
            </span>
            <div>
              <strong>Dados que fazem sentido.</strong>
              <p>Do clique à conversão.</p>
            </div>
            <span className="tiny-dot green" />
          </div>
          <button className="nav-item" onClick={() => setModal('help')}>
            <CircleHelp size={18} />
            <span>Central de ajuda</span>
            <ArrowUpRight size={14} />
          </button>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>Configurações</span>
          </button>
          <div className="user-profile">
            <div className="user-avatar">WG</div>
            <div>
              <strong>Minha conta</strong>
              <small>{localMode ? 'Workspace local' : 'Administrador'}</small>
            </div>
            <button
              className="icon-button"
              title="Configurações da conta"
              onClick={() => navigate('settings')}
            >
              <Ellipsis size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{titles[page]}</strong>
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
              <span>Buscar na WeTrack</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Alternar tema"
              onClick={() => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))}
            >
              <Sun size={18} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label="Abrir notificações"
              onClick={() => {
                setNotificationsOpen((v) => !v);
                setNotificationsRead(true);
              }}
            >
              <Bell size={18} />
              {!notificationsRead && <i />}
            </button>
            <button
              className="mini-avatar"
              aria-label="Minha conta"
              onClick={() => navigate('settings')}
            >
              W
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'overview'
                  ? 'CADA CLIQUE, UMA DECISÃO MELHOR'
                  : 'WORKSPACE / ' + titles[page].toLocaleUpperCase('pt-BR')}
              </div>
              <h1>
                {page === 'overview' ? 'Sua operação em foco.' : titles[page]}
                {page === 'overview' && <span className="heading-dot">.</span>}
              </h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="page-heading-actions">
              {page === 'overview' ? (
                <button className="button secondary" onClick={exportReport} disabled={!data}>
                  <ArrowDownToLine size={15} />
                  Exportar relatório
                </button>
              ) : page === 'campaigns' ? (
                <button className="button primary" onClick={() => setModal('campaign')}>
                  <Plus size={16} />
                  Nova campanha
                </button>
              ) : page === 'rules' ? (
                <button className="button primary" onClick={() => setModal('rule')}>
                  <Plus size={16} />
                  Nova regra
                </button>
              ) : page === 'integrations' ? (
                <span className="secure-label">
                  <ShieldCheck size={15} />
                  Conexões protegidas
                </span>
              ) : null}
            </div>
          </div>
          {currentProject?.demo === 1 && (
            <div className="demo-banner">
              <FlaskConical size={15} />
              <span>
                Você está no modo demonstração.
                <span className="demo-extra"> Explore os recursos com dados de exemplo.</span>
              </span>
              <button
                onClick={() => {
                  changeProject('workspace');
                  navigate('integrations');
                }}
              >
                Conectar minha operação
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!['integrations', 'settings', 'notifications'].includes(page) && (
            <div className="filter-toolbar">
              <div className="period-tabs" aria-label="Período do relatório">
                {[
                  ['today', 'Hoje'],
                  ['yesterday', 'Ontem'],
                  ['7', '7 dias'],
                  ['30', '30 dias'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={period === key ? 'selected' : ''}
                    onClick={() => setPeriod(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="filter-right">
                <button
                  className={`button date-button ${period === 'custom' ? 'custom-selected' : ''}`}
                  onClick={() => setCustomOpen(true)}
                >
                  <CalendarDays size={15} />
                  <span>
                    {data
                      ? `${data.start.split('-').reverse().slice(0, 2).join('/')} — ${data.end.split('-').reverse().slice(0, 2).join('/')} ${data.end.slice(0, 4)}`
                      : 'Selecionar período'}
                  </span>
                  <ChevronDown size={13} />
                </button>
                <button
                  className="icon-button refresh-button"
                  aria-label="Atualizar dados"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshCw size={16} className={loading ? 'spin' : ''} />
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="error-panel">
              <Activity size={19} />
              <div>
                <strong>Não foi possível carregar os dados</strong>
                <p>{error}</p>
              </div>
              <button className="button secondary" onClick={() => void load()}>
                Tentar novamente
              </button>
            </div>
          )}
          {!data && !error && (
            <div className="loading-page">
              <Spinner />
              <p>Conectando os pontos da sua operação…</p>
            </div>
          )}
          {data && (
            <div className="page-content" key={page}>
              {page === 'overview' && (
                <>
                  <MetricCards metrics={data.metrics} />
                  <div className="secondary-metrics">
                    {[
                      {
                        icon: ShoppingBag,
                        label: 'Vendas aprovadas',
                        value: number(data.metrics.sales),
                      },
                      { icon: Wallet, label: 'Ticket médio', value: brl(data.metrics.ticket) },
                      { icon: Target, label: 'Custo por aquisição', value: brl(data.metrics.cpa) },
                      {
                        icon: Users,
                        label: 'Visitantes únicos',
                        value: number(data.metrics.visits),
                      },
                    ].map((m) => (
                      <div key={m.label}>
                        <span className="secondary-metric-icon">
                          <m.icon size={18} />
                        </span>
                        <div>
                          <span>{m.label}</span>
                          <strong>{m.value}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                  <ConversionFunnel data={data} />
                  <div className="analytics-grid">
                    <section className="panel revenue-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Resultado ao longo do tempo</h2>
                          <p>Acompanhe a evolução da sua operação</p>
                        </div>
                        <div className="segmented small">
                          <button
                            className={chartDisplay === 'revenue' ? 'selected' : ''}
                            onClick={() => setChartDisplay('revenue')}
                          >
                            Faturamento
                          </button>
                          <button
                            className={chartDisplay === 'profit' ? 'selected' : ''}
                            onClick={() => setChartDisplay('profit')}
                          >
                            Lucro
                          </button>
                        </div>
                      </div>
                      <div className="chart-summary">
                        <strong>
                          {brl(
                            chartDisplay === 'revenue' ? data.metrics.revenue : data.metrics.profit,
                          )}
                        </strong>
                        <div className="chart-legend">
                          <span>
                            <i className="legend-dot blue" />
                            {chartDisplay === 'revenue' ? 'Faturamento' : 'Lucro sobre mídia'}
                          </span>
                          <span>
                            <i className="legend-dot muted" />
                            Investimento
                          </span>
                        </div>
                      </div>
                      <RevenueChart data={data.daily} display={chartDisplay} />
                    </section>
                    <section className="panel source-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>De onde vêm as vendas</h2>
                          <p>Faturamento por origem</p>
                        </div>
                        <Link2 size={16} className="muted" />
                      </div>
                      <SourceChart data={data} />
                      <div className="source-list">
                        {data.sources.length ? (
                          data.sources.slice(0, 4).map((s, i) => (
                            <div key={s.source}>
                              <span>
                                <i className={`source-dot source-${i}`} />
                                {sourceName(s.source)}
                              </span>
                              <strong>
                                {decimal(
                                  data.metrics.revenue
                                    ? (s.revenue / data.metrics.revenue) * 100
                                    : 0,
                                  1,
                                )}
                                %<small>{brl(s.revenue)}</small>
                              </strong>
                            </div>
                          ))
                        ) : (
                          <p className="muted">As origens aparecerão após a primeira venda.</p>
                        )}
                      </div>
                    </section>
                  </div>
                  <div className="bottom-grid">
                    <section className="panel recent-sales">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Últimas vendas<Badge tone="neutral">{data.sales.length}</Badge>
                          </h2>
                          <p>Conversões que movimentam sua operação</p>
                        </div>
                        <button className="text-button" onClick={() => navigate('sales')}>
                          Ver todas
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <SalesTable
                        sales={data.sales.slice(0, 5)}
                        compact
                        onSelect={setSelectedSale}
                      />
                    </section>
                    <section className="panel operation-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Saúde da operação</h2>
                          <p>Seu rastreamento em um olhar</p>
                        </div>
                        <Activity size={17} className="text-green" />
                      </div>
                      <div className="health-stat">
                        <div>
                          <span>Taxa de conversão</span>
                          <strong>
                            {decimal(data.metrics.conversion, 1)}
                            <small>%</small>
                          </strong>
                        </div>
                        <svg viewBox="0 0 110 50">
                          <path d="M2 43 16 32 29 36 44 18 59 24 72 10 85 17 108 3" />
                        </svg>
                      </div>
                      <div className="health-row">
                        <span>
                          <span className="tiny-dot green" />
                          Vendas aprovadas
                        </span>
                        <strong>{number(data.metrics.sales)}</strong>
                      </div>
                      <div className="health-row">
                        <span>
                          <span className="tiny-dot amber" />
                          Aguardando pagamento
                        </span>
                        <strong>{number(data.metrics.pending)}</strong>
                      </div>
                      <div className="health-divider" />
                      <div className="integration-nudge">
                        <span className="nudge-icon">
                          <Link2 size={18} />
                        </span>
                        <div>
                          <strong>Conecte mais possibilidades</strong>
                          <p>Centralize suas fontes de dados.</p>
                        </div>
                      </div>
                      <button
                        className="button secondary full-width"
                        onClick={() => navigate('integrations')}
                      >
                        Gerenciar integrações
                        <ArrowUpRight size={14} />
                      </button>
                    </section>
                  </div>
                </>
              )}
              {page === 'campaigns' && (
                <>
                  <div className="inline-notice">
                    <CircleHelp size={15} />
                    Em itens conectados à Meta, confira a conta e confirme para alterar status, nome
                    ou orçamento. Campanhas manuais são gerenciadas na WeTrack.
                  </div>
                  <MetricCards metrics={data.metrics} />
                  <CampaignManager
                    data={data}
                    onToggle={updateCampaign}
                    onCreate={() => setModal('campaign')}
                    onExport={notify}
                    onReload={() => load(true)}
                  />
                </>
              )}
              {page === 'sales' && (
                <SalesPage data={data} onSelect={setSelectedSale} notify={notify} />
              )}
              {page === 'visits' && (
                <VisitorsPage data={data} onConnect={() => navigate('integrations')} />
              )}
              {page === 'rules' && (
                <RulesPage
                  key={project}
                  project={project}
                  creating={modal === 'rule'}
                  onClose={() => setModal(null)}
                  notify={notify}
                  onDataChange={() => void load(true)}
                />
              )}
              {page === 'integrations' && (
                <IntegrationsPage
                  project={project}
                  notify={notify}
                  onDataChange={() => void load(true)}
                />
              )}
              {page === 'settings' && (
                <SettingsPage
                  notify={notify}
                  localMode={localMode}
                  onLogout={() => setAuthenticated(false)}
                />
              )}
              {page === 'notifications' && (
                <section className="panel">
                  <NotificationList data={data} onSelect={setSelectedSale} />
                </section>
              )}
            </div>
          )}
          <footer className="app-footer">
            <span>
              <span className="tiny-dot green" />
              {loading ? 'Atualizando dados…' : `Atualizado às ${lastUpdated || '—'}`}
              <span className="footer-zone">· Horário de Brasília</span>
            </span>
            <span>
              Feito para conectar resultados.
              <Brand small />
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">
          <span>{toast.error ? <X size={17} /> : <Check size={17} />}</span>
          {toast.message}
          <button
            className="icon-button"
            aria-label="Dispensar aviso"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {customOpen && (
        <Modal
          title="Escolha o período"
          subtitle="Consulte até 366 dias por vez."
          onClose={() => setCustomOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const start = String(form.get('start')),
                end = String(form.get('end'));
              if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365)
                return notify('Escolha um intervalo válido de até 366 dias.', true);
              setCustomDates({ start, end });
              setPeriod('custom');
              setCustomOpen(false);
            }}
          >
            <div className="form-grid">
              <label>
                Data inicial
                <input
                  type="date"
                  name="start"
                  required
                  defaultValue={data?.start || customDates.start}
                  max={localDay()}
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  name="end"
                  required
                  defaultValue={data?.end || customDates.end}
                  max={localDay()}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCustomOpen(false)}
              >
                Cancelar
              </button>
              <button className="button primary">Aplicar período</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'campaign' && (
        <Modal
          title="Nova campanha"
          subtitle="Cadastre uma campanha para organizar e atribuir suas vendas."
          onClose={() => setModal(null)}
        >
          <form onSubmit={(e) => void saveForm(e, 'campaign')}>
            <label>
              Nome da campanha
              <input
                name="name"
                placeholder="Ex.: [CONVERSÃO] Meu produto"
                required
                minLength={3}
                maxLength={100}
              />
            </label>
            <div className="form-grid">
              <label>
                Plataforma
                <select name="source">
                  <option>Meta Ads</option>
                  <option>Google Ads</option>
                  <option>TikTok Ads</option>
                </select>
              </label>
              <label>
                Orçamento diário (R$)
                <input
                  name="budget"
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  placeholder="150,00"
                  required
                />
              </label>
            </div>
            <div className="inline-notice">
              <CircleHelp size={16} />
              Este cadastro é local. Use o nome ou ID da campanha no campo utm_campaign dos webhooks
              para atribuir vendas.
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button primary" disabled={saving}>
                {saving && <Spinner />}Criar campanha
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="Vamos conectar sua operação"
          subtitle="Três passos para começar a rastrear com a WeTrack."
          onClose={() => setModal(null)}
        >
          <div className="help-steps">
            {[
              [
                '01',
                'Crie seu pixel',
                'Cadastre o domínio e instale o script na sua página após o consentimento aplicável.',
              ],
              [
                '02',
                'Conecte suas vendas',
                'Gere um token e envie os pedidos no formato da API personalizada.',
              ],
              [
                '03',
                'Acompanhe seus resultados',
                'Use UTMs para ligar cada venda à campanha que a originou.',
              ],
            ].map(([n, title, text]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="inline-notice">
            <CircleHelp size={17} />
            Esta versão tem armazenamento local em SQLite. Meta por token e CAPI exigem credenciais
            oficiais. OAuth e adaptadores nativos de checkout ainda não estão disponíveis.
          </div>
          <button
            className="button primary full-width"
            onClick={() => {
              setModal(null);
              navigate('integrations');
            }}
          >
            Ir para integrações
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {selectedSale && (
        <Modal
          title="Detalhes da venda"
          subtitle={`Pedido ${selectedSale.external_id}`}
          onClose={() => setSelectedSale(null)}
        >
          <div className="sale-detail-total">
            <strong>{brl(selectedSale.amount)}</strong>
            <Badge tone={statusTone[selectedSale.status]}>{statusLabel[selectedSale.status]}</Badge>
          </div>
          <dl className="detail-list">
            {[
              ['Produto', selectedSale.product],
              ['Cliente', selectedSale.customer_name],
              ['E-mail', selectedSale.customer_email || 'Não informado'],
              [
                'Pagamento',
                paymentName[selectedSale.payment_method] || selectedSale.payment_method,
              ],
              ['Origem', sourceName(selectedSale.utm_source)],
              ['Campanha atribuída', selectedSale.campaign_name || 'Sem atribuição'],
              ['Data', dateTime(selectedSale.created_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <SaleAttribution
            key={`${project}:${selectedSale.id}`}
            sale={selectedSale}
            onSaved={(sale) => {
              setSelectedSale(sale);
              notify('Atribuição da venda salva.');
              void load(true);
            }}
          />
        </Modal>
      )}
      {searchOpen && (
        <Modal title="Encontre na WeTrack" onClose={() => setSearchOpen(false)}>
          <SearchBox
            value={command}
            onChange={setCommand}
            placeholder="Buscar páginas ou campanhas…"
          />
          <div className="command-results">
            {navigation
              .filter((n) => n.label.toLowerCase().includes(command.toLowerCase()))
              .map((n) => (
                <button key={n.id} onClick={() => navigate(n.id)}>
                  <n.icon size={18} />
                  <span>{n.label}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            {command &&
              data?.campaigns
                .filter((c) => c.name.toLowerCase().includes(command.toLowerCase()))
                .map((c) => (
                  <button key={c.id} onClick={() => navigate('campaigns')}>
                    <Megaphone size={18} />
                    <span>{c.name}</span>
                    <ArrowRight size={14} />
                  </button>
                ))}
          </div>
        </Modal>
      )}
      {notificationsOpen && (
        <div
          className="drawer-backdrop"
          onClick={(e) => {
            if (e.currentTarget === e.target) setNotificationsOpen(false);
          }}
        >
          <aside className="notification-drawer">
            <div className="modal-heading">
              <div>
                <h2>Seu radar</h2>
                <p>As últimas atualizações da operação.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Fechar notificações"
                onClick={() => setNotificationsOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="notification-read">
              <CheckCheck size={14} />
              Você está em dia
            </div>
            {data && (
              <NotificationList
                data={data}
                onSelect={(s) => {
                  setNotificationsOpen(false);
                  setSelectedSale(s);
                }}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function SourceChart({ data }: { data: Dashboard }) {
  const colors = ['#4c83fa', '#57b9cd', '#a298f0', '#5c647c'];
  let position = 0;
  const stops = data.sources
    .map((s, i) => {
      const start = position;
      position += data.metrics.revenue ? (s.revenue / data.metrics.revenue) * 100 : 0;
      return `${colors[i % colors.length]} ${start}% ${position}%`;
    })
    .join(',');
  return (
    <div className="donut-container">
      <div
        className="donut"
        style={{ background: data.metrics.revenue ? `conic-gradient(${stops})` : 'var(--border)' }}
      >
        <div>
          <span>Vendas aprovadas</span>
          <strong>{number(data.metrics.sales)}</strong>
          <small>no período</small>
        </div>
      </div>
    </div>
  );
}
function SalesTable({
  sales,
  onSelect,
  compact = false,
}: {
  sales: Sale[];
  onSelect: (s: Sale) => void;
  compact?: boolean;
}) {
  return sales.length ? (
    <div className="table-scroll">
      <table className="data-table sales-table">
        <thead>
          <tr>
            <th>Produto / Cliente</th>
            {!compact && <th>Origem</th>}
            {!compact && <th>Atribuição</th>}
            <th>Valor</th>
            <th>Status</th>
            <th>
              Data
              <ChevronDown size={11} />
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => (
            <tr key={s.id} onClick={() => onSelect(s)}>
              <td>
                <div className="product-cell">
                  <span className={`product-icon product-${i % 3}`}>
                    <ShoppingBag size={15} />
                  </span>
                  <div>
                    <strong>{s.product}</strong>
                    <small>{s.customer_name}</small>
                  </div>
                </div>
              </td>
              {!compact && (
                <td>
                  <span className="source-cell">
                    <span className="platform-icon">{s.utm_source === 'google' ? 'G' : '∞'}</span>
                    {sourceName(s.utm_source)}
                  </span>
                </td>
              )}
              {!compact && (
                <td className="sale-attribution-cell">
                  <strong>{s.campaign_name || 'Sem atribuição'}</strong>
                  <small>
                    {[s.adset_name, s.ad_name].filter(Boolean).join(' / ') ||
                      (s.campaign_id ? 'Somente campanha' : 'Atribua esta venda')}
                  </small>
                  {s.attribution_method === 'manual' && <Badge tone="neutral">Manual</Badge>}
                </td>
              )}
              <td className="amount-cell">
                {brl(s.amount)}
                <small>{paymentName[s.payment_method]}</small>
              </td>
              <td>
                <Badge tone={statusTone[s.status]}>{statusLabel[s.status]}</Badge>
              </td>
              <td className="date-cell">{dateTime(s.created_at)}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Ver pedido ${s.external_id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(s);
                  }}
                >
                  <ArrowUpRight size={15} />
                  {!compact && !s.campaign_id && (
                    <span className="sale-assign-label">Atribuir</span>
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      icon={<ShoppingBag size={25} />}
      title="As próximas vendas começam aqui"
      text="Conecte um webhook para receber suas vendas e acompanhar a atribuição."
    />
  );
}
function SalesPage({
  data,
  onSelect,
  notify,
}: {
  data: Dashboard;
  onSelect: (s: Sale) => void;
  notify: (s: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [attribution, setAttribution] = useState('all'),
    [page, setPage] = useState(1);
  const filtered = data.sales.filter(
    (s) =>
      (status === 'all' || s.status === status) &&
      (attribution === 'all' || s.attribution_method === attribution) &&
      `${s.product} ${s.customer_name} ${s.external_id} ${s.utm_source} ${s.utm_medium} ${s.utm_campaign} ${s.utm_term || ''} ${s.utm_content} ${s.campaign_name || ''} ${s.adset_name || ''} ${s.ad_name || ''} ${s.adset_reference || ''} ${s.ad_reference || ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => setPage(1), [query, status, attribution, data]);
  return (
    <>
      <div className="sales-summary">
        <div>
          <span>Faturamento aprovado</span>
          <strong>{brl(data.metrics.revenue)}</strong>
        </div>
        <div>
          <span>Vendas aprovadas</span>
          <strong>{number(data.metrics.sales)}</strong>
        </div>
        <div>
          <span>Ticket médio</span>
          <strong>{brl(data.metrics.ticket)}</strong>
        </div>
        <div>
          <span>Aguardando pagamento</span>
          <strong>{data.metrics.pending}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="segmented">
            {[
              ['all', 'Todas'],
              ['approved', 'Aprovadas'],
              ['pending', 'Pendentes'],
              ['refunded', 'Reembolsadas'],
              ['canceled', 'Canceladas'],
              ['disputed', 'Em disputa'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={status === value ? 'selected' : ''}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="button secondary"
            onClick={() => {
              downloadCsv('wetrack-vendas.csv', [
                [
                  'Pedido',
                  'Produto',
                  'Cliente',
                  'Valor',
                  'Status',
                  'Origem',
                  'Campanha atribuída',
                  'Conjunto atribuído',
                  'Anúncio atribuído',
                  'Atribuição',
                  'utm_source',
                  'utm_medium',
                  'utm_campaign',
                  'utm_term',
                  'utm_content',
                  'Referência conjunto',
                  'Referência anúncio',
                  'Data',
                ],
                ...filtered.map((s) => [
                  s.external_id,
                  s.product,
                  s.customer_name,
                  s.amount,
                  statusLabel[s.status],
                  s.utm_source,
                  s.campaign_name || '',
                  s.adset_name || '',
                  s.ad_name || '',
                  s.attribution_method === 'manual'
                    ? 'Manual'
                    : s.campaign_id
                      ? 'Automática'
                      : 'Sem atribuição',
                  s.utm_source,
                  s.utm_medium,
                  s.utm_campaign,
                  s.utm_term || '',
                  s.utm_content,
                  s.adset_reference || '',
                  s.ad_reference || '',
                  s.created_at,
                ]),
              ]);
              notify('Vendas exportadas.');
            }}
          >
            <ArrowDownToLine size={14} />
            Exportar CSV
          </button>
        </div>
        <div className="search-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Buscar por produto, cliente ou pedido…"
          />
          <select
            aria-label="Filtrar atribuição"
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
          >
            <option value="all">Todas as atribuições</option>
            <option value="unattributed">Sem atribuição</option>
            <option value="manual">Atribuição manual</option>
            <option value="automatic">Atribuição automática</option>
          </select>
          <span className="muted">{number(filtered.length)} vendas encontradas</span>
        </div>
        {filtered.length ? (
          <SalesTable sales={filtered.slice((page - 1) * 8, page * 8)} onSelect={onSelect} />
        ) : (
          <Empty
            icon={<Search size={25} />}
            title="Nenhuma venda encontrada"
            text="Experimente outro filtro ou outro período."
          />
        )}
        <Pagination page={page} total={filtered.length} onChange={setPage} />
      </section>
    </>
  );
}
function NotificationList({ data, onSelect }: { data: Dashboard; onSelect: (s: Sale) => void }) {
  return (
    <div className="notification-list">
      {data.rules
        .filter((r) => r.action === 'alert' && r.matches.length)
        .map((r) => (
          <div className="notification-item" key={r.id}>
            <span className="notification-icon amber">
              <Bell size={17} />
            </span>
            <div>
              <strong>{r.name}</strong>
              <p>{r.matches.join(', ')}</p>
              <small>
                Alerta no painel
                {r.notify_push ? ' · push reservado para o app' : ''}
              </small>
            </div>
          </div>
        ))}
      {data.sales
        .filter((s) => s.status === 'approved')
        .slice(0, 6)
        .map((s) => (
          <button className="notification-item" key={s.id} onClick={() => onSelect(s)}>
            <span className="notification-icon green">
              <ShoppingBag size={17} />
            </span>
            <div>
              <strong>
                Mais uma venda por aqui!<b>{brl(s.amount)}</b>
              </strong>
              <p>{s.product}</p>
              <small>{dateTime(s.created_at)}</small>
            </div>
          </button>
        ))}
      {!data.sales.length && (
        <Empty
          icon={<Bell size={24} />}
          title="Tudo tranquilo por aqui"
          text="Novas vendas e alertas da sua operação aparecerão aqui."
        />
      )}
    </div>
  );
}
function SettingsPage({
  notify,
  localMode,
  onLogout,
}: {
  notify: (s: string, error?: boolean) => void;
  localMode: boolean;
  onLogout: () => void;
}) {
  const [settings, setSettings] = useState({
    name: 'Minha conta',
    email: 'operacao@exemplo.com',
    sale_alerts: true,
    rule_alerts: true,
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<Partial<typeof settings>>('/settings')
      .then((s) => setSettings((old) => ({ ...old, ...s })))
      .catch((e) => notify(e.message, true));
  }, [notify]);
  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Perfil do workspace</h2>
            <p>As informações da sua operação</p>
          </div>
          <Settings2 size={19} className="muted" />
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await mutate('/settings', 'PUT', settings);
              notify('Preferências salvas.');
            } catch (e) {
              notify((e as Error).message, true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            Nome
            <input
              required
              minLength={2}
              maxLength={100}
              value={settings.name}
              onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
            />
          </label>
          <label>
            E-mail
            <input
              required
              type="email"
              value={settings.email}
              onChange={(e) => setSettings((s) => ({ ...s, email: e.target.value }))}
            />
          </label>
          <div className="settings-switch">
            <div>
              <strong>Preferência de alertas de venda</strong>
              <p>Salva para a futura integração de notificações push.</p>
            </div>
            <Toggle
              checked={settings.sale_alerts}
              label="Alertas de vendas"
              onChange={() => setSettings((s) => ({ ...s, sale_alerts: !s.sale_alerts }))}
            />
          </div>
          <div className="settings-switch">
            <div>
              <strong>Preferência de alertas de regras</strong>
              <p>Salva para a futura integração de notificações push.</p>
            </div>
            <Toggle
              checked={settings.rule_alerts}
              label="Alertas de regras"
              onChange={() => setSettings((s) => ({ ...s, rule_alerts: !s.rule_alerts }))}
            />
          </div>
          <div className="modal-actions">
            <button className="button primary" disabled={saving}>
              {saving && <Spinner />}Salvar alterações
            </button>
          </div>
        </form>
      </section>
      <section className="panel environment-panel">
        <ShieldCheck size={28} />
        <h2>Seu ambiente</h2>
        <dl className="detail-list">
          <div>
            <dt>Armazenamento</dt>
            <dd>SQLite local</dd>
          </div>
          <div>
            <dt>Fuso horário</dt>
            <dd>Brasília (UTC−3)</dd>
          </div>
          <div>
            <dt>Acesso</dt>
            <dd>{localMode ? 'Local, sem senha' : 'Sessão autenticada'}</dd>
          </div>
          <div>
            <dt>Versão</dt>
            <dd>0.1.0 · MVP</dd>
          </div>
        </dl>
        {!localMode && (
          <button
            className="button secondary full-width"
            onClick={async () => {
              await mutate('/logout', 'POST');
              onLogout();
            }}
          >
            <LogOut size={15} />
            Sair da conta
          </button>
        )}
        <p className="muted">
          Para publicar o painel, configure domínio HTTPS, senha de administrador e backup do banco.
        </p>
      </section>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-card">
        <Brand />
        <div className="eyebrow">CADA CLIQUE, UMA DECISÃO MELHOR</div>
        <h1>Bom ter você de volta.</h1>
        <p>Entre para acompanhar sua operação.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const password = new FormData(e.currentTarget).get('password');
            try {
              await mutate('/login', 'POST', { password });
              onLogin();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Senha de administrador
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p className="text-red" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full-width" disabled={busy}>
            {busy && <Spinner />}Entrar no workspace
            <ArrowRight size={16} />
          </button>
        </form>
        <nav className="login-legal" aria-label="Informações da WeTrack">
          <a href="/privacy.html">Privacidade</a>
          <a href="/terms.html">Termos</a>
          <a href="/data-deletion.html">Exclusão de dados</a>
        </nav>
      </div>
    </div>
  );
}

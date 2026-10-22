import { useState } from 'react';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleCheck,
  CreditCard,
  Globe,
  Layers3,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  Menu,
  MousePointer2,
  Plus,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import './landing.css';

const money = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const checkoutUrls = {
  monthly: import.meta.env.VITE_CAKTO_MONTHLY_CHECKOUT_URL as string | undefined,
  annual: import.meta.env.VITE_CAKTO_ANNUAL_CHECKOUT_URL as string | undefined,
};

function caktoCheckout(value?: string) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' &&
      url.origin === 'https://pay.cakto.com.br' &&
      !url.username &&
      !url.password &&
      url.pathname.length > 1
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function LandingBrand() {
  return (
    <a className="lp-brand" href="/" aria-label="WeTrack — início">
      <span className="lp-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <path d="m7 13 6 15 7-12 6 12 7-15" />
        </svg>
      </span>
      <span>
        we<span>track</span>
        <i />
      </span>
    </a>
  );
}

const previewMetrics = [
  { label: 'Faturamento', value: 'R$ 12.840,00', trend: '+24,8%', icon: Wallet },
  { label: 'Lucro sobre mídia', value: 'R$ 8.560,00', trend: '+18,6%', icon: TrendingUp },
  { label: 'ROAS', value: '3,00x', trend: '+0,42', icon: Target },
];

function DashboardPreview() {
  return (
    <figure className="lp-preview" aria-label="Prévia ilustrativa do dashboard WeTrack">
      <div className="lp-preview-top">
        <div className="lp-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>
          <LockKeyhole size={10} /> seu workspace · wetrack
        </span>
        <span className="lp-preview-live">
          <i /> conectado
        </span>
      </div>
      <div className="lp-preview-layout">
        <div className="lp-preview-sidebar" aria-hidden="true">
          <img src="/favicon.svg" alt="" />
          <span className="active">
            <LayoutDashboard size={16} />
          </span>
          <span>
            <BarChart3 size={16} />
          </span>
          <span>
            <ShoppingBag size={16} />
          </span>
          <span>
            <MousePointer2 size={16} />
          </span>
          <span>
            <Link2 size={16} />
          </span>
          <span className="lp-preview-settings">
            <SlidersHorizontal size={16} />
          </span>
        </div>
        <div className="lp-preview-main">
          <div className="lp-preview-heading">
            <div>
              <span>VISÃO GERAL</span>
              <h3>Sua operação em foco.</h3>
            </div>
            <span className="lp-preview-period">
              Últimos 7 dias <ChevronDown size={11} />
            </span>
          </div>
          <div className="lp-preview-metrics">
            {previewMetrics.map(({ label, value, trend, icon: Icon }) => (
              <div key={label}>
                <span>
                  <Icon size={12} />
                  {label}
                </span>
                <strong>{value}</strong>
                <small>
                  <ArrowUpRight size={11} /> {trend} <span>vs. anterior</span>
                </small>
              </div>
            ))}
          </div>
          <div className="lp-chart">
            <div className="lp-chart-heading">
              <strong>O caminho do seu resultado</strong>
              <span>
                <i /> Faturamento
              </span>
            </div>
            <div className="lp-chart-body">
              <div className="lp-chart-scale">
                <span>15 mil</span>
                <span>10 mil</span>
                <span>5 mil</span>
              </div>
              <svg
                viewBox="0 0 440 132"
                preserveAspectRatio="none"
                role="img"
                aria-label="Gráfico ilustrativo de faturamento crescente"
              >
                <defs>
                  <linearGradient id="lp-chart-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#578bff" stopOpacity=".25" />
                    <stop offset="100%" stopColor="#578bff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className="lp-chart-grid" d="M0 15H440M0 55H440M0 95H440" />
                <path
                  d="M0 116C20 116 28 91 48 98S80 117 99 87 124 97 146 66 175 87 197 59 222 67 245 41 274 64 294 38 324 56 343 25 370 47 390 20 420 27 440 8V132H0Z"
                  fill="url(#lp-chart-fill)"
                />
                <path
                  d="M0 116C20 116 28 91 48 98S80 117 99 87 124 97 146 66 175 87 197 59 222 67 245 41 274 64 294 38 324 56 343 25 370 47 390 20 420 27 440 8"
                  fill="none"
                  stroke="#6b99ff"
                  strokeWidth="2.5"
                />
              </svg>
            </div>
            <div className="lp-chart-dates">
              <span>Seg</span>
              <span>Ter</span>
              <span>Qua</span>
              <span>Qui</span>
              <span>Sex</span>
              <span>Sáb</span>
              <span>Dom</span>
            </div>
          </div>
          <div className="lp-preview-sales">
            <span>
              <i />
              <strong>Venda aprovada</strong>
              <span>Cakto · agora</span>
            </span>
            <b>+ R$ 197,00</b>
          </div>
        </div>
      </div>
      <figcaption>Prévia do produto. Dados ilustrativos.</figcaption>
      <div className="lp-zero-note">
        <span>
          <Check size={16} />
        </span>
        <div>
          Mais uma venda.<strong>R$ 0,00 de taxa WeTrack.</strong>
        </div>
        <ArrowUpRight size={17} />
      </div>
    </figure>
  );
}

const faqs = [
  {
    question: 'É um plano só, mesmo?',
    answer:
      'Sim. O plano WeTrack inclui todos os recursos apresentados nesta página. Você escolhe apenas a forma de cobrança: R$ 29,90 por mês ou R$ 238,80 por ano, equivalente a R$ 19,90 por mês. Os recursos são os mesmos.',
  },
  {
    question: 'O que significa dashboard infinito?',
    answer:
      'Você pode criar dashboards para organizar suas operações sem limite de quantidade no plano. Separe produtos e projetos em workspaces e acompanhe os indicadores de cada operação em seu próprio painel.',
  },
  {
    question: 'Existe alguma taxa por venda aprovada?',
    answer:
      'A WeTrack cobra R$ 0 por venda aprovada. Você paga somente a assinatura da plataforma. As taxas do seu gateway de pagamento, checkout e plataformas de anúncios são cobradas pelos respectivos serviços e continuam sendo aplicáveis.',
  },
  {
    question: 'Como funciona o pagamento pela Cakto?',
    answer:
      'As assinaturas da WeTrack usam o checkout da Cakto. Escolha a cobrança mensal ou anual na seção do plano para consultar a disponibilidade da assinatura. Confira no checkout o valor total e as condições de pagamento antes de concluir.',
  },
  {
    question: 'Consigo acompanhar a origem das vendas?',
    answer:
      'Sim. Ao conectar suas contas e configurar o pixel, as UTMs e a integração de vendas, você pode acompanhar campanhas, visitas e vendas atribuídas. A qualidade da atribuição depende dos dados recebidos e das permissões das plataformas conectadas.',
  },
  {
    question: 'Já tenho acesso. Como entro no painel?',
    answer:
      'Use o botão “Entrar” no topo desta página para abrir seu workspace e informar sua senha de acesso. Se você já estiver com a sessão ativa, o painel abre diretamente.',
  },
];

export default function Landing() {
  const [annual, setAnnual] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sales, setSales] = useState(1000);
  const [fee, setFee] = useState('0.15');
  const checkout = caktoCheckout(annual ? checkoutUrls.annual : checkoutUrls.monthly);
  const extraFees = sales * Number(fee);

  return (
    <div className="landing">
      <a className="lp-skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="lp-announcement">
        <span>MENOS CUSTO. MAIS MARGEM.</span> Seu tracking a partir de{' '}
        <strong>R$ 19,90/mês</strong>
        <a href="#plano">
          no anual <ArrowUpRight size={13} />
        </a>
      </div>
      <header className="lp-header">
        <div className="lp-container lp-nav">
          <LandingBrand />
          <nav
            className={menuOpen ? 'lp-nav-links is-open' : 'lp-nav-links'}
            aria-label="Navegação principal"
          >
            <a href="#recursos" onClick={() => setMenuOpen(false)}>
              Recursos
            </a>
            <a href="#economia" onClick={() => setMenuOpen(false)}>
              Sua economia
            </a>
            <a href="#plano" onClick={() => setMenuOpen(false)}>
              Plano único
            </a>
            <a href="#duvidas" onClick={() => setMenuOpen(false)}>
              Dúvidas
            </a>
          </nav>
          <div className="lp-nav-actions">
            <a className="lp-login" href="/app">
              Entrar <ArrowUpRight size={14} />
            </a>
            <a className="lp-button lp-button-small" href="#plano">
              Quero minha WeTrack <ArrowRight size={14} />
            </a>
          </div>
          <button
            className="lp-menu-toggle"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="conteudo">
        <section className="lp-hero lp-container">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">
              <span className="lp-status-dot" /> UM PLANO. TODA A SUA OPERAÇÃO.
            </div>
            <h1>
              Seu lucro cresce.
              <br />A mensalidade,
              <br />
              <span>não.</span>
              <svg className="lp-hero-arrow" viewBox="0 0 100 68" aria-hidden="true">
                <path d="M5 56C32 61 56 43 74 14M51 16l26-9 6 27" />
              </svg>
            </h1>
            <p>
              Do clique à venda, enxergue o que dá resultado. Dashboards ilimitados e{' '}
              <strong>taxa zero por venda aprovada.</strong> Tudo em um único plano.
            </p>
            <div className="lp-hero-actions">
              <a className="lp-button" href="#plano">
                Quero rastrear sem limites <ArrowUpRight size={18} />
              </a>
              <a className="lp-text-link" href="#recursos">
                Conhecer a WeTrack <ArrowDown size={15} />
              </a>
            </div>
            <div className="lp-hero-price">
              <Check size={15} />
              <span>
                <strong>R$ 29,90/mês</strong> ou R$ 19,90/mês no anual
              </span>
            </div>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-orbit" aria-hidden="true" />
            <DashboardPreview />
            <span className="lp-visual-caption">
              <span /> SEUS DADOS CONECTADOS. SUA PRÓXIMA DECISÃO, MAIS CLARA.
            </span>
          </div>
        </section>
        <section className="lp-pillars lp-container" aria-label="Os três pilares da WeTrack">
          <div>
            <span className="lp-pillar-value">
              01<span>.</span>
            </span>
            <div>
              <h2>Um plano completo</h2>
              <p>Todos os recursos. Uma assinatura.</p>
            </div>
          </div>
          <div>
            <span className="lp-pillar-value lp-infinity">∞</span>
            <div>
              <h2>Dashboards ilimitados</h2>
              <p>Espaço para cada nova operação.</p>
            </div>
          </div>
          <div>
            <span className="lp-pillar-value">
              0<span>,00</span>
            </span>
            <div>
              <h2>Taxa por venda aprovada</h2>
              <p>Vendeu mais? O lucro continua seu.</p>
            </div>
          </div>
        </section>
        <div className="lp-connections lp-container">
          <p>SEU ECOSSISTEMA, CONECTADO</p>
          <div>
            <span className="lp-meta">
              ∞ <b>Meta Ads</b>
            </span>
            <span className="lp-cakto">
              <Zap size={23} fill="currentColor" />
              cakto
            </span>
            <span className="lp-hotmart">
              <span aria-hidden="true">◒</span> hotmart
            </span>
            <span>blackcat</span>
            <span className="lp-api">
              <Link2 size={19} /> API & webhooks
            </span>
          </div>
        </div>

        <section id="recursos" className="lp-section lp-container">
          <div className="lp-section-heading">
            <div>
              <span className="lp-eyebrow">CLAREZA PARA DECIDIR. LIBERDADE PARA CRESCER.</span>
              <h2>
                Menos abas abertas.
                <br />
                <span>Mais visão do seu negócio.</span>
              </h2>
            </div>
            <p>
              Campanhas, vendas e atribuição no mesmo lugar. Você cuida da estratégia. A WeTrack
              conecta os números.
            </p>
          </div>
          <div className="lp-feature-grid">
            <article className="lp-feature lp-feature-wide">
              <div className="lp-feature-copy">
                <span className="lp-feature-icon">
                  <Layers3 size={21} />
                </span>
                <h3>
                  Seu próximo dashboard?
                  <br />
                  Já está no plano.
                </h3>
                <p>
                  Uma operação ou várias. Organize seus projetos em workspaces e acompanhe cada
                  resultado com espaço para crescer.
                </p>
                <span className="lp-feature-tag">
                  <Check size={13} /> Dashboards ilimitados, de verdade
                </span>
              </div>
              <div className="lp-workspace-demo" aria-hidden="true">
                <div>
                  <span className="lp-demo-avatar">L</span>
                  <span>
                    Minha operação<small>Visão geral do negócio</small>
                  </span>
                  <span className="lp-demo-number">01</span>
                </div>
                <div>
                  <span className="lp-demo-avatar blue">E</span>
                  <span>
                    E-commerce<small>Campanhas e conversões</small>
                  </span>
                  <span className="lp-demo-number">02</span>
                </div>
                <div>
                  <span className="lp-demo-avatar purple">I</span>
                  <span>
                    Infoprodutos<small>Cada oferta, seu espaço</small>
                  </span>
                  <span className="lp-demo-number">03</span>
                </div>
                <div className="lp-new-workspace">
                  <Plus size={16} /> Sua próxima operação <span>∞</span>
                </div>
              </div>
            </article>
            <article className="lp-feature lp-feature-zero">
              <span className="lp-feature-icon">
                <Wallet size={21} />
              </span>
              <h3>
                Venda mais.
                <br />
                Sem pagar mais por isso.
              </h3>
              <p>
                Nenhum centavo de taxa WeTrack por venda aprovada. Do primeiro pedido à sua próxima
                escala.
              </p>
              <div className="lp-zero-visual" aria-hidden="true">
                <span>R$</span>0<span>,00</span>
                <small>POR VENDA APROVADA</small>
              </div>
            </article>
            <article className="lp-feature">
              <span className="lp-feature-icon">
                <MousePointer2 size={21} />
              </span>
              <h3>O caminho de cada venda.</h3>
              <p>
                Conecte o clique à conversão com pixel, UTMs e integrações. Descubra as origens que
                trazem resultado.
              </p>
              <div className="lp-journey-demo" aria-hidden="true">
                <span>
                  <MousePointer2 size={17} />
                  Clique
                </span>
                <i />
                <span>
                  <Globe size={17} />
                  Visita
                </span>
                <i />
                <span>
                  <ShoppingBag size={17} />
                  Venda
                </span>
              </div>
            </article>
            <article className="lp-feature">
              <span className="lp-feature-icon">
                <BarChart3 size={21} />
              </span>
              <h3>Os números que importam.</h3>
              <p>
                Faturamento, investimento, lucro sobre mídia, CPA e ROAS. Sua operação em uma visão
                que faz sentido.
              </p>
              <div className="lp-roas-demo" aria-hidden="true">
                <span>
                  ROAS da campanha
                  <strong>
                    3,00<span>x</span>
                  </strong>
                </span>
                <svg viewBox="0 0 160 60">
                  <path d="M2 55 25 43 44 48 67 27 89 34 112 14 135 20 157 4" />
                </svg>
              </div>
            </article>
            <article className="lp-feature">
              <span className="lp-feature-icon">
                <Zap size={21} />
              </span>
              <h3>Sua operação no seu ritmo.</h3>
              <p>
                Gerencie campanhas, configure regras e acompanhe alertas para agir com seus
                indicadores à mão.
              </p>
              <div className="lp-rule-demo" aria-hidden="true">
                <span>
                  <Target size={17} />
                  <span>
                    CPA acima da meta<small>Regra de acompanhamento</small>
                  </span>
                </span>
                <i />
                <small>
                  <CircleCheck size={12} /> Você define. A WeTrack monitora.
                </small>
              </div>
            </article>
          </div>
        </section>

        <section id="economia" className="lp-savings-section">
          <div className="lp-container lp-savings-layout">
            <div className="lp-savings-copy">
              <span className="lp-eyebrow">CENTAVOS POR VENDA. UMA DIFERENÇA NO CAIXA.</span>
              <h2>
                Quanto da sua margem
                <br />
                fica pelo caminho<span>?</span>
              </h2>
              <p>
                Taxa extra em cada venda parece pouco. Até você fazer a conta. Veja quanto deixaria
                de pagar em taxas de tracking com a WeTrack.
              </p>
              <div className="lp-savings-note">
                <ArrowDownLeft size={21} />
                <span>
                  Mais vendas para o seu negócio.
                  <br />
                  <strong>Mais margem para você.</strong>
                </span>
              </div>
            </div>
            <div className="lp-calculator">
              <div className="lp-calculator-title">
                <span>FAÇA A SUA CONTA</span>
                <BarChart3 size={17} />
              </div>
              <label className="lp-sales-label" htmlFor="lp-sales">
                Vendas aprovadas por mês
                <output htmlFor="lp-sales">{sales.toLocaleString('pt-BR')}</output>
              </label>
              <input
                id="lp-sales"
                type="range"
                min="100"
                max="30000"
                step="100"
                value={sales}
                onChange={(e) => setSales(Number(e.target.value))}
              />
              <div className="lp-range-labels">
                <span>100 vendas</span>
                <span>30 mil vendas</span>
              </div>
              <label className="lp-fee-label" htmlFor="lp-fee">
                Taxa de tracking por venda que você paga hoje
                <select id="lp-fee" value={fee} onChange={(e) => setFee(e.target.value)}>
                  <option value="0.10">R$ 0,10</option>
                  <option value="0.15">R$ 0,15</option>
                  <option value="0.30">R$ 0,30</option>
                  <option value="0.50">R$ 0,50</option>
                </select>
              </label>
              <div className="lp-calculator-comparison">
                <div>
                  <span>Taxas extras no mês</span>
                  <strong>{money(extraFees)}</strong>
                </div>
                <ArrowRight size={18} />
                <div>
                  <span>Taxas na WeTrack</span>
                  <strong>R$ 0,00</strong>
                </div>
              </div>
              <div className="lp-calculator-result">
                <span>
                  De taxas para a sua margem
                  <strong>
                    {money(extraFees * 12)}
                    <small>/ano</small>
                  </strong>
                </span>
                <TrendingUp size={27} />
              </div>
              <p>
                Simulação apenas de taxas por venda. A assinatura WeTrack é cobrada à parte. Taxas
                do gateway não estão incluídas.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-section lp-container lp-how">
          <div>
            <span className="lp-eyebrow">DA CONEXÃO À CLAREZA</span>
            <h2>
              Seu tracking,
              <br />
              <span>sem complicar.</span>
            </h2>
            <p>Conecte as peças da sua operação e comece a acompanhar o que importa.</p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Conecte sua operação</h3>
                <p>Vincule suas contas de anúncios e a plataforma que recebe suas vendas.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Configure seu rastreamento</h3>
                <p>Instale o pixel e adicione as UTMs para acompanhar o caminho dos visitantes.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Transforme dados em decisões</h3>
                <p>Abra seu dashboard e veja campanhas, vendas e resultados juntos.</p>
              </div>
            </li>
          </ol>
        </section>

        <section id="plano" className="lp-section lp-container lp-pricing-section">
          <div className="lp-pricing-copy">
            <span className="lp-eyebrow">SEM ESCOLHER O QUE FICA DE FORA</span>
            <h2>
              Plano único.
              <br />
              Possibilidades <span>infinitas.</span>
            </h2>
            <p>
              Seu negócio não precisa caber em uma tabela de planos. A WeTrack inteira cabe na sua
              operação.
            </p>
            <div className="lp-pricing-promise">
              <ShieldCheck size={22} />
              <span>
                Você cresce. O plano acompanha.
                <small>Sem cobrança WeTrack por venda aprovada.</small>
              </span>
            </div>
            <a className="lp-text-link" href="#duvidas">
              Ainda tem alguma dúvida? <ArrowDown size={15} />
            </a>
          </div>
          <div className="lp-price-card">
            <div className="lp-price-card-top">
              <span>
                <img src="/favicon.svg" alt="" />
                WeTrack completo
              </span>
              <span className="lp-price-badge">UM PLANO. TUDO INCLUSO.</span>
            </div>
            <div className="lp-billing-toggle" role="group" aria-label="Período da assinatura">
              <button aria-pressed={!annual} onClick={() => setAnnual(false)}>
                Mensal
              </button>
              <button aria-pressed={annual} onClick={() => setAnnual(true)}>
                Anual <span>−33%</span>
              </button>
            </div>
            <div className="lp-price" aria-live="polite">
              <span>R$</span>
              <strong>{annual ? '19,90' : '29,90'}</strong>
              <span>/mês</span>
            </div>
            <p className="lp-billing-detail">
              {annual
                ? 'R$ 238,80 cobrados por ano. Economize R$ 120,00.'
                : 'R$ 29,90 cobrados por mês.'}
            </p>
            <div className="lp-price-divider" />
            <ul>
              {[
                'Dashboards e workspaces ilimitados',
                'R$ 0 de taxa por venda aprovada',
                'Campanhas, vendas e lucro no mesmo lugar',
                'Pixel de rastreio e atribuição por UTMs',
                'Integrações com suas plataformas de vendas',
                'Regras, alertas e relatórios',
              ].map((item) => (
                <li key={item}>
                  <Check size={16} />
                  {item}
                </li>
              ))}
            </ul>
            {checkout ? (
              <a className="lp-button lp-subscribe" href={checkout}>
                Assinar com Cakto <ArrowUpRight size={18} />
              </a>
            ) : (
              <>
                <button className="lp-button lp-subscribe" disabled>
                  Assinaturas em breve
                </button>
                <p className="lp-checkout-pending">
                  Estamos preparando as assinaturas. Já tem acesso?{' '}
                  <a href="/app">Entre no seu painel.</a>
                </p>
              </>
            )}
            <div className="lp-secure-checkout">
              <LockKeyhole size={12} /> Checkout com Cakto <span>·</span>
              <CreditCard size={13} /> Pagamento seguro
            </div>
            <p className="lp-gateway-note">
              Taxa zero refere-se ao uso da WeTrack por venda. Tarifas do gateway e de outros
              serviços seguem suas próprias condições.
            </p>
          </div>
        </section>

        <section id="duvidas" className="lp-section lp-container lp-faq">
          <div>
            <span className="lp-eyebrow">TUDO ÀS CLARAS</span>
            <h2>
              Sem asteriscos.
              <br />
              <span>Sem ficar na dúvida.</span>
            </h2>
            <p>O que você precisa saber antes de dar o próximo passo.</p>
          </div>
          <div className="lp-faq-items">
            {faqs.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <Plus size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="lp-final lp-container">
          <span className="lp-eyebrow">CADA CLIQUE, UMA DECISÃO MELHOR.</span>
          <h2>
            O próximo nível da sua operação
            <br />
            começa com <span>clareza.</span>
          </h2>
          <p>Um plano. Dashboards ilimitados. Nenhuma taxa WeTrack por venda.</p>
          <a className="lp-button" href="#plano">
            Quero minha WeTrack <ArrowUpRight size={18} />
          </a>
          <span className="lp-final-infinity" aria-hidden="true">
            ∞
          </span>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <div>
          <LandingBrand />
          <p>Clareza nos dados. Liberdade para crescer.</p>
        </div>
        <nav aria-label="Links do rodapé">
          <a href="/app">
            Acessar painel <ArrowUpRight size={12} />
          </a>
          <a href="/terms.html">Termos de uso</a>
          <a href="/privacy.html">Privacidade</a>
        </nav>
        <span>© {new Date().getFullYear()} WeTrack</span>
      </footer>
    </div>
  );
}

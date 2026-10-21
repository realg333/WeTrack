import { brl, decimal, number } from './lib';
import type { HierarchyRow } from './types';

export type Column = {
  id: string;
  label: string;
  group: string;
  format: 'money' | 'number' | 'percent' | 'ratio' | 'seconds';
  description: string;
};
const group = (name: string, entries: [string, string, Column['format'], string][]): Column[] =>
  entries.map(([id, label, format, description]) => ({
    id,
    label,
    format,
    description,
    group: name,
  }));
export const columns: Column[] = [
  ...group('Resultados e vendas', [
    ['budget', 'Orçamento/dia', 'money', 'Orçamento configurado; não é investimento realizado.'],
    ['spend', 'Investimento', 'money', 'Custo da mídia no período.'],
    [
      'revenue',
      'Faturamento',
      'money',
      'Receita dos pedidos atualmente aprovados, pela data original do pedido.',
    ],
    [
      'profit',
      'Lucro sobre mídia',
      'money',
      'Faturamento aprovado menos investimento. Não desconta taxas ou produto.',
    ],
    ['roas', 'ROAS', 'ratio', 'Faturamento aprovado ÷ investimento.'],
    ['roi', 'ROI sobre mídia', 'percent', 'Lucro sobre mídia ÷ investimento × 100.'],
    ['margin', 'Margem sobre mídia', 'percent', 'Lucro sobre mídia ÷ faturamento × 100.'],
    [
      'sales',
      'Vendas aprovadas',
      'number',
      'Pedidos aprovados dos webhooks atribuídos a esta entidade.',
    ],
    ['cpa', 'CPA', 'money', 'Investimento ÷ vendas aprovadas.'],
    ['ticket', 'Ticket médio', 'money', 'Faturamento aprovado ÷ vendas aprovadas.'],
    ['orders', 'Pedidos gerados', 'number', 'Todos os pedidos, independentemente do status atual.'],
    [
      'approval_rate',
      'Taxa de aprovação',
      'percent',
      'Pedidos aprovados ÷ todos os pedidos × 100.',
    ],
    ['pending', 'Pedidos pendentes', 'number', 'Pedidos atualmente pendentes.'],
    ['pending_amount', 'Valor pendente', 'money', 'Valor dos pedidos pendentes.'],
    ['refunded', 'Reembolsos', 'number', 'Pedidos atualmente reembolsados.'],
    [
      'refunded_amount',
      'Valor reembolsado',
      'money',
      'Valor dos pedidos reembolsados, já excluído do faturamento aprovado.',
    ],
    ['refund_rate', 'Taxa de reembolso', 'percent', 'Reembolsados ÷ todos os pedidos × 100.'],
    ['chargebacks', 'Chargebacks', 'number', 'Pedidos com chargeback.'],
    ['chargeback_amount', 'Valor em chargeback', 'money', 'Valor dos pedidos com chargeback.'],
    ['canceled', 'Cancelados', 'number', 'Pedidos cancelados.'],
    ['pix_sales', 'Vendas Pix', 'number', 'Pedidos aprovados pagos com Pix.'],
    ['card_sales', 'Vendas no cartão', 'number', 'Pedidos aprovados pagos com cartão de crédito.'],
    ['boleto_sales', 'Vendas no boleto', 'number', 'Pedidos aprovados pagos com boleto.'],
  ]),
  ...group('Entrega e funil Meta', [
    ['impressions', 'Impressões', 'number', 'Impressões da mídia.'],
    ['clicks', 'Cliques', 'number', 'Todos os cliques informados pela mídia.'],
    ['cpm', 'CPM', 'money', 'Investimento ÷ impressões × 1.000.'],
    ['cpc', 'CPC', 'money', 'Investimento ÷ todos os cliques.'],
    ['ctr', 'CTR', 'percent', 'Todos os cliques ÷ impressões × 100.'],
    [
      'link_clicks',
      'Cliques no link · Meta',
      'number',
      'Cliques no link da Marketing API; requer nova sincronização.',
    ],
    ['link_ctr', 'CTR de link · Meta', 'percent', 'Cliques no link ÷ impressões × 100.'],
    ['link_cpc', 'CPC de link · Meta', 'money', 'Investimento ÷ cliques no link.'],
    [
      'landing_views',
      'Visitas à página · Meta',
      'number',
      'Landing page views informadas pela Meta.',
    ],
    [
      'landing_rate',
      'Carregamento da página · Meta',
      'percent',
      'Visitas à página ÷ cliques no link × 100.',
    ],
    [
      'landing_cost',
      'Custo por visita · Meta',
      'money',
      'Investimento ÷ visitas à página da Meta.',
    ],
    ['meta_checkouts', 'Checkouts · Meta', 'number', 'Checkouts atribuídos pela Meta.'],
    [
      'meta_checkout_cost',
      'Custo por checkout · Meta',
      'money',
      'Investimento ÷ checkouts da Meta.',
    ],
    [
      'meta_purchases',
      'Compras · Meta',
      'number',
      'Compras atribuídas pela Meta; não compõem a receita WeTrack.',
    ],
    ['meta_leads', 'Leads · Meta', 'number', 'Leads atribuídos pela Meta.'],
    ['meta_carts', 'Carrinhos · Meta', 'number', 'Adições ao carrinho atribuídas pela Meta.'],
  ]),
  ...group('Site e comportamento', [
    [
      'visits',
      'Visitantes únicos · Site',
      'number',
      'Visitantes com PageView atribuído a esta entidade.',
    ],
    [
      'sessions',
      'Sessões · Site',
      'number',
      'Sessões do pixel, renovadas após 30 minutos de inatividade.',
    ],
    ['page_views', 'Visualizações de página · Site', 'number', 'Total de eventos PageView.'],
    ['pages_per_session', 'Páginas por sessão', 'ratio', 'Visualizações de página ÷ sessões.'],
    ['view_content', 'Conteúdos visualizados', 'number', 'Eventos ViewContent.'],
    [
      'avg_duration',
      'Tempo médio visível',
      'seconds',
      'Maior tempo acumulado por visita, sem duplicar atualizações.',
    ],
    [
      'avg_active',
      'Tempo médio ativo',
      'seconds',
      'Tempo ativo estimado; pausa após 60 segundos sem interação.',
    ],
    [
      'avg_scroll',
      'Rolagem média máxima',
      'percent',
      'Média da maior rolagem de cada visita medida.',
    ],
    [
      'conversion',
      'Conversão de visitantes',
      'percent',
      'Vendas aprovadas ÷ visitantes × 100; totais do período.',
    ],
    ['carts', 'Visitantes com carrinho', 'number', 'Visitantes distintos com AddToCart.'],
    [
      'checkouts',
      'Visitantes em checkout',
      'number',
      'Visitantes distintos com InitiateCheckout. Clique registra intenção.',
    ],
    [
      'checkout_cost',
      'Custo por checkout · Site',
      'money',
      'Investimento ÷ visitantes com InitiateCheckout.',
    ],
    [
      'checkout_conversion',
      'Conversão de checkout',
      'percent',
      'Vendas aprovadas ÷ visitantes em checkout × 100; não é uma coorte.',
    ],
    [
      'payment_info',
      'Dados de pagamento',
      'number',
      'Visitantes com AddPaymentInfo informado pela página ou API.',
    ],
    [
      'checkout_returns',
      'Retornos do checkout',
      'number',
      'Visitantes que retornaram após sair para checkout. Não comprova abandono.',
    ],
    ['searches', 'Buscas', 'number', 'Eventos Search, sem coletar o texto pesquisado.'],
    ['wishlist', 'Lista de desejos', 'number', 'Visitantes com AddToWishlist.'],
    [
      'video_plays',
      'Reproduções de vídeo',
      'number',
      'Reproduções em elementos HTML video marcados para rastreamento.',
    ],
    [
      'video_completions',
      'Vídeos concluídos',
      'number',
      'Conclusões em elementos HTML video marcados.',
    ],
  ]),
  ...group('Leads e relacionamento', [
    [
      'leads',
      'Leads · WeTrack',
      'number',
      'Visitantes distintos com Lead confirmado pela página ou API.',
    ],
    ['cpl', 'CPL · WeTrack', 'money', 'Investimento ÷ visitantes com Lead.'],
    [
      'contacts',
      'Contatos confirmados',
      'number',
      'Visitantes com Contact. Exige confirmação da integração.',
    ],
    [
      'whatsapp_clicks',
      'Cliques no WhatsApp',
      'number',
      'Cliques para WhatsApp; não confirma mensagem ou conversa.',
    ],
    [
      'form_submits',
      'Envios de formulário',
      'number',
      'Tentativas de envio em formulários explicitamente marcados; nenhum campo é lido.',
    ],
    ['registrations', 'Cadastros concluídos', 'number', 'Visitantes com CompleteRegistration.'],
    ['schedules', 'Agendamentos', 'number', 'Visitantes com Schedule.'],
    [
      'subscriptions',
      'Assinaturas',
      'number',
      'Visitantes com Subscribe. Receita depende do webhook de venda.',
    ],
    ['trials', 'Testes iniciados', 'number', 'Visitantes com StartTrial.'],
  ]),
];
export const templates: Record<string, string[]> = {
  Desempenho: ['budget', 'spend', 'revenue', 'roas', 'sales', 'cpa', 'clicks'],
  'Vendas e financeiro': [
    'spend',
    'revenue',
    'profit',
    'roi',
    'sales',
    'ticket',
    'approval_rate',
    'pending_amount',
    'refunded_amount',
    'chargeback_amount',
  ],
  'Funil de conversão': [
    'spend',
    'link_clicks',
    'landing_views',
    'meta_checkouts',
    'checkouts',
    'orders',
    'sales',
    'checkout_conversion',
    'cpa',
  ],
  'Tráfego e conteúdo': [
    'spend',
    'impressions',
    'cpm',
    'clicks',
    'ctr',
    'cpc',
    'visits',
    'sessions',
    'avg_active',
    'avg_scroll',
  ],
  'Leads e WhatsApp': [
    'spend',
    'visits',
    'leads',
    'cpl',
    'whatsapp_clicks',
    'contacts',
    'form_submits',
    'sales',
    'revenue',
  ],
};
export const metric = (row: HierarchyRow, id: string): number | null => {
  const v = (row as unknown as Record<string, unknown>)[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
export function formatMetric(value: number | null, column: Column) {
  if (value == null) return '—';
  if (column.format === 'money') return brl(value);
  if (column.format === 'percent') return `${decimal(value)}%`;
  if (column.format === 'ratio') return `${decimal(value)}x`;
  if (column.format === 'seconds') return `${decimal(value, 1)} s`;
  return number(value);
}
const derived: Record<string, [string, string, number?]> = {
  roas: ['revenue', 'spend'],
  roi: ['profit', 'spend', 100],
  margin: ['profit', 'revenue', 100],
  cpa: ['spend', 'sales'],
  ticket: ['revenue', 'sales'],
  approval_rate: ['sales', 'orders', 100],
  refund_rate: ['refunded', 'orders', 100],
  cpm: ['spend', 'impressions', 1000],
  cpc: ['spend', 'clicks'],
  ctr: ['clicks', 'impressions', 100],
  link_ctr: ['link_clicks', 'impressions', 100],
  link_cpc: ['spend', 'link_clicks'],
  landing_rate: ['landing_views', 'link_clicks', 100],
  landing_cost: ['spend', 'landing_views'],
  meta_checkout_cost: ['spend', 'meta_checkouts'],
  pages_per_session: ['page_views', 'sessions'],
  conversion: ['sales', 'visits', 100],
  checkout_conversion: ['sales', 'checkouts', 100],
  checkout_cost: ['spend', 'checkouts'],
  cpl: ['spend', 'leads'],
};
export function totalMetric(rows: HierarchyRow[], id: string): number | null {
  if (['budget', 'avg_duration', 'avg_active', 'avg_scroll'].includes(id)) return null;
  const sum = (key: string) =>
    rows.some((r) => metric(r, key) == null)
      ? null
      : rows.reduce((v, r) => v + (metric(r, key) || 0), 0);
  if (derived[id]) {
    const [a, b, scale = 1] = derived[id],
      n = sum(a),
      d = sum(b);
    return n != null && d ? (n / d) * scale : null;
  }
  return sum(id);
}

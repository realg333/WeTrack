export type Page =
  | 'overview'
  | 'campaigns'
  | 'sales'
  | 'visits'
  | 'rules'
  | 'integrations'
  | 'notifications'
  | 'settings';
export type Project = { id: string; name: string; demo: number };
export type Metrics = {
  revenue: number;
  spend: number;
  profit: number;
  sales: number;
  roas: number;
  cpa: number;
  ticket: number;
  margin: number;
  visits: number;
  conversion: number;
  pending: number;
  impressions: number;
  clicks: number;
};
export type Campaign = Metrics & {
  id: string;
  name: string;
  source: string;
  budget: number;
  active: number;
};
export type Sale = {
  id: string;
  project_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  attribution_method: 'automatic' | 'manual' | 'unattributed';
  attribution_updated_at: string | null;
  external_id: string;
  customer_name: string;
  customer_email: string;
  product: string;
  amount: number;
  status: string;
  payment_method: string;
  utm_source: string;
  utm_campaign: string;
  utm_medium: string;
  utm_content: string;
  utm_term: string | null;
  adset_reference: string | null;
  ad_reference: string | null;
  created_at: string;
  day: string;
};
export type AttributionOptions = {
  campaigns: { id: string; name: string; external_id: string | null; account_id: string | null }[];
  adsets: { id: string; name: string; campaign_id: string; external_id: string | null }[];
  ads: { id: string; name: string; adset_id: string; external_id: string | null }[];
};
export type Rule = {
  id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  active: number;
  matches: string[];
};
export type Dashboard = {
  metrics: Metrics;
  daily: { day: string; revenue: number; spend: number }[];
  campaigns: Campaign[];
  sales: Sale[];
  sources: { source: string; revenue: number; sales: number }[];
  pages: { page_url: string; views: number; visitors: number }[];
  rules: Rule[];
  project: Project;
  start: string;
  end: string;
  funnel: {
    meta: FunnelStage[];
    site: FunnelStage[];
    meta_available: boolean;
    hourly: { hour: number; sales: number }[];
  };
};
export type FunnelStage = { label: string; value: number; rate: number; step_rate: number };
export type HierarchyRow = Campaign & {
  external_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  account_id?: string;
};
export type Visitor = {
  visitor_id: string;
  first_seen: string;
  last_seen: string;
  events: number;
  pages: number;
  sessions: number;
  checkout: number;
  source: string;
};
export type Journey = {
  visitor_id: string;
  limited: boolean;
  events: {
    id: string;
    event_name: string;
    page_url: string;
    page_title: string | null;
    referrer: string | null;
    section: string | null;
    target_url: string | null;
    utm_source: string;
    utm_campaign: string;
    session_id: string | null;
    created_at: string;
  }[];
  sales: Sale[];
};
export type Pixel = {
  id: string;
  name: string;
  domain: string;
  checkout_url: string;
  active: number;
  created_at: string;
  events: number;
  last_event: string | null;
  capi_configured: number;
  meta_pixel_id: string | null;
  test_event_code: string | null;
};
export type Token = {
  id: string;
  name: string;
  platform: string;
  token_hint: string;
  active: number;
  last_used: string | null;
  created_at: string;
};
export type Integrations = {
  providers: PlatformConnectionData[];
  pixels: Pixel[];
  tokens: Token[];
  meta: {
    configured: boolean;
    connected: boolean;
    accounts: {
      id: string;
      name: string;
      currency: string;
      account_status: number;
      enabled: boolean;
      supported: boolean;
    }[];
    last_sync?: string;
    oauth: { configured: boolean; redirect_uri: string; expires_in: number };
  };
  capi: { status: string; count: number }[];
  base_url: string;
};
export type Toast = (message: string, error?: boolean) => void;
export type PlatformConnectionData = {
  id: string;
  provider: 'cakto' | 'hotmart' | 'blackcat';
  name: string;
  configured: boolean;
  url: string;
  test_mode: boolean;
  purchase_owner: 'checkout' | 'wetrack';
  pixel_id: string;
  last_event: { status: string; received_at: string; last_error: string | null } | null;
};
export type PlatformReceipt = {
  can_retry: number;
  id: string;
  event_name: string;
  status: string;
  test_mode: number;
  attempts: number;
  received_at: string;
  processed_at: string | null;
  last_error: string | null;
};

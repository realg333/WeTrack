export const brl = (value: number, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
export const number = (value: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
export const decimal = (value: number, digits = 2) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const localDay = (value = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
export const dateTime = (value: string) =>
  new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export const sourceName = (source: string) =>
  ({
    facebook: 'Meta Ads',
    instagram: 'Instagram',
    google: 'Google Ads',
    direct: 'Direto / orgânico',
    tiktok: 'TikTok Ads',
  })[source] ||
  source ||
  'Direto / orgânico';
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'O servidor não respondeu. Verifique a conexão.' }));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login')
      window.dispatchEvent(new Event('wt:session-expired'));
    throw new Error(data.error || 'Não foi possível concluir a ação.');
  }
  return data as T;
}
export const mutate = <T = { ok: boolean }>(path: string, method: string, body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escape = (value: string | number) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const blob = new Blob(['\ufeff' + rows.map((row) => row.map(escape).join(';')).join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

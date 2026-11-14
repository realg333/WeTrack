export const languages = [
  ['pt-BR', 'Português'],
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['zh-CN', '中文'],
  ['ja', '日本語'],
  ['hi', 'हिन्दी'],
  ['ar', 'العربية'],
] as const;
let selected = 'pt-BR';
try {
  const candidate =
    new URLSearchParams(location.search).get('lang') || localStorage.getItem('wt_language');
  if (languages.some(([code]) => code === candidate)) selected = candidate!;
} catch {
  /* Storage may be disabled. Portuguese remains available. */
}
export const language = selected;
const loaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  'zh-CN': () => import('./locales/zh-CN.json'),
  ja: () => import('./locales/ja.json'),
  hi: () => import('./locales/hi.json'),
  ar: () => import('./locales/ar.json'),
};
const catalog = loaders[language] ? (await loaders[language]()).default : {};
export const locale = language === 'en' ? 'en-US' : language;
export function t<T extends string>(source: T, values?: unknown[]): T {
  if (typeof source !== 'string') return source;
  const key = source.trim();
  if (['we', 'track', 'wetrack', 'WeTrack'].includes(key)) return source;
  let result = catalog[key] ? source.replace(key, () => catalog[key]) : source;
  if (values)
    result = result.replace(/\{\s*(\d+)\s*\}/g, (_, index) => String(values[Number(index)] ?? ''));
  return result as T;
}
export function setLanguage(next: string) {
  if (!languages.some(([code]) => code === next)) return;
  try {
    localStorage.setItem('wt_language', next);
  } catch {}
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  location.assign(url.href);
}
document.documentElement.lang = language;
document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

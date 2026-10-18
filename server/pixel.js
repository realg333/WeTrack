/* WeTrack pixel. Install after consent where applicable. Never reads form values. */
(() => {
  const script = document.currentScript;
  const pixel = script?.getAttribute('data-pixel');
  if (!script || !pixel || window.__wetrackInstalled) return;
  window.__wetrackInstalled = true;
  const base = new URL(script.src).origin;
  const keys = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
  ];
  const uuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);
  const cleanUrl = (value) => {
    try {
      const u = new URL(value, location.href);
      return ['http:', 'https:'].includes(u.protocol) ? (u.origin + u.pathname).slice(0, 2000) : '';
    } catch {
      return '';
    }
  };
  let visitor = uuid(),
    attribution = {},
    session = { id: uuid(), seen: Date.now() };
  try {
    visitor = localStorage.getItem('wt_visitor') || visitor;
    localStorage.setItem('wt_visitor', visitor);
    const saved = JSON.parse(localStorage.getItem('wt_attribution') || '{}');
    if (saved.expires > Date.now()) attribution = saved.params || {};
    const savedSession = JSON.parse(sessionStorage.getItem('wt_session') || '{}');
    if (savedSession.id && savedSession.seen > Date.now() - 1800000) session = savedSession;
  } catch {
    /* Storage can be unavailable. Tracking still works in this page. */
  }
  const captureAttribution = () => {
    const params = new URLSearchParams(location.search);
    if (!keys.some((key) => params.has(key))) return;
    const next = {};
    keys.forEach((key) => {
      if (params.has(key)) next[key] = params.get(key).slice(0, 200);
    });
    if (!next.utm_source)
      next.utm_source = params.has('fbclid')
        ? 'facebook'
        : params.has('gclid')
          ? 'google'
          : 'direct';
    attribution = next;
    try {
      localStorage.setItem(
        'wt_attribution',
        JSON.stringify({ params: attribution, expires: Date.now() + 7 * 86400000 }),
      );
    } catch {}
  };
  captureAttribution();
  const allowed = new Set([
    'PageView',
    'ViewContent',
    'SectionView',
    'Click',
    'InitiateCheckout',
    'Purchase',
  ]);
  const track = (event_name, details = {}) => {
    if (!allowed.has(event_name)) return;
    if (session.seen < Date.now() - 1800000) session.id = uuid();
    session.seen = Date.now();
    try {
      sessionStorage.setItem('wt_session', JSON.stringify(session));
    } catch {}
    const body = JSON.stringify({
      event_id: uuid(),
      visitor_id: visitor,
      session_id: session.id,
      event_name,
      page_url: cleanUrl(location.href),
      page_title: document.title.slice(0, 200),
      referrer: cleanUrl(document.referrer),
      section: String(details.section || '').slice(0, 120),
      target_url: details.target_url ? cleanUrl(details.target_url) : '',
      utm_source: String(attribution.utm_source || 'direct').slice(0, 100),
      utm_campaign: String(attribution.utm_campaign || '').slice(0, 200),
      utm_medium: String(attribution.utm_medium || '').slice(0, 100),
      utm_content: String(attribution.utm_content || '').slice(0, 200),
      utm_term: String(attribution.utm_term || '').slice(0, 200),
    });
    fetch(base + '/api/collect/' + encodeURIComponent(pixel), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
  };
  window.WeTrack = {
    track,
    visitorId: visitor,
    get sessionId() {
      return session.id;
    },
  };
  track('PageView');
  let lastPage = cleanUrl(location.href),
    seenSections = new Set();
  const sectionObserver = window.IntersectionObserver
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || entry.intersectionRatio < 0.25) return;
            const name = entry.target.getAttribute('data-wetrack-section') || entry.target.id;
            if (name && !seenSections.has(name)) {
              seenSections.add(name);
              track('SectionView', { section: name });
            }
          });
        },
        { threshold: [0.25] },
      )
    : null;
  const observeSections = () => {
    if (!sectionObserver) return;
    sectionObserver.disconnect();
    document
      .querySelectorAll('[data-wetrack-section], main section[id]')
      .forEach((element) => sectionObserver.observe(element));
  };
  const routeChanged = () => {
    captureAttribution();
    const page = cleanUrl(location.href);
    if (page !== lastPage) {
      lastPage = page;
      seenSections = new Set();
      track('PageView');
      setTimeout(observeSections, 0);
    }
  };
  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      routeChanged();
      return result;
    };
  });
  window.addEventListener('popstate', routeChanged);
  window.addEventListener('hashchange', () => {
    // Hash navigation is a section change, not another page view.
    try {
      const section = decodeURIComponent(location.hash.slice(1)).slice(0, 120);
      if (section && !seenSections.has(section)) {
        seenSections.add(section);
        track('SectionView', { section });
      }
    } catch {}
  });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', observeSections, { once: true });
  else observeSections();
  let checkoutOrigin = '';
  try {
    checkoutOrigin = new URL(script.getAttribute('data-checkout-origin')).origin;
  } catch {}
  document.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest?.('a[href]');
      if (!link) return;
      try {
        const url = new URL(link.href, location.href);
        if (!['http:', 'https:'].includes(url.protocol)) return;
        keys.forEach((key) => {
          if (attribution[key] && !url.searchParams.has(key))
            url.searchParams.set(key, attribution[key]);
        });
        link.href = url.href;
        track('Click', { target_url: url.href });
        if (
          link.hasAttribute('data-wetrack-checkout') ||
          (checkoutOrigin && url.origin === checkoutOrigin)
        )
          track('InitiateCheckout', { target_url: url.href });
      } catch {
        /* Ignore non-HTTP links. */
      }
    },
    true,
  );
})();

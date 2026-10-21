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
    'ttclid',
    'msclkid',
    'gbraid',
    'wbraid',
    'kwai_click_id',
  ];
  const uuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);
  const cleanUrl = (value) => {
    if (!value) return '';
    try {
      const u = new URL(value, location.href);
      return ['http:', 'https:'].includes(u.protocol) ? (u.origin + u.pathname).slice(0, 2000) : '';
    } catch {
      return '';
    }
  };
  let visitor = uuid(),
    attribution = {},
    firstTouch = {},
    checkoutCode =
      'wt' +
      uuid()
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 22),
    session = { id: uuid(), seen: Date.now() };
  try {
    visitor = localStorage.getItem('wt_visitor') || visitor;
    localStorage.setItem('wt_visitor', visitor);
    const first = JSON.parse(localStorage.getItem('wt_first_touch') || '{}');
    if (first.expires > Date.now()) firstTouch = first.params || {};
    const saved = JSON.parse(localStorage.getItem('wt_attribution') || '{}');
    if (saved.expires > Date.now()) {
      attribution = saved.params || {};
      if (/^wt[a-zA-Z0-9]{16,26}$/.test(saved.checkoutCode || ''))
        checkoutCode = saved.checkoutCode;
    }
    const savedSession = JSON.parse(sessionStorage.getItem('wt_session') || '{}');
    if (savedSession.id && savedSession.seen > Date.now() - 1800000) session = savedSession;
  } catch {
    /* Storage can be unavailable. Tracking still works in this page. */
  }
  const handoff = new URLSearchParams(location.search);
  if (
    /^wt[a-zA-Z0-9]{16,26}$/.test(handoff.get('wt_ref') || '') &&
    /^[a-zA-Z0-9_-]{8,100}$/.test(handoff.get('visitor_id') || '')
  ) {
    visitor = handoff.get('visitor_id');
    checkoutCode = handoff.get('wt_ref');
    try {
      localStorage.setItem('wt_visitor', visitor);
    } catch {}
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
          : params.has('ttclid')
            ? 'tiktok'
            : params.has('msclkid')
              ? 'bing'
              : params.has('kwai_click_id')
                ? 'kwai'
                : 'direct';
    attribution = next;
    if (!Object.keys(firstTouch).length) {
      firstTouch = { ...next };
      try {
        localStorage.setItem(
          'wt_first_touch',
          JSON.stringify({ params: firstTouch, expires: Date.now() + 30 * 86400000 }),
        );
      } catch {}
    }
    checkoutCode =
      'wt' +
      uuid()
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 22);
    try {
      localStorage.setItem(
        'wt_attribution',
        JSON.stringify({ params: attribution, checkoutCode, expires: Date.now() + 7 * 86400000 }),
      );
    } catch {}
  };
  captureAttribution();
  if (/^wt[a-zA-Z0-9]{16,26}$/.test(handoff.get('wt_ref') || ''))
    checkoutCode = handoff.get('wt_ref');
  if (!Object.keys(firstTouch).length) {
    firstTouch = { ...attribution, utm_source: attribution.utm_source || 'direct' };
    try {
      localStorage.setItem(
        'wt_first_touch',
        JSON.stringify({ params: firstTouch, expires: Date.now() + 30 * 86400000 }),
      );
    } catch {}
  }
  let fbp = (String(document.cookie || '').match(/(?:^|;\s*)_fbp=([^;]+)/)?.[1] || '').slice(
    0,
    200,
  );
  let fbc = (String(document.cookie || '').match(/(?:^|;\s*)_fbc=([^;]+)/)?.[1] || '').slice(
    0,
    300,
  );
  if (!fbp) fbp = `fb.1.${Date.now()}.${Math.floor(Math.random() * 1000000000)}`;
  if (attribution.fbclid && !fbc.endsWith('.' + attribution.fbclid))
    fbc = `fb.1.${Date.now()}.${attribution.fbclid}`;
  try {
    document.cookie = `_fbp=${fbp}; Path=/; Max-Age=604800; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    if (fbc)
      document.cookie = `_fbc=${fbc}; Path=/; Max-Age=604800; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {}
  const checkoutKey = 'wt_checkout_' + pixel;
  let pendingCheckout = null;
  const readCheckout = () => {
    try {
      pendingCheckout = JSON.parse(sessionStorage.getItem(checkoutKey) || 'null');
    } catch {}
    if (
      pendingCheckout &&
      (pendingCheckout.visitor !== visitor || Date.now() - pendingCheckout.at > 86400000)
    )
      pendingCheckout = null;
    return pendingCheckout;
  };
  const saveCheckout = () => {
    try {
      sessionStorage.setItem(checkoutKey, JSON.stringify(pendingCheckout));
    } catch {}
  };
  let pageViewId = uuid(),
    pageUrl = cleanUrl(location.href),
    pageTitle = document.title.slice(0, 200),
    sampledAt = Date.now(),
    lastActivity = sampledAt,
    visible = document.visibilityState !== 'hidden',
    duration = 0,
    active = 0,
    scrollDepth = 0,
    exited = false,
    lastSnapshot = '',
    seenScroll = new Set();
  const sample = () => {
    const at = Date.now();
    if (visible && !exited) {
      duration += Math.max(0, at - sampledAt);
      active += Math.max(0, Math.min(at, lastActivity + 60000) - sampledAt);
    }
    sampledAt = at;
  };
  const metrics = () => ({
    page_view_id: pageViewId,
    duration_ms: Math.min(duration, 86400000),
    active_ms: Math.min(active, 86400000),
    scroll_depth: scrollDepth,
  });
  const allowed = new Set([
    'PageView',
    'ViewContent',
    'SectionView',
    'Click',
    'InitiateCheckout',
    'Purchase',
    'PageEngagement',
    'PageExit',
    'PageReturn',
    'CheckoutReturn',
    'ScrollDepth',
  ]);
  const track = (event_name, details = {}) => {
    if (!allowed.has(event_name) && !/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(event_name)) return;
    sample();
    if (event_name === 'InitiateCheckout') {
      pendingCheckout = {
        visitor,
        at: Date.now(),
        target: cleanUrl(details.target_url || ''),
        departed: false,
      };
      saveCheckout();
    }
    if (!['PageEngagement', 'PageExit'].includes(event_name)) {
      if (session.seen < Date.now() - 1800000) session.id = uuid();
      session.seen = Date.now();
    }
    try {
      sessionStorage.setItem('wt_session', JSON.stringify(session));
    } catch {}
    const eventId =
      typeof details.event_id === 'string' &&
      details.event_id.length >= 8 &&
      details.event_id.length <= 100
        ? details.event_id
        : uuid();
    const body = JSON.stringify({
      event_id: eventId,
      visitor_id: visitor,
      attribution_code: checkoutCode,
      fbp,
      fbc: fbc || undefined,
      value:
        typeof details.value === 'number' &&
        Number.isFinite(details.value) &&
        details.value >= 0 &&
        details.value <= 10000000
          ? details.value
          : undefined,
      currency: 'BRL',
      content_id: details.content_id ? String(details.content_id).slice(0, 120) : undefined,
      content_name: details.content_name ? String(details.content_name).slice(0, 150) : undefined,
      click_ids: Object.fromEntries(
        keys.filter((k) => !k.startsWith('utm_') && attribution[k]).map((k) => [k, attribution[k]]),
      ),
      first_touch: Object.fromEntries(
        keys.filter((k) => k.startsWith('utm_') && firstTouch[k]).map((k) => [k, firstTouch[k]]),
      ),
      session_id: session.id,
      event_name,
      page_url: pageUrl,
      page_title: pageTitle || document.title.slice(0, 200),
      referrer: cleanUrl(document.referrer),
      section: String(details.section || '').slice(0, 120),
      target_url: details.target_url ? cleanUrl(details.target_url) : '',
      utm_source: String(attribution.utm_source || 'direct').slice(0, 100),
      utm_campaign: String(attribution.utm_campaign || '').slice(0, 200),
      utm_medium: String(attribution.utm_medium || '').slice(0, 100),
      utm_content: String(attribution.utm_content || '').slice(0, 200),
      utm_term: String(attribution.utm_term || '').slice(0, 200),
      ...metrics(),
      occurred_at: new Date(Date.now()).toISOString(),
      reason: details.reason || undefined,
      away_ms: details.away_ms,
    });
    if (details.beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(base + '/api/collect/' + encodeURIComponent(pixel), body))
          return eventId;
      } catch {}
    }
    fetch(base + '/api/collect/' + encodeURIComponent(pixel), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
    return eventId;
  };
  const checkoutReturned = () => {
    const pending = readCheckout();
    if (!pending?.departed || (pending.target && cleanUrl(location.href) === pending.target))
      return;
    pendingCheckout = null;
    saveCheckout();
    track('CheckoutReturn', {
      target_url: pending.target,
      away_ms: Math.min(Math.max(0, Date.now() - pending.at), 86400000),
      reason: 'after_checkout_click',
    });
  };
  const departed = () => {
    const pending = readCheckout();
    if (pending) {
      pending.departed = true;
      saveCheckout();
    }
  };
  const flush = (reason, beacon = false) => {
    sample();
    const snapshot = JSON.stringify(metrics());
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    track('PageEngagement', { reason, beacon });
  };
  window.WeTrack = {
    track,
    visitorId: visitor,
    get sessionId() {
      return session.id;
    },
    get attribution() {
      return { ...attribution };
    },
    get firstTouch() {
      return { ...firstTouch };
    },
  };
  track('PageView');
  checkoutReturned();
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
    const page = cleanUrl(location.href);
    if (page !== lastPage) {
      departed();
      track('PageExit', { reason: 'navigation' });
      captureAttribution();
      lastPage = page;
      pageUrl = page;
      pageTitle = document.title.slice(0, 200);
      pageViewId = uuid();
      sampledAt = lastActivity = Date.now();
      duration = active = scrollDepth = 0;
      exited = false;
      lastSnapshot = '';
      seenScroll = new Set();
      seenSections = new Set();
      track('PageView');
      checkoutReturned();
      setTimeout(observeSections, 0);
    } else captureAttribution();
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
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        pageTitle = document.title.slice(0, 200);
        observeSections();
      },
      { once: true },
    );
  else observeSections();
  const activity = () => {
    sample();
    lastActivity = Date.now();
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((name) =>
    document.addEventListener(name, activity, { passive: true }),
  );
  window.addEventListener(
    'scroll',
    () => {
      activity();
      const root = document.documentElement;
      const height = Math.max(root?.scrollHeight || 0, document.body?.scrollHeight || 0);
      const viewport = window.innerHeight || root?.clientHeight || 0;
      if (height <= viewport) return;
      scrollDepth = Math.max(
        scrollDepth,
        Math.min(
          100,
          Math.round(((window.scrollY || root?.scrollTop || 0) / (height - viewport)) * 100),
        ),
      );
      [25, 50, 75, 100].forEach((depth) => {
        if (scrollDepth >= depth && !seenScroll.has(depth)) {
          seenScroll.add(depth);
          track('ScrollDepth', { section: depth + '%' });
        }
      });
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    const next = document.visibilityState !== 'hidden';
    if (next === visible) return;
    sample();
    visible = next;
    if (!visible) {
      departed();
      flush('hidden', true);
    } else {
      if (exited) return;
      lastActivity = Date.now();
      track('PageReturn', { reason: 'visible' });
      checkoutReturned();
    }
  });
  window.addEventListener('pagehide', () => {
    if (exited) return;
    departed();
    track('PageExit', { reason: 'exit', beacon: true });
    exited = true;
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    exited = false;
    sampledAt = lastActivity = Date.now();
    visible = document.visibilityState !== 'hidden';
    if (visible) {
      track('PageReturn', { reason: 'history' });
      checkoutReturned();
    }
  });
  setInterval(() => {
    if (visible && !exited) flush('heartbeat');
  }, 15000);
  let checkoutOrigin = '';
  let checkoutUrl = null;
  try {
    checkoutOrigin = new URL(script.getAttribute('data-checkout-origin')).origin;
  } catch {}
  try {
    checkoutUrl = new URL(script.getAttribute('data-checkout-url'));
  } catch {}
  document.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest?.('[data-wetrack-event], [data-wetrack-checkout], a[href]');
      if (!link) return;
      activity();
      const customEvent = link.getAttribute?.('data-wetrack-event');
      if (customEvent)
        track(customEvent, {
          content_id: link.getAttribute('data-wetrack-content-id'),
          value: link.hasAttribute('data-wetrack-value')
            ? Number(link.getAttribute('data-wetrack-value'))
            : undefined,
        });
      if (!link.href) {
        if (link.hasAttribute('data-wetrack-checkout')) {
          track('Click');
          track('InitiateCheckout');
        }
        return;
      }
      try {
        const url = new URL(link.href, location.href);
        if (!['http:', 'https:'].includes(url.protocol)) return;
        if (['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname)) {
          if (!String(url.searchParams.get('text') || '').includes(checkoutCode))
            url.searchParams.set(
              'text',
              `${url.searchParams.get('text') || ''}\n[${checkoutCode}]`.trim(),
            );
          link.href = url.href;
          track('WhatsAppClick', { target_url: url.origin });
          return;
        }
        const isCheckout =
          link.hasAttribute('data-wetrack-checkout') ||
          ['pay.hotmart.com', 'pay.cakto.com.br'].includes(url.hostname) ||
          (checkoutUrl
            ? url.origin === checkoutUrl.origin &&
              (url.pathname === checkoutUrl.pathname ||
                url.pathname.startsWith(checkoutUrl.pathname.replace(/\/$/, '') + '/'))
            : checkoutOrigin && url.origin === checkoutOrigin);
        if (isCheckout) {
          if (!url.searchParams.has('visitor_id')) url.searchParams.set('visitor_id', visitor);
          if (!url.searchParams.has('wt_ref')) url.searchParams.set('wt_ref', checkoutCode);
        }
        keys.forEach((key) => {
          if (attribution[key] && !url.searchParams.has(key))
            url.searchParams.set(key, attribution[key]);
        });
        if (url.hostname === 'pay.hotmart.com' && !url.searchParams.has('xcod'))
          url.searchParams.set('xcod', checkoutCode);
        if (url.hostname === 'pay.cakto.com.br' && !url.searchParams.has('sck'))
          url.searchParams.set('sck', checkoutCode);
        link.href = url.href;
        track('Click', { target_url: url.href });
        if (isCheckout) track('InitiateCheckout', { target_url: url.href });
      } catch {
        /* Ignore non-HTTP links. */
      }
    },
    true,
  );
  document.addEventListener(
    'submit',
    (e) => {
      if (e.target.matches?.('form[data-wetrack-form]'))
        track('FormSubmit', { section: e.target.getAttribute('data-wetrack-form') || 'form' });
    },
    true,
  );
  const videoMilestones = new WeakMap();
  document.addEventListener(
    'play',
    (e) => {
      if (e.target.matches?.('video[data-wetrack-video]'))
        track('VideoPlay', { content_id: e.target.getAttribute('data-wetrack-video') || 'video' });
    },
    true,
  );
  document.addEventListener(
    'timeupdate',
    (e) => {
      const v = e.target;
      if (
        !v.matches?.('video[data-wetrack-video]') ||
        !Number.isFinite(v.duration) ||
        v.duration <= 0
      )
        return;
      const seen = videoMilestones.get(v) || new Set();
      [25, 50, 75].forEach((milestone) => {
        if ((v.currentTime / v.duration) * 100 >= milestone && !seen.has(milestone)) {
          seen.add(milestone);
          track('VideoProgress', {
            content_id: v.getAttribute('data-wetrack-video') || 'video',
            section: milestone + '%',
          });
        }
      });
      videoMilestones.set(v, seen);
    },
    true,
  );
  document.addEventListener(
    'ended',
    (e) => {
      if (e.target.matches?.('video[data-wetrack-video]'))
        track('VideoComplete', {
          content_id: e.target.getAttribute('data-wetrack-video') || 'video',
        });
    },
    true,
  );
})();

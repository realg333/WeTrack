import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../server/pixel.js', import.meta.url), 'utf8');
const storage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
};
function fixture({
  localStorage = storage(),
  sessionStorage = storage(),
  now = Date.now(),
  checkoutUrl,
  url = 'https://shop.example.com/?utm_source=facebook&utm_campaign=123&utm_content=456&utm_term=789',
} = {}) {
  const listeners = {},
    events = [],
    intervals = [];
  let observed;
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const context = {
    URL,
    URLSearchParams,
    Date: Clock,
    Math,
    Set,
    crypto: { randomUUID },
    localStorage,
    sessionStorage,
    location: new URL(url),
    fetch: async (_url, options) => {
      events.push(JSON.parse(options.body));
      return {};
    },
    setTimeout: (fn) => fn(),
    setInterval: (fn) => intervals.push(fn),
    IntersectionObserver: class {
      constructor(callback) {
        observed = callback;
      }
      disconnect() {}
      observe() {}
    },
  };
  context.window = context;
  context.addEventListener = (name, fn) => (listeners[name] = fn);
  context.document = {
    title: 'Minha loja',
    referrer: 'https://facebook.com/?email=private',
    readyState: 'complete',
    visibilityState: 'visible',
    documentElement: { scrollHeight: 3000, clientHeight: 1000, scrollTop: 0 },
    currentScript: {
      src: 'https://track.example.com/pixel.js',
      getAttribute: (name) =>
        ({
          'data-pixel': 'px_test',
          'data-checkout-origin': 'https://pay.example.com',
          'data-checkout-url': checkoutUrl,
        })[name],
    },
    querySelectorAll: () => [],
    addEventListener: (name, fn) => (listeners[name] = fn),
  };
  context.history = {
    pushState: (_state, _unused, next) => {
      context.location = new URL(next, context.location);
    },
    replaceState: (_state, _unused, next) => {
      context.location = new URL(next, context.location);
    },
  };
  vm.runInNewContext(source, context);
  return {
    context,
    listeners,
    events,
    tick: () => intervals.forEach((fn) => fn()),
    observe: (entry) => observed([entry]),
    advance: (ms) => {
      now += ms;
    },
    localStorage,
    sessionStorage,
  };
}
test('pixel tracks SPA pages, deduplicates section views, preserves attribution and detects checkout links', () => {
  const f = fixture(),
    { context, events, listeners } = f;
  assert.equal(events[0].event_name, 'PageView');
  assert.equal(events[0].page_url, 'https://shop.example.com/');
  assert.equal(events[0].referrer, 'https://facebook.com/');
  const visitor = context.WeTrack.visitorId,
    session = context.WeTrack.sessionId;
  context.history.pushState({}, '', '/oferta?email=private@example.com');
  context.history.replaceState({}, '', '/oferta?email=another'); // query-only changes are not another page view.
  assert.equal(events.filter((e) => e.event_name === 'PageView').length, 2);
  const pageView = events.filter((e) => e.event_name === 'PageView').at(-1);
  assert.equal(pageView.utm_campaign, '123');
  assert.equal(pageView.utm_content, '456');
  assert.equal(pageView.utm_term, '789');
  const target = { id: 'precos', getAttribute: () => null };
  f.observe({ isIntersecting: true, intersectionRatio: 0.5, target });
  f.observe({ isIntersecting: true, intersectionRatio: 0.5, target });
  assert.equal(events.filter((e) => e.event_name === 'SectionView').length, 1);
  const link = {
    href: 'https://pay.example.com/order?utm_source=original&email=private@example.com',
    hasAttribute: () => false,
  };
  listeners.click({ target: { closest: () => link } });
  assert.equal(new URL(link.href).searchParams.get('utm_campaign'), '123');
  assert.equal(new URL(link.href).searchParams.get('utm_source'), 'original');
  assert.deepEqual(
    events.slice(-2).map((e) => e.event_name),
    ['Click', 'InitiateCheckout'],
  );
  assert.equal(events.at(-1).target_url, 'https://pay.example.com/order');
  assert.ok(events.every((e) => e.visitor_id === visitor && e.session_id === session));
  assert.ok(!JSON.stringify(events).includes('private@example.com'));
  context.WeTrack.track('Unknown');
  assert.notEqual(events.at(-1).event_name, 'Unknown');
  f.advance(1800001);
  context.WeTrack.track('ViewContent');
  assert.notEqual(context.WeTrack.sessionId, session);
  assert.equal(context.WeTrack.visitorId, visitor);
  const next = fixture({
    localStorage: f.localStorage,
    sessionStorage: f.sessionStorage,
    url: 'https://shop.example.com/voltei',
  });
  assert.equal(next.context.WeTrack.visitorId, visitor);
  assert.equal(next.events[0].utm_source, 'facebook');
  vm.runInNewContext(source, context);
  assert.equal(events.filter((e) => e.event_name === 'PageView').length, 2); // duplicate installation guard.
});
test('pixel works without storage and marks explicit checkout buttons', () => {
  const broken = {
    getItem: () => {
      throw Error('blocked');
    },
    setItem: () => {
      throw Error('blocked');
    },
  };
  const f = fixture({
    localStorage: broken,
    sessionStorage: broken,
    url: 'https://shop.example.com/?fbclid=click123',
  });
  assert.equal(f.events[0].utm_source, 'facebook');
  assert.ok(f.context.WeTrack.visitorId);
  f.listeners.click({
    target: {
      closest: () => ({
        href: 'https://other.example.com/pay',
        hasAttribute: (name) => name === 'data-wetrack-checkout',
      }),
    },
  });
  assert.equal(f.events.at(-1).event_name, 'InitiateCheckout');
});

test('Hotmart checkout gets a short attribution reference without replacing existing xcod', () => {
  const f = fixture(),
    code = f.events[0].attribution_code;
  assert.match(code, /^wt[a-zA-Z0-9]{16,26}$/);
  const link = { href: 'https://pay.hotmart.com/TEST?checkoutMode=10', hasAttribute: () => false };
  f.listeners.click({ target: { closest: () => link } });
  assert.equal(new URL(link.href).searchParams.get('xcod'), code);
  assert.equal(new URL(link.href).searchParams.get('checkoutMode'), '10');
  assert.equal(new URL(link.href).searchParams.get('utm_content'), '456');
  link.href = 'https://pay.hotmart.com/TEST?xcod=existing-origin';
  f.listeners.click({ target: { closest: () => link } });
  assert.equal(new URL(link.href).searchParams.get('xcod'), 'existing-origin');
  link.href = 'https://pay.cakto.com.br/TEST';
  f.listeners.click({ target: { closest: () => link } });
  assert.equal(new URL(link.href).searchParams.get('sck'), code);
  const next = fixture({ localStorage: f.localStorage, url: 'https://shop.example.com/voltei' });
  assert.equal(next.events[0].attribution_code, code);
});

test('visible and active time exclude hidden tabs, idle time pauses active time, and heartbeats do not renew sessions', () => {
  const f = fixture();
  const session = f.context.WeTrack.sessionId;
  f.advance(15000);
  f.tick();
  assert.equal(f.events.at(-1).duration_ms, 15000);
  assert.equal(f.events.at(-1).active_ms, 15000);
  f.context.document.visibilityState = 'hidden';
  f.listeners.visibilitychange();
  f.advance(40000);
  f.tick();
  f.context.document.visibilityState = 'visible';
  f.listeners.visibilitychange();
  f.advance(8000);
  f.tick();
  assert.equal(f.events.at(-1).duration_ms, 23000);
  assert.equal(f.events.at(-1).active_ms, 23000);
  f.advance(120000);
  f.tick();
  assert.equal(f.events.at(-1).duration_ms, 143000);
  assert.equal(f.events.at(-1).active_ms, 75000);
  f.listeners.pointerdown();
  f.advance(5000);
  f.tick();
  assert.equal(f.events.at(-1).active_ms, 80000);
  f.advance(1800001);
  f.tick();
  assert.equal(f.context.WeTrack.sessionId, session);
  f.context.WeTrack.track('ViewContent');
  assert.notEqual(f.context.WeTrack.sessionId, session);
});

test('SPA exits keep the old URL and timing while scroll milestones reset for each page', () => {
  const f = fixture();
  const firstView = f.events[0].page_view_id;
  f.advance(10000);
  f.context.scrollY = 1500;
  f.listeners.scroll();
  f.listeners.scroll();
  assert.deepEqual(
    f.events.filter((e) => e.event_name === 'ScrollDepth').map((e) => e.section),
    ['25%', '50%', '75%'],
  );
  f.context.history.pushState({}, '', '/oferta');
  const exit = f.events.find((e) => e.event_name === 'PageExit');
  assert.equal(exit.page_url, 'https://shop.example.com/');
  assert.equal(exit.duration_ms, 10000);
  assert.equal(exit.scroll_depth, 75);
  assert.equal(exit.page_view_id, firstView);
  assert.equal(f.events.at(-1).page_url, 'https://shop.example.com/oferta');
  assert.equal(f.events.at(-1).duration_ms, 0);
  assert.notEqual(f.events.at(-1).page_view_id, firstView);
  f.context.scrollY = 2000;
  f.listeners.scroll();
  assert.equal(f.events.filter((e) => e.event_name === 'ScrollDepth').length, 7);
});

test('checkout returns survive full navigation and bfcache without duplicate returns or hidden time', () => {
  const f = fixture();
  const link = { href: 'https://pay.hotmart.com/OFFER', hasAttribute: () => false };
  f.listeners.click({ target: { closest: () => link } });
  assert.equal(f.events.at(-1).event_name, 'InitiateCheckout');
  // Clicking alone does not prove departure or return.
  f.listeners.pageshow({ persisted: false });
  assert.equal(f.events.filter((e) => e.event_name === 'CheckoutReturn').length, 0);
  f.advance(3000);
  f.context.document.visibilityState = 'hidden';
  f.listeners.visibilitychange();
  f.listeners.pagehide();
  f.advance(45000);
  f.context.document.visibilityState = 'visible';
  f.listeners.visibilitychange();
  f.listeners.pageshow({ persisted: true });
  const returned = f.events.filter((e) => e.event_name === 'CheckoutReturn');
  assert.equal(returned.length, 1);
  assert.equal(returned[0].away_ms, 48000);
  assert.equal(returned[0].duration_ms, 3000);
  assert.equal(returned[0].target_url, 'https://pay.hotmart.com/OFFER');
  f.listeners.pageshow({ persisted: true });
  assert.equal(f.events.filter((e) => e.event_name === 'CheckoutReturn').length, 1);
  f.listeners.click({ target: { closest: () => link } });
  f.listeners.pagehide();
  const next = fixture({
    localStorage: f.localStorage,
    sessionStorage: f.sessionStorage,
    url: 'https://shop.example.com/voltei',
  });
  assert.deepEqual(
    next.events.map((e) => e.event_name),
    ['PageView', 'CheckoutReturn'],
  );
  assert.equal(next.context.WeTrack.visitorId, f.context.WeTrack.visitorId);
  // The restored document rereads storage; a return consumed by another document stays consumed.
  f.listeners.pageshow({ persisted: true });
  assert.equal(f.events.filter((e) => e.event_name === 'CheckoutReturn').length, 1);
});

test('same-domain checkout uses its path and buttons support explicit and manual IC', () => {
  const f = fixture({ checkoutUrl: 'https://shop.example.com/checkout' });
  const link = { href: 'https://shop.example.com/contato', hasAttribute: () => false };
  f.listeners.click({ target: { closest: () => link } });
  assert.equal(f.events.at(-1).event_name, 'Click');
  link.href = 'https://shop.example.com/checkout';
  f.listeners.click({ target: { closest: () => link } });
  assert.equal(f.events.at(-1).event_name, 'InitiateCheckout');
  f.listeners.pagehide();
  const checkout = fixture({
    localStorage: f.localStorage,
    sessionStorage: f.sessionStorage,
    url: 'https://shop.example.com/checkout',
  });
  assert.equal(checkout.events.filter((e) => e.event_name === 'CheckoutReturn').length, 0);
  f.listeners.click({ target: { closest: () => ({ hasAttribute: () => true }) } });
  assert.equal(f.events.at(-1).event_name, 'InitiateCheckout');
  f.context.WeTrack.track('InitiateCheckout');
  f.listeners.pagehide();
  f.context.document.visibilityState = 'hidden';
  f.listeners.visibilitychange();
  f.context.document.visibilityState = 'visible';
  f.listeners.visibilitychange();
  f.listeners.pageshow({ persisted: true });
  assert.equal(f.events.at(-1).event_name, 'CheckoutReturn');
});

test('exit beacons use fetch only when queuing fails and duplicate pagehide is ignored', () => {
  for (const succeeds of [true, false]) {
    const f = fixture();
    const beacons = [];
    f.context.navigator = {
      sendBeacon: (_url, body) => {
        beacons.push(JSON.parse(body));
        return succeeds;
      },
    };
    f.advance(12000);
    f.listeners.pagehide();
    f.listeners.pagehide();
    assert.equal(beacons.length, 1);
    assert.equal(beacons[0].event_name, 'PageExit');
    assert.equal(beacons[0].duration_ms, 12000);
    assert.equal(f.events.filter((e) => e.event_name === 'PageExit').length, succeeds ? 0 : 1);
  }
});

test('checkout in a SPA records the return after leaving its route', () => {
  const f = fixture({ checkoutUrl: 'https://shop.example.com/checkout' });
  const link = { href: 'https://shop.example.com/checkout', hasAttribute: () => false };
  f.listeners.click({ target: { closest: () => link } });
  f.context.history.pushState({}, '', '/checkout');
  assert.equal(f.events.filter((e) => e.event_name === 'CheckoutReturn').length, 0);
  f.advance(25000);
  f.context.history.pushState({}, '', '/');
  assert.equal(f.events.at(-1).event_name, 'CheckoutReturn');
  assert.equal(f.events.at(-1).away_ms, 25000);
});

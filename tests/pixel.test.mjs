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
  url = 'https://shop.example.com/?utm_source=facebook&utm_campaign=123&utm_content=456&utm_term=789',
} = {}) {
  const listeners = {},
    events = [];
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
    currentScript: {
      src: 'https://track.example.com/pixel.js',
      getAttribute: (name) =>
        ({ 'data-pixel': 'px_test', 'data-checkout-origin': 'https://pay.example.com' })[name],
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
  assert.equal(events[1].utm_campaign, '123');
  assert.equal(events[1].utm_content, '456');
  assert.equal(events[1].utm_term, '789');
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

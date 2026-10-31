import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/client.js', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['react'] });

function harness({ componentSlot = true } = {}) {
  const entries = new Map();
  const effects = [];
  const subscriptions = [];
  const storage = new Map();
  const requests = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useReducer: () => [0, () => {}], useState: value => [value, () => {}],
    useRef: value => ({ current: value }), useEffect: callback => subscriptions.push(callback()),
  };
  const scope = { module: { exports: {} }, require: () => react, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  };
  scope.exports = scope.module.exports;
  vm.runInNewContext(bundle.outputFiles[0].text, scope);
  scope.module.exports.apply({
    get: () => null, effect: callback => effects.push(callback()),
    connection: { rpc: { call: (...args) => { requests.push(args); return new Promise((resolve, reject) => args[3].addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } } },
    slots: {
      inject: (name, callback) => { if (componentSlot || name !== 'plugins.row.config') callback(); },
      register: (entry, render) => entries.set(entry.name, { ...entry, render }),
    },
  });
  const render = element => element.type(element.props);
  const close = () => { for (const off of subscriptions.splice(0)) off?.(); };
  return { entries, requests, storage, render, close, dispose: () => { close(); effects.forEach(off => off?.()); } };
}
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(walk)];

test('component settings and bell share preferences and keep polling across view unmounts', async () => {
  const h = harness();
  try {
    assert.deepEqual([...h.entries.keys()], ['conversation.session.header.utilities', 'plugins.row.config']);
    const entry = h.entries.get('plugins.row.config');
    assert.equal(entry.key, 'dsh-state-notifier#state-notifier');
    assert.equal(entry.render({ view: 'summary' }), null);
    const page = h.render(entry.render({ view: 'page' }));
    const enabled = walk(page).find(node => node.type === 'input' && node.props.type === 'checkbox');
    enabled.props.onChange({ target: { checked: false } });
    h.close();
    assert.equal(h.requests.length, 1, 'closing the view must not restart polling');
    assert.equal(h.requests[0][3].aborted, false, 'closing the view must not stop polling');
    const bell = h.render(h.entries.get('conversation.session.header.utilities').render());
    assert.equal(walk(bell).find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
    h.close();
    const reopened = h.render(entry.render({ view: 'page' }));
    assert.equal(walk(reopened).find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  } finally { h.dispose(); }
  assert.equal(h.requests[0][3].aborted, true, 'plugin disposal must abort the pending subscription');
});

test('hosts without a component slot retain the session bell without general settings registration', () => {
  const h = harness({ componentSlot: false });
  try { assert.deepEqual([...h.entries.keys()], ['conversation.session.header.utilities']); }
  finally { h.dispose(); }
});

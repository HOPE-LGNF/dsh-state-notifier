import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserNotifier, ICON_DATA_LIMIT, LEGACY_PREFERENCES_KEY, PREFERENCES_KEY, RECEIPTS_KEY, startPolling } from '../src/browser.js';

const event = { id: 'epoch:1', kind: 'complete', sessionId: '12345678-private-session', time: 1 };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness({ storage = new Map(), locks, permission = 'granted', resume, request, failing = false } = {}) {
  const listeners = new Map();
  const shown = [];
  let starts = 0;
  let closed = 0;
  class AudioContext {
    state = 'suspended'; currentTime = 0; destination = {};
    async resume() { if (resume) await resume; this.state = 'running'; }
    async close() { closed++; this.state = 'closed'; }
    createOscillator() {
      if (failing) throw new Error('audio failure');
      return { frequency: {}, connect() {}, disconnect() {}, start() { starts++; }, stop() {} };
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  class Notification {
    static permission = permission;
    static async requestPermission() { if (request) await request; Notification.permission = 'granted'; return 'granted'; }
    constructor(title, options) { if (failing) throw new Error('notification failure'); this.title = title; this.options = options; shown.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  const env = {
    AudioContext, Notification, isSecureContext: true, navigator: { locks },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    document: { visibilityState: 'hidden', hasFocus: () => false, addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout,
  };
  return { env, storage, shown, listeners, starts: () => starts, closed: () => closed };
}
function serializedLocks() {
  let tail = Promise.resolve();
  return { request(_key, action) { const result = tail.then(action); tail = result.catch(() => {}); return result; } };
}

test('settings take effect immediately and storage changes synchronize preferences', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env);
  await n.enableSound();
  assert.equal(n.browserReady(), true);
  n.update({ enabled: false });
  await n.deliver(event);
  assert.equal(h.shown.length, 0);
  assert.equal(h.storage.has(RECEIPTS_KEY), false);
  h.storage.set(PREFERENCES_KEY, JSON.stringify({ enabled: true, sound: false, desktop: true, quietWhenFocused: false }));
  h.listeners.get('storage')({ key: PREFERENCES_KEY });
  await n.deliver(event);
  assert.equal(h.shown.length, 1);
  assert.equal(n.snapshot().preferences.sound, false);
  assert.equal(h.shown[0].options.body, '会话 12345678');
  n.dispose();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.closed(), 1);
});

test('前台静音仍承接事件，后台恢复后下一事件正常输出', async () => {
  const h = harness();
  let focused = true;
  h.env.document.visibilityState = 'visible';
  h.env.document.hasFocus = () => focused;
  const n = createBrowserNotifier(h.env);
  await n.enableSound();
  n.update({ quietWhenFocused: true });
  const before = h.starts();
  assert.equal(n.browserReady(), true);
  await n.deliver(event);
  assert.equal(h.starts(), before);
  assert.equal(h.shown.length, 0);
  assert.equal(h.storage.has(RECEIPTS_KEY), false);
  focused = false;
  h.env.document.visibilityState = 'hidden';
  h.listeners.get('blur')();
  assert.equal(n.browserReady(), true);
  await n.deliver({ ...event, id: 'epoch:background' });
  assert.equal(h.starts() - before, 3);
  assert.equal(h.shown.length, 1);
  assert.equal(JSON.parse(h.storage.get(RECEIPTS_KEY))[0].id, 'epoch:background');
  n.dispose();
});

test('two tabs deliver one event once per successful channel under Web Locks', async () => {
  const storage = new Map();
  const locks = serializedLocks();
  const a = harness({ storage, locks });
  const b = harness({ storage, locks });
  const na = createBrowserNotifier(a.env), nb = createBrowserNotifier(b.env);
  await na.enableSound(); await nb.enableSound();
  const before = a.starts() + b.starts();
  await Promise.all([na.deliver(event), nb.deliver(event)]);
  assert.equal(a.shown.length + b.shown.length, 1);
  assert.equal(a.starts() + b.starts() - before, 3);
  assert.deepEqual(JSON.parse(storage.get(RECEIPTS_KEY)), [{ id: event.id, sound: true, desktop: true }]);
  na.dispose(); nb.dispose();
});

test('a failed channel is not recorded as successful and another tab can retry', async () => {
  const storage = new Map(), locks = serializedLocks();
  const a = harness({ storage, locks, failing: true }), b = harness({ storage, locks });
  const na = createBrowserNotifier(a.env), nb = createBrowserNotifier(b.env);
  await na.enableSound();
  await na.deliver(event);
  assert.equal(storage.has(RECEIPTS_KEY), false);
  assert.match(na.snapshot().desktopStatus, /发送失败/);
  assert.equal(na.browserReady(), false);
  await nb.deliver(event);
  assert.equal(b.shown.length, 1);
  na.dispose(); nb.dispose();
});

test('a browser notification error revokes its receipt so another tab can retry', async () => {
  const storage = new Map(), locks = serializedLocks();
  const a = harness({ storage, locks }), b = harness({ storage, locks });
  const na = createBrowserNotifier(a.env), nb = createBrowserNotifier(b.env);
  await na.deliver(event);
  a.shown[0].onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(storage.get(RECEIPTS_KEY))[0].desktop, false);
  assert.match(na.snapshot().desktopStatus, /显示失败/);
  await nb.deliver(event);
  assert.equal(b.shown.length, 1);
  na.dispose(); nb.dispose();
});

test('late resume and permission promises cannot revive an unloaded notifier', async () => {
  const resume = deferred(), request = deferred();
  const h = harness({ resume: resume.promise, request: request.promise, permission: 'default' });
  const n = createBrowserNotifier(h.env);
  const sound = n.enableSound(), desktop = n.requestPermission();
  n.dispose();
  resume.resolve(); request.resolve();
  await Promise.all([sound, desktop]);
  assert.equal(n.browserReady(), false);
  assert.equal(h.starts(), 0);
  assert.equal(h.closed(), 1);
  await n.deliver(event);
  assert.equal(h.shown.length, 0);
});

test('changing sound preference while resume is pending stays off', async () => {
  const resume = deferred();
  const h = harness({ resume: resume.promise });
  const n = createBrowserNotifier(h.env);
  const enabling = n.enableSound();
  n.update({ sound: false });
  resume.resolve(); await enabling;
  assert.equal(n.snapshot().preferences.sound, false);
  assert.equal(h.starts(), 0);
  n.dispose();
});

test('settings are rechecked after awaiting a tab lock', async () => {
  const gate = deferred();
  const h = harness({ locks: { async request(_key, action) { await gate.promise; return action(); } } });
  const n = createBrowserNotifier(h.env);
  const delivery = n.deliver(event);
  n.update({ enabled: false }); gate.resolve(); await delivery;
  assert.equal(h.shown.length, 0);
  assert.equal(h.storage.has(RECEIPTS_KEY), false);
  n.dispose();
});

test('unsupported APIs and denied/insecure permission are visible without automatic prompts', () => {
  const h = harness({ permission: 'denied' });
  delete h.env.AudioContext;
  const n = createBrowserNotifier(h.env);
  assert.match(n.snapshot().soundStatus, /不支持/);
  assert.match(n.snapshot().desktopStatus, /拒绝/);
  assert.match(n.snapshot().tabStatus, /一个任务页面标签页/);
  h.env.isSecureContext = false;
  assert.match(n.snapshot().desktopStatus, /HTTPS/);
  n.dispose();
});

test('successful receipts stay bounded at 256 and clicking uses supplied navigation', async () => {
  const h = harness();
  const opened = [];
  const n = createBrowserNotifier(h.env, id => opened.push(id));
  for (let index = 0; index < 260; index++) await n.deliver({ ...event, id: `epoch:${index}` });
  assert.equal(JSON.parse(h.storage.get(RECEIPTS_KEY)).length, 256);
  assert.equal(h.shown[0].closed, true);
  h.shown.at(-1).onclick();
  assert.deepEqual(opened, [event.sessionId]);
  n.dispose();
});

test('different events share the ledger lock, retaining both tabs receipts', async () => {
  const storage = new Map(), names = [];
  const serial = serializedLocks();
  const locks = { request(name, fn) { names.push(name); return serial.request(name, fn); } };
  const a = harness({ storage, locks }), b = harness({ storage, locks });
  const na = createBrowserNotifier(a.env), nb = createBrowserNotifier(b.env);
  await Promise.all([na.deliver(event), nb.deliver({ ...event, id: 'epoch:2' })]);
  assert.equal(new Set(names).size, 1);
  assert.deepEqual(JSON.parse(storage.get(RECEIPTS_KEY)).map(row => row.id), ['epoch:1', 'epoch:2']);
  na.dispose(); nb.dispose();
});

test('notification navigation rejected promises are reported and consumed', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env, () => Promise.reject(new Error('navigation unavailable')));
  await n.deliver(event); h.shown[0].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(n.snapshot().navigationError, /导航失败/);
  assert.equal(n.browserReady(), true);
  n.dispose();
});

test('polls advance the epoch cursor, abort immediately on readiness changes, and do not overlap', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env);
  const calls = [];
  let active = 0, maxActive = 0;
  const rpc = { call(channel, endpoint, payload, signal) {
    // 固定官方受认证路由契约：共享 /api 通道上的 state-notifier 精确路由。
    assert.equal(channel, '/api'); assert.equal(endpoint, 'state-notifier');
    calls.push(payload); active++; maxActive = Math.max(maxActive, active);
    if (calls.length === 1) { active--; return Promise.resolve({ ok: true, value: { epoch: 'epoch', cursor: 4, reset: false, notices: [], playback: 'auto' } }); }
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { active--; reject(new Error('abort')); }, { once: true }));
  } };
  const polling = startPolling(rpc, n, h.env);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0].cursor, null);
  assert.deepEqual(calls[1].cursor, { epoch: 'epoch', seq: 4 });
  n.update({ enabled: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[2].browserReady, false);
  assert.equal(maxActive, 1);
  polling.dispose(); n.dispose(); await polling.done;
  assert.equal(active, 0);
});

test('host terminal/none policies suppress browser output', async () => {
  const h = harness(); const n = createBrowserNotifier(h.env);
  n.setHostState('terminal', false); await n.deliver(event);
  n.setHostState('none', false); await n.deliver({ ...event, id: 'epoch:2' });
  assert.equal(h.shown.length, 0); n.dispose();
});

test('通知正文显示真实会话短标识，不再输出被截断的 session- 前缀', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env);
  await n.enableSound();
  await n.deliver({ ...event, id: 'label:1', sessionId: 'session-2fcae467-71ee-4b75-b175-ec061bd76fd2' });
  assert.equal(h.shown[0].options.body, '会话 2fcae467');
  await n.deliver({ ...event, id: 'label:2', sessionId: 'plain-id-123456', sessionLabel: '修复登录超时' });
  assert.equal(h.shown[1].options.body, '会话 plain-id', '默认不显示标题');
  n.update({ showSessionTitle: true });
  await n.deliver({ ...event, id: 'label:3', sessionId: 'session-2fcae467-71ee-4b75-b175-ec061bd76fd2', sessionLabel: '修复登录超时' });
  assert.equal(h.shown[2].options.body, '会话 修复登录超时');
  await n.deliver({ ...event, id: 'label:4', sessionId: 'session-2fcae467-71ee-4b75', sessionLabel: '' });
  assert.equal(h.shown[3].options.body, '会话 2fcae467', '标题缺失时回退短标识');
  n.dispose();
});

test('声音方案按事件类别生效，默认方案保持原音色', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env);
  await n.enableSound();
  assert.equal(h.starts(), 3, '默认完成音为三个音');
  n.update({ sounds: { ...n.snapshot().preferences.sounds, complete: 'soft' } });
  await n.enableSound('complete');
  assert.equal(h.starts(), 5, '柔和完成音为两个音');
  n.update({ sounds: { ...n.snapshot().preferences.sounds, complete: '不存在的方案' } });
  assert.equal(n.snapshot().preferences.sounds.complete, 'soft', '未知方案被忽略而不是清空');
  n.dispose();
});

test('v1 偏好可以迁移到 v2，且 v2 优先', () => {
  const storage = new Map([[LEGACY_PREFERENCES_KEY, JSON.stringify({ enabled: true, sound: false, desktop: true, quietWhenFocused: true, volume: 0.25 })]]);
  const h = harness({ storage });
  const n = createBrowserNotifier(h.env);
  const migrated = n.snapshot().preferences;
  assert.equal(migrated.sound, false);
  assert.equal(migrated.quietWhenFocused, true);
  assert.equal(migrated.volume, 0.25);
  assert.equal(migrated.sounds.complete, 'default', '缺失的字段取默认值');
  assert.equal(h.storage.has(PREFERENCES_KEY), true, '迁移结果写回 v2');
  n.dispose();

  const both = new Map([
    [LEGACY_PREFERENCES_KEY, JSON.stringify({ sound: false })],
    [PREFERENCES_KEY, JSON.stringify({ sound: true })],
  ]);
  const h2 = harness({ storage: both });
  const n2 = createBrowserNotifier(h2.env);
  assert.equal(n2.snapshot().preferences.sound, true, 'v2 优先于 v1');
  n2.dispose();
});

test('自定义图标只接受受支持且不超限的内联图片', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(n.setIcon(png), true);
  assert.equal(n.snapshot().preferences.icon, 'custom');
  assert.equal(n.snapshot().icon, png);
  assert.equal(n.setIcon('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(n.setIcon(`data:image/png;base64,${'A'.repeat(ICON_DATA_LIMIT * 2)}`), false);
  assert.equal(n.snapshot().icon, png, '被拒绝的图标不覆盖已保存的图标');
  assert.equal(h.storage.has(RECEIPTS_KEY), false);
  n.update({ icon: '🔔', iconData: '' });
  assert.equal(n.snapshot().preferences.icon, '🔔');
  n.dispose();
});

test('自定义图标进入原生通知，内置图标不伪造 icon', async () => {
  const h = harness();
  const n = createBrowserNotifier(h.env);
  await n.enableSound();
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  await n.deliver({ ...event, id: 'icon:1' });
  assert.equal('icon' in h.shown[0].options, false, '默认铃铛不发 icon');
  n.setIcon(png);
  await n.deliver({ ...event, id: 'icon:2' });
  assert.equal(h.shown[1].options.icon, png);
  n.dispose();
});

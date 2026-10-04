// 独立浏览器夹具：只加载浏览器提醒模块，不启动 Harness，也不连接真实会话。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : await import('playwright').catch(() => { throw new Error('请将 PLAYWRIGHT_MODULE 指向已安装的 playwright/index.js；无需给插件增加依赖。'); });
const source = await readFile(new URL('../src/browser.js', import.meta.url));
const html = `<!doctype html><html lang="zh"><meta charset="UTF-8"><title>浏览器提醒检查</title>
<button id="sound">启用声音</button><button id="permission">请求通知权限</button>
<script type="module">
import { createBrowserNotifier } from '/browser.js';
window.notifier = createBrowserNotifier(window, id => { window.opened = id; });
document.querySelector('#sound').onclick = () => notifier.enableSound();
document.querySelector('#permission').onclick = () => notifier.requestPermission();
</script></html>`;
// 用内存请求拦截加载 localhost 夹具，避免开启服务或要求本机端口权限。
const origin = 'http://127.0.0.1:18773';
let browser;
export let result;
try {
  browser = await (playwright.chromium || playwright.default.chromium).launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext();
  await context.route(`${origin}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/browser.js') return route.fulfill({ contentType: 'text/javascript', body: source });
    if (path === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    return route.fulfill({ status: 204, body: '' });
  });
  // 仅计数真实 Web Audio 节点与原生 Notification 构造，不替换输出实现。
  await context.addInitScript(() => {
    window.outputCounts = { sound: 0, desktop: 0 };
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) { window.outputCounts.sound++; return create.apply(this, args); };
    const Native = Notification;
    window.Notification = new Proxy(Native, { construct(target, args) { window.outputCounts.desktop++; return Reflect.construct(target, args); } });
  });
  const a = await context.newPage();
  await a.goto(origin); await a.waitForFunction(() => !!window.notifier);
  const initial = await a.evaluate(() => ({ secure: isSecureContext, locks: !!navigator.locks, state: notifier.snapshot() }));
  assert.equal(initial.secure, true); assert.equal(initial.locks, true);
  assert.equal(initial.state.browserReady, false); assert.equal(initial.state.permission, 'default');
  // 真实 click 产生用户手势；权限单独由测试环境授权，避免自动操作系统弹窗。
  await a.locator('#sound').click();
  await a.waitForFunction(() => notifier.snapshot().soundStatus === '声音已解锁');
  assert.equal(await a.evaluate(() => notifier.browserReady()), true);
  assert.equal(await a.evaluate(() => Notification.permission), 'default');
  await context.grantPermissions(['notifications'], { origin });
  const b = await context.newPage();
  await b.goto(origin); await b.waitForFunction(() => !!window.notifier); await b.locator('#sound').click();
  await b.waitForFunction(() => notifier.snapshot().soundStatus === '声音已解锁');
  for (const tab of [a, b]) await tab.evaluate(() => { outputCounts.sound = 0; outputCounts.desktop = 0; });
  const notice = { id: 'smoke:dual', kind: 'complete', sessionId: 'smoke-private-session', time: Date.now() };
  await Promise.all([a.evaluate(n => notifier.deliver(n), notice), b.evaluate(n => notifier.deliver(n), notice)]);
  const counts = await Promise.all([a, b].map(tab => tab.evaluate(() => outputCounts)));
  assert.equal(counts.reduce((sum, item) => sum + item.desktop, 0), 1);
  assert.equal(counts.reduce((sum, item) => sum + item.sound, 0), 3);
  let receipts = await a.evaluate(() => JSON.parse(localStorage.getItem('dsh-state-notifier.receipts.v1')));
  assert.deepEqual(receipts, [{ id: notice.id, sound: true, desktop: true }]);
  // 每类各有真实输出正例，确保分类检查不是空数组上的通过。
  const tones = { complete: 3, approval: 2, question: 2, block: 2, error: 3 };
  for (const [kind, toneCount] of Object.entries(tones)) {
    const before = await a.evaluate(() => ({ ...outputCounts }));
    await a.evaluate(n => notifier.deliver(n), { ...notice, id: `smoke:${kind}`, kind });
    const after = await a.evaluate(() => ({ ...outputCounts }));
    assert.equal(after.sound - before.sound, toneCount); assert.equal(after.desktop - before.desktop, 1);
  }
  await a.evaluate(() => notifier.update({ enabled: false }));
  await b.waitForFunction(() => notifier.snapshot().preferences.enabled === false);
  await Promise.all([a.evaluate(n => notifier.deliver(n), { ...notice, id: 'smoke:disabled' }), b.evaluate(n => notifier.deliver(n), { ...notice, id: 'smoke:disabled' })]);
  receipts = await a.evaluate(() => JSON.parse(localStorage.getItem('dsh-state-notifier.receipts.v1')));
  assert.equal(receipts.length, 6); assert.equal(receipts.some(row => row.id === 'smoke:disabled'), false);
  await a.evaluate(() => notifier.update({ enabled: true }));
  await b.waitForFunction(() => notifier.snapshot().preferences.enabled === true);
  await b.evaluate(n => notifier.deliver(n), { ...notice, id: 'smoke:reenabled' });
  assert.equal(await b.evaluate(() => JSON.parse(localStorage.getItem('dsh-state-notifier.receipts.v1')).length), 7);
  // 另一标签页持续持锁。卸载必须取消真实排队请求，不能等持锁方退出。
  await b.evaluate(() => {
    window.heldLock = navigator.locks.request('dsh-state-notifier.delivery.v1', () => new Promise(resolve => {
      window.releaseHeldLock = resolve;
    }));
  });
  await b.waitForFunction(() => !!window.releaseHeldLock);
  await a.evaluate(n => {
    window.deliverySettled = false;
    void notifier.deliver(n).then(() => { window.deliverySettled = true; });
  }, { ...notice, id: 'smoke:cancelled-lock' });
  await a.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'dsh-state-notifier.delivery.v1'));
  await a.evaluate(() => notifier.dispose());
  await a.waitForFunction(() => window.deliverySettled);
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('dsh-state-notifier.receipts.v1')).length), 7);
  await b.evaluate(() => { window.releaseHeldLock(); return window.heldLock; });
  await Promise.all([a, b].map(tab => tab.evaluate(() => notifier.dispose())));
  assert.equal(await a.evaluate(() => notifier.browserReady()), false);
  await a.evaluate(n => notifier.deliver(n), { ...notice, id: 'smoke:disposed' });
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('dsh-state-notifier.receipts.v1')).length), 7);
  result = { ok: true, browser: await browser.version(), userAgent: await a.evaluate(() => navigator.userAgent), simultaneousTabs: 2, duplicateNativeConstructions: 1, cancelledQueuedLocks: 1, testedKinds: Object.keys(tones), successfulReceipts: 7, permission: '测试上下文显式授予', evidence: '浏览器 API 接受输出、Web Locks 去重与排队取消、storage 同步、手势解锁与卸载；不证明系统弹窗或声音可听' };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
}

// 完整 dsh Web 验收（N-08）：连接真实 dsh Web 宿主，检查插槽入口、认证边界与宿主事件到浏览器的投递。
// 它要求一个已启动并已安装本插件的 dsh Web 实例，不启动应用、不读取真实会话正文。
// 用法：
//   DSH_WEB_URL="http://127.0.0.1:7712/?token=..." \
//   DSH_ACCEPT_WORKSPACE=/absolute/path/to/workspace \
//   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js \
//   node scripts/web-acceptance.mjs
// 只有设置 DSH_ACCEPT_TURN=1 才会发送提示词。回合会真实调用宿主配置的模型：
// 在已配置凭据且模型很快返回的 profile 上，完成提醒可能被 minDuration 门槛过滤；
// 此时用审批、提问或错误事件验收，或临时把 minDuration 设为 0。
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const url = process.env.DSH_WEB_URL;
if (!url) throw new Error('请设置 DSH_WEB_URL，包含启动时打印的 token。');
const origin = new URL(url).origin;
const workspace = process.env.DSH_ACCEPT_WORKSPACE;
if (!workspace) throw new Error('请设置 DSH_ACCEPT_WORKSPACE，指向验收专用工作区目录。');
const withTurn = process.env.DSH_ACCEPT_TURN === '1';
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : await import('playwright').catch(() => { throw new Error('请将 PLAYWRIGHT_MODULE 指向已安装的 playwright/index.js；无需给插件增加依赖。'); });

const result = { origin, checks: [], fence: {}, ui: {}, delivery: null, limits: [] };
const pass = (name, detail = '') => { result.checks.push({ name, status: '通过', detail }); console.log('通过 -', name, detail); };

// 1. 官方 Connection 的 Host/Origin 与浏览器认证边界。未认证与跨站请求都不能到达插件。
const envelope = JSON.stringify({
  type: 'client-request', rpcId: 'web-acceptance', method: 'state-notifier',
  payload: { clientId: 'web-acceptance', browserReady: false, cursor: null },
});
const post = (headers = {}) => fetch(`${origin}/api/state-notifier`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: envelope, redirect: 'manual',
});
const anonymous = await post();
assert.equal(anonymous.status, 401, '未认证请求必须被官方 Connection 拒绝');
result.fence.unauthenticated = anonymous.status;
pass('未认证请求被拒绝', `HTTP ${anonymous.status}`);
const crossSite = await post({ origin: 'http://evil.example' });
assert.equal(crossSite.status, 403, '跨站 Origin 必须被信任边界拒绝');
result.fence.crossOrigin = crossSite.status;
pass('跨站 Origin 被拒绝', `HTTP ${crossSite.status}`);

await mkdir(workspace, { recursive: true });
const browser = await (playwright.chromium || playwright.default.chromium).launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== '0' });
try {
  const context = await browser.newContext();
  await context.grantPermissions(['notifications'], { origin });
  const page = await context.newPage();
  const rpcRequests = [];
  context.on('response', response => { if (response.url().includes('/api/state-notifier')) rpcRequests.push(`${response.request().method()} ${response.status()}`); });
  // 只计数真实输出，不替换插件实现。
  await page.addInitScript(() => {
    window.__acceptance = { notices: [], tones: 0 };
    const Native = window.Notification;
    window.Notification = new Proxy(Native, { construct(target, args) { window.__acceptance.notices.push({ title: args[0], body: args[1]?.body }); return Reflect.construct(target, args); } });
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) { window.__acceptance.tones++; return create.apply(this, args); };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const click = async (name, scope) => {
    const button = (scope ?? page).getByRole('button', { name });
    if (!(await button.count())) return false;
    await button.first().click({ force: true });
    await page.waitForTimeout(900);
    return true;
  };
  const send = async () => {
    const composer = page.locator('[contenteditable="true"]').first();
    assert.equal(await composer.count(), 1, '必须找到真实输入框');
    await composer.click({ force: true });
    await composer.type('验收：请回答 ok', { delay: 15 });
    await page.keyboard.press('Enter');
  };
  for (const label of [/Configure later/, /^Continue$/]) await click(label);

  // 已登录上下文复用浏览器 Cookie：未声明的方法不能进入插件，只能得到官方 404。
  const wrongMethod = await context.request.get(`${origin}/api/state-notifier`);
  result.fence.wrongMethod = wrongMethod.status();
  assert.equal(wrongMethod.status(), 404, '未声明的方法必须由官方路由拒绝');
  pass('已登录的未声明方法回到官方 404', `HTTP ${wrongMethod.status()}`);

  // 2. “常规”设置入口必须出现，并显示已连接到宿主订阅。声音也在这里解锁，位置与会话是否非空无关。
  await page.getByRole('button', { name: 'Settings' }).first().click({ force: true });
  await page.waitForTimeout(2500);
  let text = await page.evaluate(() => document.body.innerText);
  assert.equal(text.includes('任务状态提醒'), true, '设置页必须出现通知面板');
  assert.equal(text.includes('提醒服务已连接'), true, '浏览器必须已连上宿主订阅');
  result.ui.settingsItem = true;
  result.ui.transport = '提醒服务已连接';
  result.ui.permission = await page.evaluate(() => Notification.permission);
  pass('设置“常规”入口出现且订阅已连接');
  await click(/启用 \/ 试听声音/);
  await page.waitForTimeout(1000);
  text = await page.evaluate(() => document.body.innerText);
  result.ui.soundUnlocked = text.includes('声音已解锁');
  assert.equal(result.ui.soundUnlocked, true, '点击后必须真正解锁声音');
  pass('声音已解锁，浏览器具备输出能力');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // 3. 选择验收工作区并打开会话。
  if (!(await page.getByText('workspace', { exact: true }).count())) {
    await click(/Choose workspace/);
    await page.getByRole('button', { name: 'Edit path' }).click({ force: true });
    await page.waitForTimeout(500);
    const input = page.locator('[role="dialog"] input').last();
    await input.fill(workspace);
    await input.press('Enter');
    await page.waitForTimeout(1000);
    await click(/^Open$/);
    await page.waitForTimeout(2500);
  } else {
    await page.getByText('workspace', { exact: true }).first().click({ force: true });
    await page.waitForTimeout(3000);
  }

  // 4. 会话头部铃铛只在头部进入非空状态后渲染；头部为空白时先用一次预热回合产生内容。
  const bell = page.locator('summary[aria-label="任务状态提醒"]');
  if (!(await bell.count()) && withTurn) { await send(); await page.waitForTimeout(9000); }
  if (await bell.count()) {
    result.ui.sessionHeaderItem = true;
    pass('会话头部铃铛入口出现');
  } else {
    result.limits.push('会话头部为空白时只渲染 corner 槽；本次没有非空会话，铃铛入口未出现。');
  }

  // 5. 真实宿主事件到浏览器的投递。浏览器必须已就绪，否则按设计丢弃。
  if (withTurn) {
    const before = await page.evaluate(() => window.__acceptance);
    await send();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(2500);
      const now = await page.evaluate(() => window.__acceptance);
      if (now.notices.length > before.notices.length || now.tones > before.tones) break;
    }
    const after = await page.evaluate(() => window.__acceptance);
    result.delivery = { soundDelta: after.tones - before.tones, desktopDelta: after.notices.length - before.notices.length, notices: after.notices };
    assert.equal(after.tones > before.tones || after.notices.length > before.notices.length, true, '真实宿主事件必须到达浏览器输出');
    pass('真实宿主事件到达浏览器', JSON.stringify(result.delivery));
  } else {
    result.limits.push('未设置 DSH_ACCEPT_TURN=1，未发送提示词，未验证真实宿主事件到浏览器的投递。');
  }
  result.browser = await browser.version();
  result.rpcRequests = rpcRequests.slice(0, 10);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

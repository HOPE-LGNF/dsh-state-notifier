// 隔离 React 界面夹具。使用真实浏览器提醒模块，仅模拟宿主插槽和 RPC；不启动 dsh。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.UI_ARTIFACTS || 'artifacts/ui');
await mkdir(output, { recursive: true });
const fixture = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { apply } from './src/client.js';
    const entries = new Map(), cleanup = [];
    const f = window.fixture = { calls: [], polls: 0, aborted: 0, tones: 0 };
    const oscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function(...args) { f.tones++; return oscillator.apply(this, args); };
    apply({
      get: () => ({ openSession() {} }), effect: effect => {
        let off = effect();
        const dispose = () => { const release = off; off = null; release?.(); };
        cleanup.push(dispose);
        return dispose;
      },
      slots: { inject: (name, callback) => callback(), register: (entry, render) => entries.set(entry.name, { ...entry, render }) },
      connection: { rpc: { call: async (path, method, payload, signal) => {
        if (payload.action) { f.calls.push(payload); return new Promise(resolve => { f.finish = value => resolve({ ok: true, value }); }); }
        f.polls++;
        if (!payload.cursor) return { ok: true, value: { epoch: 'fixture', cursor: 0, reset: false, notices: [], playback: 'auto' } };
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { f.aborted++; reject(new Error('aborted')); }, { once: true }));
      } } },
    });
    const renderer = createRoot(document.getElementById('root'));
    f.mount = (view = 'page') => renderer.render(view === 'closed' ? null : view === 'bell'
      ? entries.get('conversation.session.header.utilities').render()
      : entries.get('plugins.row.config').render({ view }));
    f.dispose = () => { renderer.unmount(); cleanup.forEach(off => off?.()); };
    f.entries = [...entries.keys()];
    f.mount();
  `, resolveDir: root, sourcefile: 'ui-fixture.js' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  nodePaths: process.env.UI_REACT_MODULES ? [process.env.UI_REACT_MODULES] : [],
});
const css = `:root { color-scheme: light; --dsw-alias-label-primary:#22252b; --dsw-alias-label-secondary:#656b75; --dsw-alias-border-l2:#e2e4e8; --dsw-alias-bg-layer-2:#fff; --dsw-alias-bg-layer-3:#f4f5f7; --dsw-alias-brand-primary:#5264d9; --dsw-alias-label-primary-foreground:#fff; --dsw-alias-interactive-bg-hover:#eff1f5; --dsw-alias-state-error-primary:#b42318; }
html.dark { color-scheme:dark; --dsw-alias-label-primary:#ebedf2; --dsw-alias-label-secondary:#a3a9b6; --dsw-alias-border-l2:#343841; --dsw-alias-bg-layer-2:#202329; --dsw-alias-bg-layer-3:#2a2e36; --dsw-alias-brand-primary:#8999ff; --dsw-alias-interactive-bg-hover:#303640; --dsw-alias-state-error-primary:#ffaaa3; }
body { margin:0; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:14px system-ui,sans-serif; } main { max-width:760px; padding:32px; margin:auto; } .fixture-label { color:var(--dsw-alias-label-secondary); font-size:12px; padding-bottom:28px; } .bell #root { display:flex; justify-content:flex-end; } @media(max-width:600px){ main{padding:20px 16px;} }`;
const origin = 'http://127.0.0.1:18774';
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL && process.env.PLAYWRIGHT_CHANNEL !== 'chromium' ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(`${origin}/**`, route => new URL(route.request().url()).pathname === '/fixture.js'
    ? route.fulfill({ contentType: 'text/javascript', body: fixture.outputFiles[0].text })
    : route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh"><meta charset="utf-8"><title>提醒设置 · 隔离夹具</title><style>${css}</style><main><div class="fixture-label">组件配置页 / 隔离界面夹具 · 非真实宿主验收</div><div id="root"></div></main><script src="/fixture.js"></script></html>` }));
  const page = await context.newPage();
  const settleSections = () => page.evaluate(async () => {
    document.body.getBoundingClientRect();
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
    await new Promise(requestAnimationFrame);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  const panel = page.getByRole('group', { name: '任务状态提醒设置' });
  await panel.waitFor();
  assert.deepEqual(await page.evaluate(() => fixture.entries), ['conversation.session.header.utilities', 'plugins.row.config']);
  const enabled = panel.getByRole('checkbox', { name: '启用此浏览器的提醒', exact: true });
  await enabled.focus(); await page.keyboard.press('Space'); assert.equal(await enabled.isChecked(), false);
  await page.keyboard.press('Space'); assert.equal(await enabled.isChecked(), true);
  await panel.getByRole('button', { name: '点击解锁声音', exact: true }).click();
  const volume = panel.getByRole('slider', { name: '提醒音量' });
  await volume.focus(); await page.keyboard.press('ArrowRight'); assert.equal(await volume.inputValue(), '0.55');
  await panel.getByText('声音方案与试听', { exact: true }).click();
  await panel.getByRole('combobox', { name: '统一声音方案' }).selectOption('soft');
  for (const kind of ['任务完成', '等待批准', '等待回答', '任务受阻', '发生错误']) {
    assert.equal(await panel.getByRole('combobox', { name: `${kind}声音`, exact: true }).inputValue(), 'soft');
    await panel.getByRole('button', { name: `试听${kind}`, exact: true }).click();
  }
  assert.ok(await page.evaluate(() => fixture.tones >= 10));
  await panel.getByText('通知外观', { exact: true }).click();
  await panel.getByRole('checkbox', { name: '显示会话标题', exact: true }).check();
  await panel.getByRole('checkbox', { name: '显示提问的问题', exact: true }).uncheck();
  // 折叠动画结束后再进行键盘操作，避免控件仍被 details-content 裁剪。
  await settleSections();
  const choose = panel.getByRole('button', { name: '选择图标文件' });
  await choose.focus();
  const fileChooser = page.waitForEvent('filechooser'); await page.keyboard.press('Enter');
  await (await fileChooser).setFiles({ name: 'fixture-icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#5264d9"/></svg>') });
  await panel.getByRole('button', { name: '清除', exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dsh-state-notifier.preferences.v2')).icon === 'custom');
  await panel.getByRole('button', { name: '清除', exact: true }).click();
  await panel.getByLabel('上传自定义图标').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') });
  await panel.getByRole('alert').waitFor();
  await panel.getByRole('button', { name: '使用 🔔 图标', exact: true }).click();
  await panel.getByText('系统通知穿透', { exact: true }).click();
  await panel.getByRole('button', { name: '检测环境' }).click();
  assert.equal(await panel.getByRole('button', { name: '检测中…' }).isDisabled(), true);
  await page.evaluate(() => fixture.finish({ available: true, mode: 'off', platform: 'win32', candidates: ['C:\\fixture\\pwsh.exe'] }));
  await panel.getByRole('button', { name: '检测环境' }).waitFor();
  await panel.getByRole('combobox', { name: '穿透模式' }).selectOption('auto');
  assert.equal(await page.evaluate(() => fixture.calls.at(-1).mode), 'auto');
  await page.evaluate(() => fixture.finish({ mode: 'auto' }));
  await panel.getByRole('combobox', { name: '穿透模式' }).selectOption('off');
  await page.evaluate(() => fixture.finish({ mode: 'off' }));
  await panel.getByRole('combobox', { name: '穿透模式' }).selectOption('manual');
  await page.evaluate(() => fixture.finish({ mode: 'manual' }));
  await panel.getByRole('textbox', { name: '解释器绝对路径' }).fill('C:\\fixture\\pwsh.exe');
  await panel.getByRole('button', { name: '应用', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => fixture.calls.at(-1)), { action: 'setNative', mode: 'manual', path: 'C:\\fixture\\pwsh.exe' });
  await page.evaluate(() => fixture.finish({ mode: 'manual', path: 'C:\\fixture\\pwsh.exe' }));
  await panel.getByRole('button', { name: '发送测试通知' }).click();
  assert.equal(await panel.getByRole('button', { name: '发送中…' }).isDisabled(), true);
  await page.evaluate(() => fixture.finish({ ok: true, state: 'disabled-for-app' }));
  await panel.getByRole('status').filter({ hasText: '该应用的通知被关闭' }).waitFor();
  await panel.getByRole('button', { name: '发送测试通知' }).click();
  await page.evaluate(() => fixture.finish({ ok: false, reason: 'fixture unavailable' }));
  await panel.getByRole('status').filter({ hasText: '失败：fixture unavailable' }).waitFor();
  await panel.getByText('权限及运行信息', { exact: true }).click();
  await panel.getByText('提醒服务已连接', { exact: true }).waitFor();
  const polls = await page.evaluate(() => fixture.polls);
  await page.evaluate(() => fixture.mount('closed')); await panel.waitFor({ state: 'hidden' });
  await page.evaluate(() => fixture.mount()); await panel.waitFor();
  assert.equal(await page.evaluate(() => fixture.polls), polls);
  assert.equal(await volume.inputValue(), '0.55');
  await page.reload(); await panel.waitFor();
  await panel.getByText('通知外观', { exact: true }).click();
  assert.equal(await panel.getByRole('checkbox', { name: '显示会话标题', exact: true }).isChecked(), true);
  assert.equal(await panel.getByRole('checkbox', { name: '显示提问的问题', exact: true }).isChecked(), false);
  await panel.getByRole('checkbox', { name: '显示提问的问题', exact: true }).check();
  await panel.getByRole('button', { name: '点击解锁声音', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await page.screenshot({ animations: 'disabled', path: resolve(output, `${theme}-overview.png`), fullPage: true });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); document.querySelectorAll('.dsn-section').forEach(el => { el.open = true; }); }, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ animations: 'disabled', path: resolve(output, `${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => { document.body.classList.add('bell'); fixture.mount('bell'); });
  await page.getByLabel('任务状态提醒', { exact: true }).click();
  const appearanceSection = page.locator('.dsn-popover .dsn-section').filter({ has: page.getByText('通知外观', { exact: true }) });
  await appearanceSection.locator('summary').scrollIntoViewIfNeeded();
  await appearanceSection.locator('summary').click();
  await settleSections();
  const expanded = await appearanceSection.evaluate(el => {
    const p = el.closest('.dsn-popover'), viewport = p.getBoundingClientRect(), bounds = el.getBoundingClientRect();
    return { top: bounds.top - viewport.top - p.clientTop, bottom: bounds.bottom - viewport.top - p.clientTop,
      height: p.clientHeight, padding: parseFloat(getComputedStyle(p).paddingTop), scroll: p.scrollTop };
  });
  assert.ok(expanded.scroll > 0, 'expansion must bring settings into view');
  assert.ok(expanded.top >= expanded.padding - 1, 'the section title must remain visible');
  assert.ok(expanded.bottom <= expanded.height - expanded.padding + 1 || Math.abs(expanded.top - expanded.padding) <= 1,
    'show the lower edge, or stop at the title for a tall section');
  await appearanceSection.locator('summary').click();
  await settleSections();
  const collapsed = await appearanceSection.evaluate(el => {
    const p = el.closest('.dsn-popover');
    return { scroll: p.scrollTop, maximum: p.scrollHeight - p.clientHeight };
  });
  assert.ok(Math.abs(collapsed.scroll - Math.min(expanded.scroll, collapsed.maximum)) <= 1,
    'collapse retains the reading position unless the scroll range shrinks');
  // 快速反向操作后仍可继续滚动和操作控件。
  await appearanceSection.locator('summary').evaluate(el => { el.click(); el.click(); el.click(); });
  await settleSections();
  assert.equal(await appearanceSection.getAttribute('open'), '');
  await page.evaluate(() => document.querySelectorAll('.dsn-section').forEach(el => { el.open = true; }));
  // 展开高度稳定后再检查滚动终点，避免在过渡中采样。
  await page.evaluate(async () => {
    document.body.getBoundingClientRect();
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const popover = page.locator('.dsn-popover');
  assert.equal(await popover.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await popover.evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok(await popover.evaluate(el => el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1));
  await popover.evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ animations: 'disabled', path: resolve(output, 'bell-390.png') });
  await page.evaluate(() => fixture.dispose());
  assert.ok(await page.evaluate(() => fixture.aborted > 0));
  assert.deepEqual(errors, []);
  const result = { ok: true, browser: await browser.version(), checks: ['slots', 'keyboard switches and volume', 'five sound previews', 'upload keyboard and validation', 'native RPC and pending/results', 'view lifecycle', 'reload preferences', 'light/dark 1440/390', 'bell scroll and section anchoring', 'disposal'], evidence: '隔离 React 界面与模拟宿主 RPC；不证明真实宿主入口、系统弹窗或声音可听' };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }

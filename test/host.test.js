import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { apply } from '../src/index.js';

// Connection 仅替换运输边界。此套件不启动 HTTP，不验证真实网络认证。
class TestConnection extends Service {
  channels = new Map();
  removals = 0;
  constructor(ctx) { super(ctx, 'connection'); }
  get rpc() {
    return {
      handle: (channel, handler) => {
        assert.equal(channel, '/state-notifier');
        assert.equal(this.channels.has(channel), false, '旧 channel 必须先释放');
        this.channels.set(channel, handler);
        return async () => {
          if (this.channels.get(channel) === handler) this.channels.delete(channel);
          this.removals += 1;
        };
      },
    };
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 此计时器保持 Node 活动，同时使未释放的长轮询成为失败而不是空通过。
async function within(promise, ms = 1000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待通知操作超时')), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function boot(config = {}, output = {}) {
  const root = new Context();
  const writes = [];
  const warnings = [];
  await root.plugin(SessionStore);
  await root.plugin(TestConnection);
  const fiber = root.plugin({
    name: 'state-notifier-host-fixture',
    apply(ctx) {
      apply(ctx, { playback: 'none', minDuration: 0, ...config }, {
        write: value => { writes.push(String(value)); return output.write?.(value); },
        warn: value => { warnings.push(String(value)); return output.warn?.(value); },
        isTTY: output.isTTY ?? (() => true),
      });
    },
  });
  await fiber;
  const connection = root.connection;
  const handler = connection.channels.get('/state-notifier');
  assert.equal(typeof handler, 'function', '插件必须实际注册 RPC handler');
  const session = root.sessions.create('host-fixture');
  let id = 0;
  return {
    root, fiber, connection, writes, warnings, session,
    call(payload, endpoint = 'poll', signal = new AbortController().signal) {
      return handler(endpoint, payload, signal, { role: 'operator' });
    },
    approval() {
      return session.append('approval/asked', { id: `approval-${++id}`, toolName: 'shell', reason: '需要批准' });
    },
    async stop() { await within(root.fiber.dispose()); },
  };
}

const request = (cursor = null, browserReady = false) => ({ clientId: 'host-test-tab', browserReady, cursor });
const cursorOf = value => ({ epoch: value.epoch, seq: value.cursor });
const bells = writes => writes.filter(value => value === '\x07').length;

test('Host RPC：首次基线、审批唤醒等待和重复游标重读', async t => {
  const h = await boot();
  t.after(() => h.stop());
  h.approval();
  const baseline = await within(h.call(request()));
  assert.equal(baseline.ok, true);
  assert.equal(baseline.value.cursor, 1);
  assert.deepEqual(baseline.value.notices, [], '首次订阅不重放历史审批');
  const cursor = cursorOf(baseline.value);

  let settled = false;
  const pending = h.call(request(cursor)).then(value => { settled = true; return value; });
  await delay(10);
  assert.equal(settled, false, '没有新事件时必须正在等待');
  const event = h.approval();
  assert.equal(h.session.snapshotEvents().at(-1).seq, event.seq);
  const next = await within(pending);
  assert.equal(next.ok, true);
  assert.equal(next.value.notices.length, 1);
  assert.equal(next.value.notices[0].kind, 'approval');
  assert.equal(next.value.notices[0].sessionId, h.session.id);
  assert.equal(next.value.cursor, 2);
  assert.deepEqual((await within(h.call(request(cursor)))).value.notices, next.value.notices);
  assert.deepEqual(h.warnings, []);
});

test('Host RPC：无效参数和未知 endpoint 返回明确失败，后续合法请求仍能工作', async t => {
  const h = await boot();
  t.after(() => h.stop());
  for (const payload of [null, {}, request({ epoch: 'old', seq: -1 }), { ...request(), browserReady: 'yes' }]) {
    const result = await within(h.call(payload));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad-request');
  }
  const missing = await within(h.call(request(), 'missing'));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'not-found');
  assert.equal((await within(h.call(request()))).ok, true);
});

test('Host RPC：卸载释放挂起请求与异步 channel disposer，停止观察会话', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const baseline = await within(h.call(request()));
  const pending = h.call(request(cursorOf(baseline.value)));
  await delay(10);
  await within(h.fiber.dispose());
  const result = await within(pending);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unavailable');
  assert.equal(h.connection.channels.size, 0);
  assert.equal(h.connection.removals, 1, '异步 disposer 必须被 Cordis 调用且只调用一次');
  h.approval();
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.warnings, []);
});

test('Host RPC：取消请求结束等待，后续请求能收到审批', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const baseline = await within(h.call(request()));
  const cursor = cursorOf(baseline.value);
  const controller = new AbortController();
  const pending = h.call(request(cursor), 'poll', controller.signal);
  controller.abort();
  assert.equal((await within(pending)).error.code, 'unavailable');
  h.approval();
  assert.equal((await within(h.call(request(cursor)))).value.notices[0].kind, 'approval');
});

test('Host auto：无就绪浏览器时 BEL，有就绪浏览器时只发送语义事件', async t => {
  const h = await boot({ playback: 'auto' });
  t.after(() => h.stop());
  h.approval();
  await delay(175);
  assert.equal(bells(h.writes), 2, '审批终端提示有两次 BEL');
  const baseline = await within(h.call(request(null, true)));
  assert.equal(baseline.value.playback, 'auto');
  const cursor = cursorOf(baseline.value);
  h.approval();
  const next = await within(h.call(request(cursor, true)));
  assert.equal(next.value.notices[0].kind, 'approval');
  await delay(175);
  assert.equal(bells(h.writes), 2, '浏览器就绪后不得重复终端提示');
  assert.deepEqual(h.warnings, []);
});

test('Host enabled=false：真实审批不记录或响铃，RPC基线保持空', async t => {
  const h = await boot({ enabled: false, playback: 'auto' });
  t.after(() => h.stop());
  const event = h.approval();
  assert.equal(h.session.snapshotEvents().at(-1).seq, event.seq);
  await delay(175);
  assert.deepEqual(h.writes, []);
  const baseline = await within(h.call(request()));
  assert.equal(baseline.value.cursor, 0);
  assert.deepEqual(baseline.value.notices, []);
  assert.deepEqual(h.warnings, []);
});

test('Host 输出失败：日志与告警出错仍可发送浏览器通知，错误正文不外泄', async t => {
  for (const failure of ['throw', 'reject']) await t.test(failure, async t => {
    const fail = () => {
      const error = new Error('私密输出异常正文');
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    };
    const h = await boot({}, { write: fail, warn: fail });
    t.after(() => h.stop());
    const baseline = await within(h.call(request()));
    const cursor = cursorOf(baseline.value);
    assert.doesNotThrow(() => h.approval());
    const next = await within(h.call(request(cursor)));
    assert.equal(next.ok, true);
    assert.equal(next.value.notices[0].kind, 'approval', '日志失败不能挡住 journal.publish');
    assert.equal(next.value.notices[0].sessionId, h.session.id);
    await delay(10);
    assert.deepEqual(h.warnings, ['[state-notifier] 通知输出失败；Agent 继续运行。']);
    assert.equal(JSON.stringify([next, h.warnings]).includes('私密'), false);
    h.approval();
    assert.equal((await within(h.call(request(cursorOf(next.value))))).value.notices.length, 1);
  });
});

test('Host 输出失败：异步 BEL 回调和告警失败已隔离，卸载后定时器停止', async t => {
  for (const failure of ['throw', 'reject']) await t.test(failure, async t => {
    const fail = () => {
      const error = new Error('私密终端异常正文');
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    };
    const h = await boot({ playback: 'terminal' }, {
      write: value => value === '\x07' ? fail() : undefined,
      warn: fail,
    });
    t.after(() => h.stop());
    const baseline = await within(h.call(request()));
    h.approval();
    const next = await within(h.call(request(cursorOf(baseline.value))));
    assert.equal(next.value.notices[0].kind, 'approval', '响铃失败不影响通知日志');
    await delay(175);
    assert.equal(bells(h.writes), 2, '两个 BEL 回调必须实际执行而不是空通过');
    assert.deepEqual(h.warnings, [
      '[state-notifier] 通知输出失败；Agent 继续运行。',
      '[state-notifier] 通知输出失败；Agent 继续运行。',
    ]);
    assert.equal(JSON.stringify([next, h.warnings]).includes('私密'), false);
    h.approval();
    await within(h.fiber.dispose());
    const stoppedAt = bells(h.writes);
    await delay(175);
    assert.equal(bells(h.writes), stoppedAt, '卸载后不得执行未完成的 BEL 回调');
  });
});

test('Host 配置：显式默认值生效，不合并旧 bell 运行时文件', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'state-notifier-config-'));
  const file = join(directory, 'notify-bell.json');
  await writeFile(file, JSON.stringify({ enabled: false, playback: 'none', minDuration: 60, events: { approval: { enabled: false } } }));
  const previous = process.env.DSH_NOTIFY_BELL_CONFIG;
  process.env.DSH_NOTIFY_BELL_CONFIG = file;
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_NOTIFY_BELL_CONFIG;
    else process.env.DSH_NOTIFY_BELL_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const h = await boot({ enabled: true, playback: 'auto', minDuration: 10, events: { approval: true } });
  t.after(() => h.stop());
  h.approval();
  await delay(175);
  assert.equal(h.writes.filter(value => value === '[state-notifier] 等待审批\n').length, 1);
  assert.equal(bells(h.writes), 2, '显式auto与enabled=true不能被旧文件覆盖');
  assert.equal((await within(h.call(request()))).value.playback, 'auto');
  assert.deepEqual(h.warnings, []);
});

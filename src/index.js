import z from '@deepseek-ai/schemastery';
import { createNotifier } from './core.js';
import { createJournal } from './journal.js';
import { notify as nativeNotify, probe as nativeProbe, resolveExecutable as nativeResolve, test as nativeTest } from './native.js';

export const name = 'state-notifier';
export const inject = [];
const kinds = ['complete', 'approval', 'question', 'block', 'error'];
export const Config = z.object({
  enabled: z.boolean().default(true).description('启用通知'),
  playback: z.union(['auto', 'browser', 'terminal', 'none'].map(v => z.const(v))).default('auto').description('auto 在浏览器未就绪时使用终端响铃'),
  minDuration: z.number().min(0).max(86400).default(10).description('完成通知的最短耗时，单位为秒'),
  events: z.object(Object.fromEntries(kinds.map(kind => [kind, z.boolean().default(true)]))).default({}).description('按事件类型启用通知'),
  native: z.union(['off', 'auto', 'manual'].map(v => z.const(v))).default('off').description('穿透系统通知：off 关闭；auto 自动探测；manual 使用 nativePath'),
  nativePath: z.string().default('').description('manual 模式下的解释器绝对路径'),
});
const labels = { complete: '任务完成', approval: '等待审批', question: '等待回答', block: '任务受阻', error: '任务出错' };

/** 宿主只管事件语义和输出策略。浏览器偏好不写入宿主配置。 */
export function apply(ctx, input = {}, output = {}) {
  const config = Config(input);
  const journal = createJournal();
  const write = output.write ?? (text => process.stdout.write(text));
  const warn = output.warn ?? (text => process.stderr.write(`${text}\n`));
  const isTTY = output.isTTY ?? (() => process.stdout.isTTY === true);
  const timers = new Set();
  // 原生通道探测一次并缓存；结果只用于日志与面板，失败不重试到每条通知。
  // 懒探测：默认 off 时绝不扫描 /mnt（WSL 上 statSync 可能耗时数秒）。
  // output.probe / output.notify 仅供测试注入，生产不传。
  const probeImpl = output.probe ?? nativeProbe;
  const sendImpl = output.notify ?? nativeNotify;
  const testImpl = output.test ?? nativeTest;
  let detectedCache;
  const detect = () => (detectedCache ??= probeImpl());
  // 运行时覆盖：面板改动立即生效；重启后回到 profile 配置的值。
  let nativeMode = config.native;
  let nativePath = config.nativePath;
  let lastNative = { ok: false, reason: nativeMode === 'off' ? '已关闭' : '' };
  let disposed = false;
  let warned = false;
  const warnSafely = message => {
    try { warn(message)?.catch?.(() => {}); } catch { /* 告警本身也不能影响 Agent。 */ }
  };
  const outputFailed = () => warnSafely('[state-notifier] 通知输出失败；Agent 继续运行。');
  const writeSafely = text => {
    try { write(text)?.catch?.(outputFailed); } catch { outputFailed(); }
  };
  const bell = kind => {
    if (!isTTY()) {
      if (!warned) { warned = true; warnSafely('[state-notifier] 终端不支持 BEL；通知仅记录到日志。请打开浏览器并启用通知。'); }
      return;
    }
    const count = kind === 'complete' ? 1 : kind === 'error' || kind === 'block' ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const timer = setTimeout(() => { timers.delete(timer); if (!disposed) writeSafely('\x07'); }, i * 150);
      timer.unref?.();
      timers.add(timer);
    }
  };
  const shortId = id => {
    const text = String(id ?? '').replace(/^session-/, '').trim();
    return (text || '未知会话').slice(0, 8);
  };
  const nativeText = notice => ({
    title: `DeepSeek：${labels[notice.kind]}`,
    body: [`会话 ${notice.sessionLabel || shortId(notice.sessionId)}`, notice.question]
      .filter(value => typeof value === 'string' && value).join('\n'),
  });
  const notifier = createNotifier({
    enabled: config.enabled, events: config.events, minDurationMs: config.minDuration * 1000,
    // sessionTitle 不是必需依赖：缺失或读取失败时浏览器回退到会话短标识。
    resolveLabel(session) {
      try { return ctx.get('sessionTitle')?.get?.(session)?.title; } catch { return undefined; }
    },
    onNotice(notice) {
      if (disposed) return;
      // 独立输出，日志失败不能阻断浏览器通知或终端提醒。
      writeSafely(`[state-notifier] ${labels[notice.kind]}\n`);
      let handled = false;
      if (nativeMode !== 'off') {
        const resolved = nativeResolve(nativeMode, nativePath, detect());
        if (resolved.ok) {
          handled = true;
          void sendImpl(resolved.path, nativeText(notice)).then(result => { lastNative = result; });
        } else {
          lastNative = { ok: false, reason: resolved.reason };
        }
      }
      // native 表示系统通知已交由宿主负责，浏览器只发声，避免同一条弹两次。
      try { journal.publish({ ...notice, native: handled }); } catch { outputFailed(); }
      try {
        if (config.playback === 'terminal' || (config.playback === 'auto' && !journal.hasBrowser())) bell(notice.kind);
      } catch { outputFailed(); }
    },
  });
  ctx.on('session/event', (session, event) => notifier.sessionEvent(session, event));
  ctx.on('goal/changed', payload => notifier.goalChanged(payload));
  ctx.on('agent/error', payload => notifier.agentError(payload));
  ctx.on('session/disposed', session => notifier.disposeSession(session));
  // rc.2 与 master 的 connection.rpc.handle 都用调用方 Context 读 webServer 注册前缀路由。
  // 该读取沿 shadow 起点回溯，晚加载的插件必然拿不到 webServer；改用官方受认证的精确 Fetch 路由。
  const route = {
    path: '/api/state-notifier',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;
      try { body = await request.json(); } catch { return new Response('body is not JSON', { status: 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.type !== 'client-request'
        || typeof body.rpcId !== 'string' || body.method !== 'state-notifier') {
        return new Response('invalid client-request', { status: 400 });
      }
      if (body.payload?.action === 'probe') {
        const mode = nativeMode;
        const manual = mode === 'manual' ? nativeResolve('manual', nativePath, detect()) : null;
        return Response.json({
          type: 'server-response', rpcId: body.rpcId,
          result: { ok: true, value: { ...detect(), mode, manual, lastNative, resolved: nativeResolve(mode, nativePath, detect()) } },
        });
      }
      if (body.payload?.action === 'testNative') {
        const resolved = nativeResolve(nativeMode === 'off' ? 'auto' : nativeMode, nativePath, detect());
        if (!resolved.ok) {
          return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { ok: false, reason: resolved.reason } } });
        }
        const outcome = await testImpl(resolved.path, {
          title: 'dsh 通道测试',
          body: '这是来自任务状态提醒的测试通知；看到它说明原生通道可用。',
        });
        return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { ...outcome, path: resolved.path } } });
      }
      if (body.payload?.action === 'setNative') {
        const { mode, path } = body.payload;
        if (!['off', 'auto', 'manual'].includes(mode)) {
          return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'bad-request', message: '无效的穿透模式', details: {} } } });
        }
        nativeMode = mode;
        nativePath = typeof path === 'string' ? path : nativePath;
        lastNative = { ok: false, reason: mode === 'off' ? '已关闭' : '' };
        return Response.json({
          type: 'server-response', rpcId: body.rpcId,
          result: { ok: true, value: { mode, path: nativePath, resolved: nativeResolve(mode, nativePath, detect()), detected: detect() } },
        });
      }
      let result;
      try {
        result = { ok: true, value: { ...await journal.poll(body.payload, request.signal), playback: config.playback, nativeMode } };
      } catch (error) {
        result = { ok: false, error: { code: error instanceof TypeError ? 'bad-request' : 'unavailable', message: '通知订阅暂不可用', details: {} } };
      }
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result });
    },
  };
  ctx.inject(['connection'], web => {
    web.effect(() => web.connection.fetch.register(route), 'state-notifier: 受认证的通知订阅');
  });
  ctx.effect(() => () => {
    disposed = true;
    notifier.dispose();
    journal.dispose();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }, 'state-notifier: 释放通知资源');
}

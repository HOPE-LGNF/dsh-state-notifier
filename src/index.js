import z from '@deepseek-ai/schemastery';
import { createNotifier } from './core.js';
import { createJournal } from './journal.js';

export const name = 'state-notifier';
export const inject = [];
const kinds = ['complete', 'approval', 'question', 'block', 'error'];
export const Config = z.object({
  enabled: z.boolean().default(true).description('启用通知'),
  playback: z.union(['auto', 'browser', 'terminal', 'none'].map(v => z.const(v))).default('auto').description('auto 在浏览器未就绪时使用终端响铃'),
  minDuration: z.number().min(0).max(86400).default(10).description('完成通知的最短耗时，单位为秒'),
  events: z.object(Object.fromEntries(kinds.map(kind => [kind, z.boolean().default(true)]))).default({}).description('按事件类型启用通知'),
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
  const notifier = createNotifier({
    enabled: config.enabled, events: config.events, minDurationMs: config.minDuration * 1000,
    onNotice(notice) {
      if (disposed) return;
      // 独立输出，日志失败不能阻断浏览器通知或终端提醒。
      writeSafely(`[state-notifier] ${labels[notice.kind]}\n`);
      try { journal.publish(notice); } catch { outputFailed(); }
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
      let result;
      try {
        result = { ok: true, value: { ...await journal.poll(body.payload, request.signal), playback: config.playback } };
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

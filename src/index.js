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
  const bell = kind => {
    if (!isTTY()) {
      if (!warned) { warned = true; warn('[state-notifier] 终端不支持 BEL；通知仅记录到日志。请打开浏览器并启用通知。'); }
      return;
    }
    const count = kind === 'complete' ? 1 : kind === 'error' || kind === 'block' ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const timer = setTimeout(() => { timers.delete(timer); if (!disposed) write('\x07'); }, i * 150);
      timer.unref?.();
      timers.add(timer);
    }
  };
  const notifier = createNotifier({
    enabled: config.enabled, events: config.events, minDurationMs: config.minDuration * 1000,
    onNotice(notice) {
      if (disposed) return;
      // 不让声音、日志或传输失败改变 Agent 的执行结果。
      try {
        write(`[state-notifier] ${labels[notice.kind]}\n`);
        journal.publish(notice);
        if (config.playback === 'terminal' || (config.playback === 'auto' && !journal.hasBrowser())) bell(notice.kind);
      } catch { warn('[state-notifier] 通知输出失败；Agent 继续运行。'); }
    },
  });
  ctx.on('session/event', (session, event) => notifier.sessionEvent(session, event));
  ctx.on('goal/changed', payload => notifier.goalChanged(payload));
  ctx.on('agent/error', payload => notifier.agentError(payload));
  ctx.on('session/disposed', session => notifier.disposeSession(session));
  ctx.inject(['connection'], web => {
    web.effect(() => web.connection.rpc.handle('/state-notifier', async (endpoint, payload, signal) => {
      if (endpoint !== 'poll') return { ok: false, error: { code: 'not-found', message: '未知通知操作', details: {} } };
      try {
        return { ok: true, value: { ...await journal.poll(payload, signal), playback: config.playback } };
      } catch (error) {
        return { ok: false, error: { code: error instanceof TypeError ? 'bad-request' : 'unavailable', message: '通知订阅暂不可用', details: {} } };
      }
    }), 'state-notifier: 受认证的通知订阅');
  });
  ctx.effect(() => () => {
    disposed = true;
    notifier.dispose();
    journal.dispose();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }, 'state-notifier: 释放通知资源');
}

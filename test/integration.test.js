import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { apply } from '../src/index.js';

// 同一组夹具分别使用 npm 发布包和指定的 master Session 源码。
const sessionModule = process.env.DSH_SESSION_SOURCE
  ? pathToFileURL(process.env.DSH_SESSION_SOURCE).href
  : '@deepseek-ai/dsh-session';
const { SessionStore } = await import(sessionModule);

const labels = {
  complete: '任务完成', approval: '等待审批', question: '等待回答',
  block: '任务受阻', error: '任务出错',
};

async function boot(config = {}) {
  const root = new Context();
  const writes = [];
  const warnings = [];
  const plugin = {
    name: 'state-notifier-integration',
    apply(ctx) {
      apply(ctx, { playback: 'none', minDuration: 0, ...config }, {
        write: value => writes.push(String(value)),
        warn: value => warnings.push(String(value)),
        isTTY: () => false,
      });
    },
  };
  await root.plugin(SessionStore);
  let fiber = root.plugin(plugin);
  await fiber;
  assert.ok(root.sessions instanceof SessionStore, '真实 SessionStore 必须挂载成功');
  return {
    root, writes, warnings,
    session(id, meta = {}) { return root.sessions.create(id, { meta }); },
    count(kind) { return writes.filter(line => line === `[state-notifier] ${labels[kind]}\n`).length; },
    async unload() { await fiber.dispose(); },
    async reload() { fiber = root.plugin(plugin); await fiber; },
    async stop() { await root.fiber.dispose(); },
  };
}

function userMessage(session, id) {
  return session.append('user/message', {
    id, role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '请检查此任务' }],
  }, { surfaceOp: 'append' });
}

function assistantMessage(session, turn, content = [{ type: 'text', text: '任务已完成' }], extra = {}) {
  return session.append('assistant/message', {
    turn, step: 1, stream: [],
    message: {
      id: `assistant-${session.id}-${turn}`, role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content,
    },
    ...extra,
  }, { surfaceOp: 'append' });
}

function completedTurn(session, turn) {
  session.append('turn/start', { turn });
  userMessage(session, `user-${session.id}-${turn}`);
  assistantMessage(session, turn);
  const end = session.append('turn/end', { turn, reason: { kind: 'completed' } });
  assert.equal(session.snapshotEvents().at(-1).seq, end.seq, '事件必须真实进入会话日志');
  return end;
}

test('真实 Session 与 Cordis：五类通知生效，审批决定和非提问工具不通知', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const session = h.session('five-kinds');
  completedTurn(session, 1);
  assert.equal(h.count('complete'), 1, '正向通知证明观察器已工作');

  session.append('turn/start', { turn: 2 });
  const approval = session.append('approval/asked', {
    id: 'approval-1', toolName: 'shell', callId: 'call-shell', reason: '需要批准',
  });
  assert.equal(session.snapshotEvents().at(-1).seq, approval.seq);
  assert.equal(h.count('approval'), 1);
  h.root.emit('session/event', session, approval);
  assert.equal(h.count('approval'), 1, '同一审批请求的重复派发必须被抑制');
  session.append('approval/decided', { id: 'approval-1', outcome: 'allowed-once' });
  assert.equal(h.count('approval'), 1);

  const question = session.append('tool/call', {
    turn: 2, step: 1, callId: 'question-1', name: 'ask_user_question',
    arguments: JSON.stringify({ questions: [{ id: 'next', question: '是否继续？', options: [{ label: '继续' }] }] }),
  });
  assert.equal(h.count('question'), 1);
  h.root.emit('session/event', session, question);
  assert.equal(h.count('question'), 1, '同一提问调用的重复派发必须被抑制');
  session.append('tool/call', { turn: 2, step: 1, callId: 'ordinary-call', name: 'shell', arguments: '{}' });
  assert.equal(h.count('question'), 1);

  const agent = { id: session.id, session };
  const blocked = {
    agent, change: { operation: 'block', ref: { id: 'goal-1', revision: 2 }, goal: { id: 'goal-1', objective: '等待输入', createdAt: 1 } },
  };
  h.root.emit('goal/changed', blocked);
  h.root.emit('goal/changed', blocked);
  assert.equal(h.count('block'), 1);
  const failure = { agent, turn: 2, step: 1, error: new Error('fixture failure') };
  h.root.emit('agent/error', failure);
  h.root.emit('agent/error', failure);
  assert.equal(h.count('error'), 1);
  assert.equal(h.writes.length, 5, '每个事件只产生一条语义日志');
  assert.deepEqual(h.warnings, []);
});

test('真实 Session：空回合与子代理完成静默，同一夹具先通过正向控制', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const main = h.session('main-control');
  completedTurn(main, 1);
  assert.equal(h.count('complete'), 1);

  main.append('turn/start', { turn: 2 });
  main.append('turn/end', { turn: 2, reason: { kind: 'completed' } });
  assert.equal(main.snapshotEvents().at(-1).data.turn, 2);
  assert.equal(h.count('complete'), 1, '没有最终回答的回合不能通知');

  const child = h.session('child-control', { origin: 'subagent', delegationDepth: 1 });
  completedTurn(child, 1);
  assert.equal(child.header.delegationDepth, 1);
  assert.ok(child.snapshotEvents().some(event => event.type === 'assistant/message'));
  assert.equal(h.count('complete'), 1, '子代理事件确实提交，但不触发完成通知');
});

test('真实 Session：取消、工具调用回合和中断回答不能误报完成', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const session = h.session('negative-completion');
  completedTurn(session, 1);
  assert.equal(h.count('complete'), 1);

  session.append('turn/start', { turn: 2 });
  assistantMessage(session, 2);
  session.append('turn/end', { turn: 2, reason: { kind: 'cancelled', cause: { kind: 'user' } } });
  assert.equal(h.count('complete'), 1);

  session.append('turn/start', { turn: 3 });
  assistantMessage(session, 3, [{ type: 'tool-call', id: 'finish-3', name: 'finish_tool', arguments: '{}' }]);
  session.append('tool/call', { turn: 3, step: 1, callId: 'finish-3', name: 'finish_tool', arguments: '{}' });
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } });
  assert.equal(h.count('complete'), 1);

  session.append('turn/start', { turn: 4 });
  assistantMessage(session, 4, [{ type: 'text', text: '尚未完成' }], { interrupted: true });
  session.append('turn/end', { turn: 4, reason: { kind: 'completed' } });
  assert.equal(h.count('complete'), 1);
  assert.equal(session.snapshotEvents().filter(event => event.type === 'turn/end').length, 4);
});

test('真实 Session：最终文本之后再次调用工具时不通知，后续正常回合仍能通知', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const session = h.session('text-before-tool');
  completedTurn(session, 1);
  session.append('turn/start', { turn: 2 });
  assistantMessage(session, 2);
  session.append('tool/call', { turn: 2, step: 1, callId: 'later-tool', name: 'shell', arguments: '{}' });
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } });
  assert.equal(h.count('complete'), 1);
  completedTurn(session, 3);
  assert.equal(h.count('complete'), 2, '拒绝的回合不能阻断后续通知');
});

test('真实 Cordis：重复派发只通知一次，卸载与重载释放观察器', async t => {
  const h = await boot();
  t.after(() => h.stop());
  const session = h.session('reload-control');
  const end = completedTurn(session, 1);
  assert.equal(h.count('complete'), 1);
  h.root.emit('session/event', session, end);
  assert.equal(h.count('complete'), 1, '同一已提交事件不能重复通知');

  await h.unload();
  completedTurn(session, 2);
  assert.equal(h.count('complete'), 1, '卸载后不得继续观察真实 Session');
  await h.reload();
  assert.equal(h.count('complete'), 1, '重载不得自动播放已有历史');
  completedTurn(session, 3);
  assert.equal(h.count('complete'), 2, '重载后只能有一个活动观察器');
  assert.deepEqual(h.warnings, []);
});

test('真实 Session：完成阈值不抑制审批和提问，单事件开关可分别关闭', async t => {
  const h = await boot({ minDuration: 60, events: { error: false } });
  t.after(() => h.stop());
  const session = h.session('duration-control');
  completedTurn(session, 1);
  assert.equal(h.count('complete'), 0, '短回合不得产生完成提醒');
  session.append('turn/start', { turn: 2 });
  session.append('approval/asked', { id: 'urgent-approval', toolName: 'shell' });
  session.append('tool/call', {
    turn: 2, step: 1, callId: 'urgent-question', name: 'ask_user_question', arguments: '{}',
  });
  assert.equal(h.count('approval'), 1, '审批是此夹具的正向控制');
  assert.equal(h.count('question'), 1, '提问不受完成耗时阈值影响');
  h.root.emit('agent/error', { agent: { id: session.id, session }, turn: 2, step: 1, error: new Error('disabled error') });
  assert.equal(h.count('error'), 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_LIMIT, createNotifier, LABEL_LIMIT, NOTICE_KINDS, STATE_LIMITS } from '../src/core.js';

const mainSession = (id = 'main', header = {}) => ({ id, header });
const text = value => ({ type: 'text', text: value });
const tool = (name = 'bash', id = 'call') => ({ type: 'tool-call', id, name, arguments: '{}' });

function harness(options = {}) {
  const notices = [];
  const sequences = new Map();
  const notifier = createNotifier({ now: () => 50_000, onNotice: notice => notices.push(notice), ...options });
  const send = (session, type, data, time = 1000, extras = {}) => {
    const seq = sequences.get(session.id) ?? 0;
    sequences.set(session.id, seq + 1);
    return notifier.sessionEvent(session, { type, data, time, seq, ...extras });
  };
  const assistant = (session, turn, content = [text('完成')], time = 11_000, extras = {}) => send(session,
    'assistant/message', { turn, step: 1, message: { role: 'assistant', content }, stream: [], ...extras }, time);
  const complete = (session, turn = 1, start = 1000, end = 11_000) => {
    send(session, 'turn/start', { turn }, start);
    assistant(session, turn);
    return send(session, 'turn/end', { turn, reason: { kind: 'completed' } }, end);
  };
  return { notices, notifier, send, assistant, complete };
}

test('最终非空文本在门槛时间触发一次完成，返回与回调载荷一致且无正文', () => {
  const h = harness();
  const session = mainSession();
  const notice = h.complete(session);
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0], notice);
  assert.deepEqual(notice, {
    id: JSON.stringify(['complete', 'main', 1]), kind: 'complete', sessionId: 'main',
    turn: 1, time: 11_000, durationMs: 10_000,
  });
  assert.equal(h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 12_000), null);
  assert.equal(h.notices.length, 1);
});

test('complete 的耗时过滤不延伸到审批、提问、受阻与错误', () => {
  const h = harness({ minDurationMs: 100_000 });
  const session = mainSession();
  assert.equal(h.complete(session), null);
  h.send(session, 'turn/start', { turn: 2 });
  h.send(session, 'approval/asked', { id: 'approval', toolName: 'bash', reason: '秘密理由' });
  h.send(session, 'tool/call', { turn: 2, step: 1, callId: 'question', name: 'ask_user_question', arguments: '{坏JSON' });
  const agent = { id: session.id, session };
  h.notifier.goalChanged({ agent, change: { operation: 'block', ref: { id: 'goal', revision: 3 },
    goal: { objective: '秘密目标', updatedAt: 3000 } } });
  h.notifier.agentError({ agent, turn: 2, step: 1, error: new Error('秘密错误') });
  assert.deepEqual(h.notices.map(notice => notice.kind), ['approval', 'question', 'block', 'error']);
  for (const notice of h.notices) {
    assert.equal(notice.turn, 2);
    assert.equal('durationMs' in notice, false);
    assert.deepEqual(Object.keys(notice).sort(), ['id', 'kind', 'sessionId', 'time', 'turn']);
  }
  assert.equal(h.notices[2].time, 3000);
  assert.equal(h.notices[3].time, 50_000);
  assert.equal(JSON.stringify(h.notices).includes('秘密'), false);
});

test('自动 goal 轮次与真实用户轮次使用相同最终回答标准', () => {
  const h = harness();
  const session = mainSession();
  h.send(session, 'turn/start', { turn: 1 });
  h.send(session, 'user/message', { role: 'user', source: { kind: 'goal', goalId: 'goal', revision: 1, round: 1 },
    content: [text('自动继续的目标正文')] });
  h.assistant(session, 1);
  h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000);
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].kind, 'complete');
});

test('取消、出错、拒绝、空轮次与工具收尾不误报完成', async t => {
  const cases = [
    ['空 claim no-op', null, { kind: 'completed' }],
    ['仅工具调用', [tool()], { kind: 'completed' }],
    ['文本与工具混合', [text('先处理'), tool()], { kind: 'completed' }],
    ['空白文本', [text(' \n\t ')], { kind: 'completed' }],
    ['只有推理', [{ type: 'reasoning', text: '推理正文' }], { kind: 'completed' }],
    ...['aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked', 'unknown'].map(kind =>
      [kind, [text('部分回答')], { kind }]),
  ];
  for (const [label, content, reason] of cases) await t.test(label, () => {
    const h = harness();
    const session = mainSession();
    // 正面断言保证静默用例实际走过有效的通知逻辑。
    assert.equal(h.complete(session)?.kind, 'complete');
    h.send(session, 'turn/start', { turn: 2 });
    if (content !== null) h.assistant(session, 2, content);
    h.send(session, 'turn/end', { turn: 2, reason }, 12_000);
    assert.equal(h.notices.length, 1);
  });
});

test('只有最后一条完整 assistant 文本且之后没有 tool/call 才算完成', async t => {
  for (const action of ['tool-after-text', 'blank-after-text', 'mixed-after-text', 'interrupted-text']) {
    await t.test(action, () => {
      const h = harness();
      const session = mainSession();
      h.complete(session);
      h.send(session, 'turn/start', { turn: 2 });
      h.assistant(session, 2);
      if (action === 'tool-after-text') h.send(session, 'tool/call', { turn: 2, callId: 'run', name: 'bash' });
      if (action === 'blank-after-text') h.assistant(session, 2, [text(' ')]);
      if (action === 'mixed-after-text') h.assistant(session, 2, [text('后续'), tool()]);
      if (action === 'interrupted-text') h.assistant(session, 2, [text('中断前缀')], 5000, { interrupted: true });
      h.send(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, 12_000);
      assert.equal(h.notices.length, 1);
    });
  }
  await t.test('工具之后出现最终文本可以完成', () => {
    const h = harness();
    const session = mainSession();
    h.send(session, 'turn/start', { turn: 1 });
    h.assistant(session, 1, [text('处理中'), tool()]);
    h.send(session, 'tool/call', { turn: 1, step: 1, callId: 'run', name: 'bash' });
    h.send(session, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', content: [text('结果')] } });
    h.assistant(session, 1);
    assert.equal(h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000)?.kind, 'complete');
  });
});

test('耗时未知、倒退或非有限值不报完成；零门槛仍要求真实起止时间', async t => {
  const cases = [[null, 11_000], [NaN, 11_000], [-1, 11_000], [1000, Infinity], [1000, 999], [undefined, 11_000]];
  for (const [start, end] of cases) await t.test(`${String(start)} -> ${String(end)}`, () => {
    const h = harness({ minDurationMs: 0 });
    const session = mainSession();
    assert.equal(h.complete(session, 1, 1000, 1000)?.durationMs, 0);
    if (start !== undefined) h.send(session, 'turn/start', { turn: 2 }, start);
    h.assistant(session, 2);
    h.send(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, end);
    assert.equal(h.notices.length, 1);
  });
  const short = harness();
  assert.equal(short.complete(mainSession(), 1, 1000, 10_999), null);
});

test('重复 turn/start 保留首个起点，旧 turn 不污染当前轮次', () => {
  const h = harness();
  const session = mainSession();
  h.send(session, 'turn/start', { turn: 1 }, 1000);
  h.assistant(session, 1);
  h.send(session, 'turn/start', { turn: 1 }, 8000);
  assert.equal(h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000)?.durationMs, 10_000);
  h.send(session, 'turn/start', { turn: 3 });
  h.assistant(session, 3);
  h.assistant(session, 2, [tool()]);
  h.send(session, 'tool/call', { turn: 1, callId: 'old', name: 'ask_user_question' });
  h.send(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, 11_000);
  assert.equal(h.send(session, 'turn/end', { turn: 3, reason: { kind: 'completed' } }, 11_000)?.turn, 3);
  assert.deepEqual(h.notices.map(notice => notice.turn), [1, 3]);
});

test('seq 优先于接收顺序，旧消息和重复事件不能撤销或伪造最终回答', () => {
  const h = harness();
  const session = mainSession();
  const event = (seq, type, data, time = 1000) => h.notifier.sessionEvent(session, { seq, type, data, time });
  event(10, 'turn/start', { turn: 1 });
  event(30, 'assistant/message', { turn: 1, message: { content: [text('最终')] } });
  event(20, 'tool/call', { turn: 1, name: 'ask_user_question', callId: 'earlier' });
  event(25, 'assistant/message', { turn: 1, message: { content: [text(' ')] } });
  assert.equal(event(40, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000)?.kind, 'complete');
  event(50, 'turn/start', { turn: 2 });
  event(70, 'tool/call', { turn: 2, name: 'bash', callId: 'later' });
  event(60, 'assistant/message', { turn: 2, message: { content: [text('早先文本')] } });
  event(80, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, 11_000);
  assert.equal(h.notices.length, 1);
  event(80, 'approval/asked', { id: 'same-seq', toolName: 'bash' });
  assert.equal(h.notices.length, 1);
});

test('没有 seq 的输入按接收顺序判定，完整重放仍只报一次', () => {
  const h = harness();
  const session = mainSession();
  const sequence = [
    { type: 'turn/start', data: { turn: 1 }, time: 1000 },
    { type: 'assistant/message', data: { turn: 1, message: { content: [text('最终')] } }, time: 9000 },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: 11_000 },
  ];
  for (let repeat = 0; repeat < 2; repeat++) for (const event of sequence) h.notifier.sessionEvent(session, event);
  assert.equal(h.notices.length, 1);
});

test('会话间轮次独立；恢复会话的 firstLiveSeq 之前属于历史而不通知', () => {
  const h = harness();
  const one = mainSession('one');
  const two = mainSession('two');
  h.send(one, 'turn/start', { turn: 1 });
  h.send(two, 'turn/start', { turn: 1 }, 2000);
  h.assistant(one, 1);
  h.assistant(two, 1);
  h.send(one, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000);
  h.send(two, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 12_000);
  assert.deepEqual(h.notices.map(notice => notice.sessionId), ['one', 'two']);
  const restored = { ...mainSession('restored'), firstLiveSeq: 100 };
  h.complete(restored);
  h.send(restored, 'approval/asked', { id: 'historical', toolName: 'bash' }, 1000, { seq: 99 });
  assert.equal(h.notices.length, 2);
  h.send(restored, 'turn/start', { turn: 2 }, 1000, { seq: 100 });
  h.send(restored, 'assistant/message', { turn: 2, message: { content: [text('现在')] } }, 9000, { seq: 101 });
  assert.equal(h.send(restored, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, 11_000, { seq: 102 })?.kind, 'complete');
});

test('子代理与异常深度对五类通知均静默，不依赖第一条用户消息', async t => {
  const headers = [
    { delegationDepth: 1 }, { delegationDepth: 2 }, { origin: 'subagent' },
    { delegationDepth: 0, origin: 'subagent' }, ...[null, '0', -1, 0.5, NaN, Infinity].map(delegationDepth => ({ delegationDepth })),
  ];
  for (const header of headers) await t.test(JSON.stringify(header), () => {
    const h = harness();
    assert.equal(h.complete(mainSession('positive'))?.kind, 'complete');
    const session = mainSession('child', header);
    h.complete(session);
    h.send(session, 'approval/asked', { id: 'approval', toolName: 'bash' });
    h.send(session, 'tool/call', { turn: 2, callId: 'question', name: 'ask_user_question' });
    const agent = { id: session.id, session };
    h.notifier.goalChanged({ agent, change: { operation: 'block', ref: { id: 'goal', revision: 2 } } });
    h.notifier.agentError({ agent, turn: 1, step: 1, error: '失败' });
    assert.equal(h.notices.length, 1);
  });
  const h = harness();
  assert.equal(h.complete(mainSession('live'))?.kind, 'complete');
  assert.equal(h.complete(mainSession('stored', { delegationDepth: 0 }))?.kind, 'complete');
});

test('审批/提问/goal revision/错误边界稳定去重，答复和普通 goal 操作不通知', () => {
  const h = harness();
  const session = mainSession();
  const agent = { id: session.id, session };
  for (let repeat = 0; repeat < 2; repeat++) {
    h.send(session, 'approval/asked', { id: 'approval', toolName: 'bash' });
    h.send(session, 'approval/decided', { id: 'approval', outcome: 'allowed-once' });
    h.send(session, 'tool/call', { turn: 1, callId: 'question', name: 'ask_user_question' });
    h.send(session, 'tool/result', { turn: 1, message: { content: [text('回答')] } });
    h.notifier.goalChanged({ agent, change: { operation: 'block', ref: { id: 'goal', revision: 2 } } });
    h.notifier.agentError({ agent, turn: 1, step: 1, error: new Error('失败') });
  }
  for (const operation of ['create', 'edit', 'pause', 'resume', 'clear', 'complete']) {
    h.notifier.goalChanged({ agent, change: { operation, ref: { id: 'goal', revision: 3 } } });
  }
  assert.deepEqual(h.notices.map(notice => notice.kind), ['approval', 'question', 'block', 'error']);
  h.notifier.goalChanged({ agent, change: { operation: 'block', ref: { id: 'goal', revision: 4 } } });
  h.notifier.agentError({ agent, turn: 1, step: 2, error: '新错误' });
  assert.deepEqual(h.notices.slice(4).map(notice => notice.kind), ['block', 'error']);
});

test('agent/error 阻止同轮次随后 completed 误报，运行前错误不虚构轮次', () => {
  const h = harness();
  const session = mainSession();
  const agent = { id: session.id, session };
  h.notifier.agentError({ agent, turn: 0, step: 0, error: '启动错误' });
  assert.equal('turn' in h.notices[0], false);
  h.send(session, 'turn/start', { turn: 1 });
  h.assistant(session, 1);
  h.notifier.agentError({ agent, turn: 1, step: 1, error: '执行错误' });
  h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000);
  assert.deepEqual(h.notices.map(notice => notice.kind), ['error', 'error']);
  assert.equal(h.complete(session, 2)?.kind, 'complete');
});

test('异常事件不抛错、不用 unknown 标识合并多个事件，也不能伪造完成', () => {
  const h = harness();
  const session = mainSession();
  const agent = { id: session.id, session };
  const inputs = [null, undefined, [], {}, { type: 'turn/start' }, { type: 'turn/start', data: null },
    ...[0, -1, 1.5, Infinity, '1', Number.MAX_SAFE_INTEGER + 1].map(turn => ({ type: 'turn/start', data: { turn }, time: 1000 })),
    ...[-1, -0, NaN, Infinity, '2'].map(seq => ({ type: 'approval/asked', data: { id: 'bad-seq' }, seq })),
    { type: 'approval/asked', data: {} }, { type: 'approval/asked', data: { id: '' } },
    { type: 'tool/call', data: { turn: 1, name: 'ask_user_question' } },
    { type: 'turn/end', data: { turn: 1 } },
  ];
  for (const event of inputs) assert.doesNotThrow(() => h.notifier.sessionEvent(session, event));
  for (const payload of [null, {}, { agent }, { agent, turn: 1, step: -1, error: 'bad' },
    { agent: { id: 'other', session }, turn: 1, step: 1, error: 'bad' }]) {
    assert.doesNotThrow(() => h.notifier.agentError(payload));
  }
  for (const ref of [undefined, { id: '', revision: 1 }, { id: 'goal', revision: 0 }, { id: 'goal', revision: '1' }]) {
    assert.doesNotThrow(() => h.notifier.goalChanged({ agent, change: { operation: 'block', ref } }));
  }
  assert.equal(h.notices.length, 0);
  assert.equal(h.complete(session, 2)?.kind, 'complete');
});

test('标识中的分隔符不导致稳定通知 ID 碰撞', () => {
  const h = harness();
  h.send(mainSession('a:b'), 'approval/asked', { id: 'c', toolName: 'bash' });
  h.send(mainSession('a'), 'approval/asked', { id: 'b:c', toolName: 'bash' });
  assert.equal(h.notices.length, 2);
  assert.notEqual(h.notices[0].id, h.notices[1].id);
  const another = harness();
  another.send(mainSession('a:b'), 'approval/asked', { id: 'c', toolName: 'bash' });
  assert.equal(h.notices[0].id, another.notices[0].id);
});

test('关闭全局或单类通知生效，未声明的类别保持默认开启', () => {
  const muted = harness({ enabled: false });
  const session = mainSession();
  muted.complete(session);
  muted.send(session, 'approval/asked', { id: 'approval', toolName: 'bash' });
  muted.notifier.goalChanged({ agent: { id: session.id, session }, change: { operation: 'block', ref: { id: 'goal', revision: 1 } } });
  muted.notifier.agentError({ agent: { id: session.id, session }, turn: 1, step: 1, error: '错误' });
  assert.equal(muted.notices.length, 0);
  for (const events of [{ complete: false, approval: { enabled: false } }, { complete: { enabled: false }, approval: false }]) {
    const h = harness({ events });
    h.complete(session);
    h.send(session, 'approval/asked', { id: 'approval', toolName: 'bash' });
    h.send(session, 'tool/call', { turn: 2, callId: 'question', name: 'ask_user_question' });
    assert.deepEqual(h.notices.map(notice => notice.kind), ['question']);
  }
  assert.deepEqual(NOTICE_KINDS, ['complete', 'approval', 'question', 'block', 'error']);
});

test('session/disposed 清理状态并拒绝同对象迟到事件，重新恢复的对象可继续运行', () => {
  const h = harness();
  const session = mainSession();
  h.send(session, 'turn/start', { turn: 1 });
  h.assistant(session, 1);
  h.send(session, 'approval/asked', { id: 'approval', toolName: 'bash' });
  h.notifier.disposeSession(session);
  h.notifier.disposeSession(session);
  h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000);
  h.send(session, 'approval/asked', { id: 'late', toolName: 'bash' });
  h.notifier.agentError({ agent: { id: session.id, session }, turn: 1, step: 1, error: '迟到' });
  assert.equal(h.notices.length, 1);
  const resumed = mainSession();
  h.send(resumed, 'approval/asked', { id: 'approval', toolName: 'bash' });
  assert.equal(h.notices.length, 2);
  assert.equal(h.complete(resumed)?.kind, 'complete');
  h.notifier.dispose();
  h.notifier.dispose();
  h.complete(mainSession('new'));
  h.notifier.goalChanged({ agent: { id: resumed.id, session: resumed }, change: { operation: 'block', ref: { id: 'goal', revision: 1 } } });
  assert.equal(h.notices.length, 3);
});

test('会话状态有固定上限；淘汰后未知耗时不误报，最近会话仍可完成', () => {
  const h = harness();
  const owners = Array.from({ length: STATE_LIMITS.sessions + 1 }, (_, index) => mainSession(`session-${index}`));
  for (const session of owners) {
    h.send(session, 'turn/start', { turn: 1 });
    h.assistant(session, 1);
  }
  const last = owners.at(-1);
  assert.equal(h.send(last, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000)?.kind, 'complete');
  const first = owners[0];
  h.assistant(first, 1);
  assert.equal(h.send(first, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 11_000), null);
  assert.equal(h.notices.length, 1);
});

test('通知去重缓存有固定上限，最近 ID 去重而已淘汰的 ID 可以再次通知', () => {
  const h = harness();
  const session = mainSession();
  for (let index = 0; index <= STATE_LIMITS.notices; index++) {
    h.send(session, 'approval/asked', { id: `approval-${index}`, toolName: 'bash' });
  }
  assert.equal(h.notices.length, STATE_LIMITS.notices + 1);
  assert.equal(h.send(session, 'approval/asked', { id: `approval-${STATE_LIMITS.notices}`, toolName: 'bash' }), null);
  assert.equal(h.send(session, 'approval/asked', { id: 'approval-0', toolName: 'bash' })?.kind, 'approval');
});

test('输出同步/异步失败已隔离，并在失败后仍消费重复事件', async () => {
  for (const onNotice of [() => { throw new Error('输出失败'); }, async () => { throw new Error('异步输出失败'); }]) {
    const h = harness({ onNotice });
    const session = mainSession();
    assert.doesNotThrow(() => assert.equal(h.complete(session)?.kind, 'complete'));
    assert.equal(h.send(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 12_000), null);
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('宿主提供的会话名进入通知，缺失或异常时不写入字段', () => {
  const titled = harness({ resolveLabel: () => '修复登录超时' });
  const named = titled.complete(mainSession());
  assert.equal(named.sessionLabel, '修复登录超时');

  const blank = harness({ resolveLabel: () => '   ' });
  assert.equal('sessionLabel' in blank.complete(mainSession()), false, '空名字不得进入载荷');

  const broken = harness({ resolveLabel: () => { throw new Error('标题服务异常'); } });
  assert.equal(broken.complete(mainSession())?.kind, 'complete', '解析失败不能影响通知');
  assert.equal('sessionLabel' in broken.notices[0], false);

  const noisy = harness({ resolveLabel: () => `  第一行\u0000\u001b[31m  ${'x'.repeat(200)}  ` });
  const label = noisy.complete(mainSession()).sessionLabel;
  assert.equal(label.startsWith('第一行'), true);
  assert.equal(label.includes('\u0000'), false);
  assert.equal(label.length <= LABEL_LIMIT, true);
});

test('提问通知带出问题正文，解析失败或非提问工具时不留字段', () => {
  const h = harness();
  const session = mainSession();
  const args = JSON.stringify({ questions: [
    { id: 'q1', header: '数据库', question: '选 MySQL 还是 Postgres？' },
    { id: 'q2', question: '要不要顺便加索引？' },
  ] });
  h.send(session, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'ask_user_question', arguments: args });
  assert.equal(h.notices[0].kind, 'question');
  assert.equal(h.notices[0].question, '数据库：选 MySQL 还是 Postgres？\n要不要顺便加索引？');

  const broken = harness();
  broken.send(mainSession(), 'tool/call', { turn: 1, step: 1, callId: 'call-2', name: 'ask_user_question', arguments: '{不是 JSON' });
  assert.equal(broken.notices[0].kind, 'question');
  assert.equal('question' in broken.notices[0], false, '解析失败不能写入正文');

  const other = harness();
  other.send(mainSession(), 'tool/call', { turn: 1, step: 1, callId: 'call-3', name: 'bash', arguments: '{"command":"ls"}' });
  assert.equal(other.notices.length, 0, '非提问工具不通知');
});

test('提问正文被压成有界文本：控制字符清理、长度截断、问题数量受限', () => {
  const h = harness();
  const long = 'x'.repeat(500);
  const questions = [1, 2, 3, 4, 5].map(index => ({ id: `q${index}`, question: index === 1 ? `第一行\u0000\u001b[31m${long}` : `问题${index}` }));
  h.send(mainSession(), 'tool/call', { turn: 1, step: 1, callId: 'call-long', name: 'ask_user_question', arguments: JSON.stringify({ questions }) });
  const text = h.notices[0].question;
  assert.equal(text.length <= CONTENT_LIMIT, true);
  assert.equal(text.includes('\u0000'), false);
  assert.equal(text.startsWith('第一行'), true);
  assert.equal(text.includes('问题4'), false, '只带出前几道问题');
});

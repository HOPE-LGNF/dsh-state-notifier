/** 通知判定只保留状态与标识，不保存提示词、问题、审批理由或错误正文。 */
export const NOTICE_KINDS = Object.freeze(['complete', 'approval', 'question', 'block', 'error']);
export const STATE_LIMITS = Object.freeze({ sessions: 256, notices: 1024 });

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && value.trim().length > 0;
const isIndex = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const isTurn = value => isIndex(value) && value > 0;
const isTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isMainSession(session) {
  if (!isRecord(session) || !isId(session.id)) return false;
  if (session.header !== undefined && !isRecord(session.header)) return false;
  const header = session.header;
  // 活的主会话可以没有 delegationDepth；异常深度不当作主会话。
  return header?.origin !== 'subagent'
    && (header?.delegationDepth === undefined || header.delegationDepth === 0);
}

function agentSession(agent) {
  const session = agent?.session;
  return isRecord(agent) && isMainSession(session) && agent.id === session.id ? session : null;
}

function isFinalText(data) {
  const content = data.message?.content;
  if (!Array.isArray(content) || data.interrupted === true) return false;
  return content.some(block => block?.type === 'text' && typeof block.text === 'string' && block.text.trim())
    && !content.some(block => block?.type === 'tool-call');
}

/**
 * 直接接收官方 session/event、goal/changed 与 agent/error 载荷。
 * minDurationMs 只过滤 complete；now 用于没有事件时间的瞬时通知。
 * 每次调用返回新通知或 null，onNotice 同步接收相同通知。
 */
export function createNotifier({
  minDurationMs = 10_000, enabled = true, events = {}, onNotice = () => {}, now = Date.now,
} = {}) {
  const minimum = isTime(minDurationMs) ? minDurationMs : 10_000;
  const sessions = new Map();
  const seen = new Map();
  const disposedSessions = new WeakSet();
  let disposed = false;

  const accepts = session => !disposed && enabled === true
    && isMainSession(session) && !disposedSessions.has(session);
  const allowed = kind => events?.[kind] !== false && events?.[kind]?.enabled !== false;

  function stateFor(id) {
    let state = sessions.get(id);
    if (!state) state = { seq: -1, endedTurn: 0, current: null };
    // ponytail: 最多 256 个会话；淘汰最久未用的状态，久未用会话的去重为尽力而为。
    sessions.delete(id);
    sessions.set(id, state);
    if (sessions.size > STATE_LIMITS.sessions) sessions.delete(sessions.keys().next().value);
    return state;
  }

  function currentFor(state, turn) {
    if (turn <= state.endedTurn || (state.current && turn < state.current.turn)) return null;
    if (!state.current || state.current.turn !== turn) {
      // 官方一个会话只运行一个 turn；新轮次也回收缺少 turn/end 的旧状态。
      state.current = { turn, started: false, startTime: null, final: false, failed: false };
    }
    return state.current;
  }

  function emit(kind, sessionId, key, fields = {}) {
    if (!allowed(kind)) return null;
    // 元组编码避免包含冒号等字符的标识互相碰撞。
    const id = JSON.stringify([kind, sessionId, ...key]);
    if (seen.has(id)) return null;
    let time = fields.time;
    if (!isTime(time)) {
      try { time = now(); } catch { return null; }
    }
    if (!isTime(time)) return null;
    const notice = { id, kind, sessionId, ...fields, time };
    seen.set(id, sessionId);
    // ponytail: 1024 条 FIFO 去重窗口；淘汰后的旧事件允许再次通知。
    if (seen.size > STATE_LIMITS.notices) seen.delete(seen.keys().next().value);
    // 输出失败不能改变 Agent 的运行结果，也不能让相同事件重复输出。
    try { onNotice(notice)?.catch?.(() => {}); } catch { /* 观察者失败已隔离。 */ }
    return notice;
  }

  function sessionEvent(session, event) {
    if (!accepts(session) || !isRecord(event) || !isRecord(event.data)) return null;
    const { type, data, seq } = event;
    if (!['turn/start', 'assistant/message', 'tool/call', 'turn/end', 'approval/asked'].includes(type)) return null;
    if (type === 'approval/asked' ? !isId(data.id) : !isTurn(data.turn)) return null;
    if (seq !== undefined && !isIndex(seq)) return null;
    // 从持久化恢复的种子属于过去的生命周期，不作为新通知输入。
    if (isIndex(session.firstLiveSeq) && seq !== undefined && seq < session.firstLiveSeq) return null;

    const state = stateFor(session.id);
    if (seq !== undefined) {
      if (seq <= state.seq) return null;
      state.seq = seq;
    }
    if (type === 'approval/asked') {
      return emit('approval', session.id, [data.id], {
        ...(state.current ? { turn: state.current.turn } : {}), time: event.time,
      });
    }
    if (type === 'turn/end') {
      if (data.turn <= state.endedTurn) return null;
      state.endedTurn = data.turn;
      const current = state.current?.turn === data.turn ? state.current : null;
      if (state.current && state.current.turn <= data.turn) state.current = null;
      if (data.reason?.kind !== 'completed' || !current?.final || current.failed || !current.started
        || !isTime(current.startTime) || !isTime(event.time) || event.time < current.startTime) return null;
      const durationMs = event.time - current.startTime;
      if (durationMs < minimum) return null;
      return emit('complete', session.id, [data.turn], { turn: data.turn, time: event.time, durationMs });
    }

    const current = currentFor(state, data.turn);
    if (!current) return null;
    if (type === 'turn/start') {
      if (!current.started) {
        current.started = true;
        current.startTime = isTime(event.time) ? event.time : null;
        current.final = false;
      }
    } else if (type === 'assistant/message') {
      current.final = isFinalText(data);
    } else {
      // 最终文本之后的任何 tool/call 都撤销完成候选，包括提问工具。
      current.final = false;
      if (data.name === 'ask_user_question' && isId(data.callId)) {
        return emit('question', session.id, [data.callId], { turn: data.turn, time: event.time });
      }
    }
    return null;
  }

  function goalChanged(payload) {
    const session = agentSession(payload?.agent);
    const change = payload?.change;
    if (!session || !accepts(session) || change?.operation !== 'block'
      || !isId(change.ref?.id) || !isTurn(change.ref?.revision)) return null;
    // goal/changed.complete 不通知，完成语义统一由最终回答的 turn/end 决定。
    return emit('block', session.id, [change.ref.id, change.ref.revision], {
      ...(sessions.get(session.id)?.current ? { turn: sessions.get(session.id).current.turn } : {}),
      time: change.goal?.updatedAt,
    });
  }

  function agentError(payload) {
    const session = agentSession(payload?.agent);
    if (!session || !accepts(session) || !isRecord(payload) || !Object.hasOwn(payload, 'error')
      || !isIndex(payload.turn) || !isIndex(payload.step)) return null;
    const current = sessions.get(session.id)?.current;
    if (current?.turn === payload.turn) current.failed = true;
    // turn/step 为 0 是轮次开始之前的运行错误，不显示不存在的 turn #0。
    return emit('error', session.id, [payload.turn, payload.step], {
      ...(payload.turn > 0 ? { turn: payload.turn } : {}),
    });
  }

  function disposeSession(session) {
    if (!isRecord(session) || !isId(session.id)) return;
    // 弱引用拒绝同一已销毁对象的迟到事件，不延长会话对象的生命周期。
    disposedSessions.add(session);
    sessions.delete(session.id);
    for (const [id, owner] of seen) if (owner === session.id) seen.delete(id);
  }

  function dispose() {
    disposed = true;
    sessions.clear();
    seen.clear();
  }

  return { sessionEvent, goalChanged, agentError, disposeSession, dispose };
}

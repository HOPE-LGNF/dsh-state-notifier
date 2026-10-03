import { randomUUID } from 'node:crypto';

/** 有界、仅内存的通知日志。首次订阅从现在开始；同代重连补发。 */
export function createJournal({ capacity = 256, pollMs = 25_000, now = Date.now } = {}) {
  const epoch = randomUUID();
  const notices = [];
  const waiters = new Map();
  const clients = new Map();
  let seq = 0;
  let closed = false;

  const read = (cursor) => {
    const reset = cursor !== null && (cursor.epoch !== epoch || cursor.seq > seq || cursor.seq < (notices[0]?.seq ?? seq + 1) - 1);
    return { epoch, cursor: seq, reset, notices: cursor === null || reset ? [] : notices.filter(n => n.seq > cursor.seq) };
  };
  const prune = () => {
    for (const [id, client] of clients) if (now() - client.time > 35_000) clients.delete(id);
  };
  return {
    publish(notice) {
      if (closed) return;
      notices.push({ ...notice, id: `${epoch}:${++seq}`, seq });
      if (notices.length > capacity) notices.shift();
      for (const wake of [...waiters.values()]) wake();
    },
    hasBrowser() {
      prune();
      return [...clients.values()].some(client => client.ready);
    },
    async poll(request, signal) {
      if (closed) throw new Error('通知插件已卸载');
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || typeof request.clientId !== 'string' || !/^[\w-]{1,80}$/.test(request.clientId)
        || typeof request.browserReady !== 'boolean'
        || !(request.cursor === null || (request.cursor && typeof request.cursor.epoch === 'string'
          && request.cursor.epoch.length <= 80 && Number.isSafeInteger(request.cursor.seq) && request.cursor.seq >= 0))) {
        throw new TypeError('通知订阅参数无效');
      }
      signal.throwIfAborted();
      prune();
      if (!clients.has(request.clientId) && clients.size >= 32) throw new Error('通知客户端已达上限');
      // 相同客户端的新请求唤醒旧请求，避免同一页面积累长轮询。
      waiters.get(request.clientId)?.();
      clients.set(request.clientId, { ready: request.browserReady, time: now() });
      const result = read(request.cursor);
      if (request.cursor === null || result.reset || result.notices.length) return result;
      await new Promise((resolve, reject) => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (waiters.get(request.clientId) === finish) waiters.delete(request.clientId);
          resolve();
        };
        const abort = () => { finish(); reject(signal.reason); };
        waiters.set(request.clientId, finish);
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(finish, pollMs);
        timer.unref?.();
      });
      signal.throwIfAborted();
      if (closed) throw new Error('通知插件已卸载');
      return read(request.cursor);
    },
    dispose() {
      closed = true;
      for (const wake of [...waiters.values()]) wake();
      clients.clear();
      notices.length = 0;
    },
  };
}

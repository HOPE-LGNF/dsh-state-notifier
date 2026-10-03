/** 浏览器输出与本机偏好；原生通知只显示分类和会话短标识。 */
export const LABELS = Object.freeze({ complete: '任务完成', approval: '等待批准', question: '等待回答', block: '任务受阻', error: '发生错误' });
export const DEFAULTS = Object.freeze({ enabled: true, sound: true, desktop: true, volume: 0.5, quietWhenFocused: false });
export const PREFERENCES_KEY = 'dsh-state-notifier.preferences.v1';
export const RECEIPTS_KEY = 'dsh-state-notifier.receipts.v1';
// ponytail: 单个短时同步发送锁保护最多 256 条共享记录；高吞吐时再拆分记录。
const DELIVERY_LOCK = 'dsh-state-notifier.delivery.v1';
const TONES = { complete: [523, 659, 784], approval: [660, 660], question: [523, 698], block: [440, 330], error: [330, 262, 196] };

function preferences(value) {
  const result = { ...DEFAULTS };
  if (!value || typeof value !== 'object') return result;
  for (const key of ['enabled', 'sound', 'desktop', 'quietWhenFocused']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (typeof value.volume === 'number' && Number.isFinite(value.volume)) result.volume = Math.max(0, Math.min(1, value.volume));
  return result;
}

export function createBrowserNotifier(env = globalThis, openSession = () => {}) {
  let disposed = false;
  let audio;
  let unlocked = false;
  let prefs = { ...DEFAULTS };
  let storageAvailable = true;
  let soundError = '';
  let desktopError = '';
  let desktopFailed = false;
  let navigationError = '';
  let transport = '正在连接提醒服务…';
  let playback = 'auto';
  let resetMessage = '';
  const listeners = new Set();
  const nodes = new Set();
  const notifications = new Set();
  const locks = env.navigator?.locks;
  function read(key, fallback) {
    try { return JSON.parse(env.localStorage.getItem(key) || 'null') ?? fallback; }
    catch { storageAvailable = false; return fallback; }
  }
  prefs = preferences(read(PREFERENCES_KEY, DEFAULTS));
  // 先验证存储写入，避免在不能持久化成功记录时承诺跨标签页去重。
  try { env.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs)); }
  catch { storageAvailable = false; }
  const focused = () => env.document?.visibilityState === 'visible' && !!env.document?.hasFocus?.();
  const muted = () => prefs.quietWhenFocused && focused();
  const permission = () => !env.Notification ? 'unsupported' : !env.isSecureContext ? 'insecure' : env.Notification.permission;
  let lastPermission = permission();
  const audioReady = () => !!audio && unlocked && audio.state === 'running';
  const soundReady = () => prefs.sound && prefs.volume > 0 && audioReady() && !soundError;
  const desktopReady = () => prefs.desktop && permission() === 'granted' && !desktopFailed;
  // 前台静默仍由浏览器承接事件，避免主机自动策略回落到终端响铃。
  const browserReady = () => !disposed && storageAvailable && prefs.enabled && (soundReady() || desktopReady());
  function snapshot() {
    return {
      preferences: { ...prefs }, browserReady: browserReady(), permission: permission(),
      soundStatus: soundError || (!env.AudioContext && !env.webkitAudioContext ? '此浏览器不支持 Web Audio' : audioReady() ? '声音已解锁' : '请点击启用 / 试听声音'),
      desktopStatus: desktopError || ({ unsupported: '此浏览器不支持桌面通知', insecure: '桌面通知需要 HTTPS 或 localhost', denied: '通知权限已拒绝，请在浏览器站点设置中修改', default: '请点击允许桌面通知', granted: '桌面通知已获准' }[permission()] || '通知权限未知'),
      storageStatus: storageAvailable ? '' : '无法访问本地存储，浏览器提醒已暂停',
      tabStatus: locks ? '多标签页发送通过 Web Locks 协调' : '此浏览器缺少 Web Locks，请只保留一个任务页面标签页开启提醒',
      transport, playback, resetMessage,
      navigationError,
    };
  }
  function publish() { if (!disposed) for (const listener of listeners) listener(); }
  function stopAudio() {
    for (const node of nodes) { try { node.stop(); } catch {} try { node.disconnect(); } catch {} }
    nodes.clear();
  }
  function update(patch) {
    if (disposed) return;
    prefs = preferences({ ...prefs, ...patch });
    if (!prefs.enabled || !prefs.sound || prefs.volume === 0) stopAudio();
    try { env.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs)); }
    catch { storageAvailable = false; }
    publish();
  }
  function onStorage(event) {
    if (event.key !== PREFERENCES_KEY && event.key !== null) return;
    prefs = preferences(read(PREFERENCES_KEY, DEFAULTS));
    if (!prefs.enabled || !prefs.sound || prefs.volume === 0) stopAudio();
    publish();
  }
  const onFocus = () => {
    const nextPermission = permission();
    if (nextPermission !== lastPermission) { lastPermission = nextPermission; desktopError = ''; desktopFailed = false; }
    if (muted()) stopAudio();
    publish();
  };
  env.addEventListener?.('storage', onStorage);
  env.addEventListener?.('focus', onFocus);
  env.addEventListener?.('blur', onFocus);
  env.document?.addEventListener?.('visibilitychange', onFocus);

  function play(kind) {
    if (disposed || !soundReady()) return false;
    const start = audio.currentTime;
    const created = [];
    try {
      for (const [index, frequency] of TONES[kind].entries()) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        created.push(oscillator);
        nodes.add(oscillator);
        oscillator.type = kind === 'error' ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency;
        const at = start + index * 0.17;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(prefs.volume * 0.18, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => { nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at);
        oscillator.stop(at + 0.15);
      }
      soundError = '';
      return true;
    } catch {
      for (const node of created) { try { node.stop(); } catch {} try { node.disconnect(); } catch {} nodes.delete(node); }
      soundError = '声音发送失败，请再次点击启用 / 试听声音';
      publish();
      return false;
    }
  }
  async function enableSound(kind = 'complete') {
    if (disposed || !Object.hasOwn(LABELS, kind)) return false;
    const Audio = env.AudioContext || env.webkitAudioContext;
    if (!Audio) { soundError = '此浏览器不支持 Web Audio'; publish(); return false; }
    let current;
    try {
      update({ sound: true });
      // 在真实点击处理函数中创建和恢复音频上下文，保留用户手势。
      current = audio || (audio = new Audio());
      if (!current.onstatechange) current.onstatechange = () => { if (!disposed && audio === current) publish(); };
      await current.resume();
      if (disposed || audio !== current) return false;
      unlocked = current.state === 'running';
      soundError = unlocked ? '' : '浏览器未允许声音，请再次点击按钮';
      publish();
      return unlocked && prefs.enabled && play(kind);
    } catch {
      if (disposed) return false;
      unlocked = false;
      soundError = '声音解锁失败，请检查浏览器的自动播放设置';
      publish();
      return false;
    }
  }
  async function requestPermission() {
    if (disposed) return;
    desktopError = '';
    if (permission() === 'unsupported' || permission() === 'insecure' || permission() === 'denied') { publish(); return; }
    try {
      update({ desktop: true });
      await env.Notification.requestPermission();
      if (disposed) return;
      desktopError = '';
      desktopFailed = false;
      lastPermission = permission();
      publish();
    } catch { if (!disposed) { desktopError = '通知权限请求失败'; publish(); } }
  }
  function desktop(notice) {
    if (disposed || !desktopReady()) return false;
    try {
      const notification = new env.Notification(`DeepSeek：${LABELS[notice.kind]}`, {
        body: `会话 ${notice.sessionId.slice(0, 8)}`, tag: `dsh-state-notifier:${notice.id}`, silent: true,
      });
      if (notifications.size >= 32) {
        const oldest = notifications.values().next().value;
        notifications.delete(oldest);
        oldest.onclick = null; oldest.onclose = null; oldest.onerror = null;
        try { oldest.close(); } catch {}
      }
      notifications.add(notification);
      notification.onclose = () => notifications.delete(notification);
      notification.onerror = () => {
        if (disposed) return;
        desktopError = '浏览器报告通知显示失败';
        desktopFailed = true;
        notification.onerror = null;
        // 构造成功只说明浏览器接受请求。异步显示失败时撤销记录，允许别的标签页重试。
        const revoke = () => {
          if (disposed) return;
          const receipts = read(RECEIPTS_KEY, []);
          if (!Array.isArray(receipts)) return;
          const row = receipts.find(item => item?.id === notice.id);
          if (row) {
            row.desktop = false;
            try { env.localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts)); }
            catch { storageAvailable = false; }
          }
          publish();
        };
        if (locks) void locks.request(DELIVERY_LOCK, revoke).catch(() => { if (!disposed) { storageAvailable = false; publish(); } });
        else revoke();
        publish();
      };
      notification.onclick = () => {
        if (disposed) return;
        env.focus?.();
        try { Promise.resolve(openSession(notice.sessionId)).catch(() => { if (!disposed) { navigationError = '无法打开会话：会话导航失败'; publish(); } }); }
        catch { navigationError = '无法打开会话：会话导航服务不可用'; publish(); }
        try { notification.close(); } catch {}
      };
      desktopError = '';
      return true;
    } catch { desktopError = '桌面通知发送失败'; desktopFailed = true; publish(); return false; }
  }
  async function deliver(notice) {
    if (disposed || !notice || typeof notice.id !== 'string' || typeof notice.sessionId !== 'string' || !Object.hasOwn(LABELS, notice.kind)) return;
    const send = () => {
      // 等待其他标签页释放发送锁期间，用户可能已修改设置。
      if (!browserReady() || muted() || (playback !== 'auto' && playback !== 'browser')) return;
      const saved = read(RECEIPTS_KEY, []);
      if (!storageAvailable) { publish(); return; }
      const receipts = Array.isArray(saved) ? saved.filter(row => row && typeof row.id === 'string').slice(-256) : [];
      const receipt = receipts.find(row => row.id === notice.id) || { id: notice.id, sound: false, desktop: false };
      let changed = false;
      if (!receipt.sound && soundReady() && play(notice.kind)) { receipt.sound = true; changed = true; }
      if (!receipt.desktop && desktopReady() && desktop(notice)) { receipt.desktop = true; changed = true; }
      if (changed) {
        try { env.localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...receipts.filter(row => row.id !== notice.id), receipt].slice(-256))); }
        catch { storageAvailable = false; publish(); }
      }
    };
    try {
      if (locks) await locks.request(DELIVERY_LOCK, send);
      else send();
    } catch { if (!disposed) { transport = '多标签页提醒协调失败'; publish(); } }
  }
  return {
    snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update, enableSound, requestPermission, deliver, browserReady,
    setTransport(message) { transport = message; publish(); },
    setHostState(mode, reset) { playback = mode; resetMessage = reset ? '提醒记录已重置；断线期间的部分提醒可能已超出保留范围' : ''; publish(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      env.removeEventListener?.('storage', onStorage);
      env.removeEventListener?.('focus', onFocus);
      env.removeEventListener?.('blur', onFocus);
      env.document?.removeEventListener?.('visibilitychange', onFocus);
      stopAudio();
      for (const notification of notifications) { notification.onclick = null; notification.onclose = null; notification.onerror = null; try { notification.close(); } catch {} }
      notifications.clear();
      const closing = audio;
      audio = undefined;
      unlocked = false;
      if (closing) { closing.onstatechange = null; try { Promise.resolve(closing.close()).catch(() => {}); } catch {} }
    },
  };
}

/** 串行长轮询；重试等待可取消，浏览器输出能力变化时立即更新主机。 */
export function startPolling(rpc, notifier, env = globalThis) {
  let stopped = false;
  let pending;
  let timer;
  let wake;
  let cursor = null;
  let retry = 500;
  let ready = notifier.browserReady();
  const clientId = env.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unsubscribe = notifier.subscribe(() => {
    const next = notifier.browserReady();
    if (next !== ready) { ready = next; pending?.abort(); wake?.(); }
  });
  const delay = ms => new Promise(resolve => {
    wake = () => { env.clearTimeout(timer); wake = undefined; resolve(); };
    timer = env.setTimeout(wake, ms);
  });
  const done = (async () => {
    while (!stopped) {
      pending = new AbortController();
      try {
        const result = await rpc.call('/api', 'state-notifier', { cursor, clientId, browserReady: notifier.browserReady() }, pending.signal);
        if (stopped) break;
        if (pending.signal.aborted) continue;
        const value = result?.ok && result.value;
        if (!value || typeof value.epoch !== 'string' || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || typeof value.reset !== 'boolean' || !Array.isArray(value.notices) || !['auto', 'browser', 'terminal', 'none'].includes(value.playback)) throw new Error('invalid poll');
        notifier.setHostState(value.playback, value.reset);
        for (const notice of value.notices) {
          if (stopped) break;
          await notifier.deliver(notice);
        }
        if (stopped) break;
        cursor = { epoch: value.epoch, seq: value.cursor };
        retry = 500;
        notifier.setTransport('提醒服务已连接');
      } catch {
        if (stopped) break;
        if (pending.signal.aborted) continue;
        notifier.setTransport('提醒服务连接失败，正在重试…');
        await delay(retry);
        retry = Math.min(retry * 2, 15000);
      }
    }
  })();
  return { done, dispose() { stopped = true; unsubscribe(); pending?.abort(); wake?.(); } };
}

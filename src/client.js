import React from 'react';
import styles from './client-style.js';
import { followPopoverSections } from './client-scroll.js';
import { createBrowserNotifier, LABELS, SOUND_PRESET_LABELS, ICON_CHOICES, CUSTOM_ICON, startPolling } from './browser.js';

export const inject = ['slots', 'connection'];

const h = React.createElement;
const row = (key, children) => h('div', { key, className: 'dsn-field' }, children);
const toggle = (key, text, checked, onChange, help) => h('label', { key, className: 'dsn-setting' },
  h('span', { className: 'dsn-copy' }, h('span', { className: 'dsn-label' }, text), help && h('small', null, help)),
  h('input', { type: 'checkbox', className: 'dsn-switch', 'aria-label': text, checked, onChange: event => onChange(event.target.checked) }));
const SECTION_ICONS = {
  sounds: ['M11 5 6 9H3v6h3l5 4V5Z', 'M15 8a6 6 0 0 1 0 8', 'M18 5a10 10 0 0 1 0 14'],
  appearance: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  native: ['M3 4h18v13H3z', 'M8 21h8', 'M12 17v4'],
  runtime: ['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z', 'm9 12 2 2 4-4'],
};
const svg = (paths, className) => h('svg', {
  className, width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
}, paths.map((d, key) => h('path', { key, d })));
const collapsible = (key, title, description, children) => h('details', { key, className: 'dsn-section' },
  h('summary', null,
    h('span', { className: 'dsn-section-icon' }, svg(SECTION_ICONS[key])),
    h('span', { className: 'dsn-copy' }, h('strong', null, title), h('small', null, description)),
    svg(['m6 9 6 6 6-6'], 'dsn-chevron')),
  h('div', { className: 'dsn-section-body' }, children));

export function apply(ctx) {
  const notifier = createBrowserNotifier(globalThis, sessionId => {
    const navigation = ctx.get('uiWorkspace');
    if (!navigation) throw new Error('session navigation unavailable');
    return navigation.openSession(sessionId);
  });
  const polling = startPolling(ctx.connection.rpc, notifier);
  ctx.effect(() => () => { polling.dispose(); notifier.dispose(); });
  function Controls({ compact = false }) {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const [iconError, setIconError] = React.useState('');
    const [iconName, setIconName] = React.useState('');
    const [native, setNative] = React.useState(null);
    const [probing, setProbing] = React.useState(false);
    const [testing, setTesting] = React.useState(false);
    const [testResult, setTestResult] = React.useState(null);
    const [manualPath, setManualPath] = React.useState('');
    const fileInput = React.useRef(null);
    const popover = React.useRef(null);
    React.useEffect(() => {
      if (compact && popover.current) return ctx.effect(() => followPopoverSections(popover.current));
    }, [compact]);
    React.useEffect(() => notifier.subscribe(refresh), []);
    const state = notifier.snapshot();
    const p = state.preferences;
    const onIconFile = event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setIconName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        setIconError(notifier.setIcon(String(reader.result)) ? '' : '图标未保存：只接受 32KB 以内的 PNG、JPEG、WebP、GIF 或 SVG');
      };
      reader.onerror = () => setIconError('图标读取失败');
      reader.readAsDataURL(file);
    };
    const callHost = async payload => {
      const controller = new AbortController();
      const result = await ctx.connection.rpc.call('/api', 'state-notifier', payload, controller.signal);
      if (!result?.ok) throw new Error(result?.error?.message || '请求失败');
      return result.value;
    };
    const runProbe = async () => {
      setProbing(true);
      try {
        const value = await callHost({ action: 'probe' });
        setNative(value);
        if (value.path) setManualPath(value.path);
      } catch { setNative({ available: false, reason: '探测请求失败' }); }
      finally { setProbing(false); }
    };
    const applyNative = async (mode, path) => {
      try {
        const value = await callHost({ action: 'setNative', mode, path });
        setNative(current => ({ ...(current ?? {}), ...value, available: value.detected?.available ?? current?.available }));
        if (value.path) setManualPath(value.path);
      } catch { /* 失败由下一次探测暴露 */ }
    };
    const STATE_TEXT = {
      allowed: '系统允许通知',
      'disabled-for-app': '该应用的通知被关闭（设置 → 系统 → 通知 → DeepSeek Harness）',
      'disabled-for-user': '当前用户的通知被关闭',
      'disabled-by-policy': '被组策略禁用',
      'disabled-by-manifest': '被应用清单禁用',
      unknown: '通知状态未知',
    };
    const runTest = async () => {
      setTesting(true);
      try { setTestResult(await callHost({ action: 'testNative' })); }
      catch { setTestResult({ ok: false, reason: '请求失败' }); }
      finally { setTesting(false); }
    };
    const bellIcon = String(state.icon ?? '').startsWith('data:')
      ? h('img', { src: state.icon, alt: '自定义图标', width: 24, height: 24 })
      : state.icon;
    const select = (key, label, value, onChange, options) => h('select', { key, value, className: 'dsn-select', 'aria-label': label, onChange: event => onChange(event.target.value) },
      options.map(([id, text]) => h('option', { key: id, value: id }, text)));
    const presetOptions = Object.entries(SOUND_PRESET_LABELS);
    const content = h('section', { role: 'group', 'aria-label': '任务状态提醒设置', className: 'dsn-settings', 'data-compact': compact },
      h('style', null, styles),
      h('header', { className: 'dsn-heading' },
        h('div', null, h('h3', null, '任务状态提醒'), h('p', null, '声音、桌面通知与通知外观')),
        h('span', { className: 'dsn-badge', 'data-enabled': p.enabled }, p.enabled ? '此浏览器已启用' : '此浏览器已关闭')),
      h('div', { className: 'dsn-basics' },
        toggle('enabled', '启用此浏览器的提醒', p.enabled, value => notifier.update({ enabled: value }), '声音与浏览器桌面通知的总开关。'),
        toggle('sound', '播放声音', p.sound, value => { if (value) void notifier.unlockSound(); else notifier.update({ sound: false }); }, '在此设备播放短提示音。'),
        p.sound && !state.soundUnlocked && row('unlock', h('div', { className: 'dsn-notice' },
          h('span', null, '浏览器需要一次点击才能播放声音。'),
          h('button', { className: 'dsn-button', type: 'button', onClick: () => { void notifier.unlockSound(); } }, '点击解锁声音'))),
        p.sound && state.soundUnlocked && row('volume', h('label', { className: 'dsn-volume' },
          h('span', null, '提醒音量', h('output', null, `${Math.round(p.volume * 100)}%`)),
          h('input', { className: 'dsn-range', type: 'range', min: 0, max: 1, step: 0.05, value: p.volume, 'aria-label': '提醒音量', onChange: event => notifier.update({ volume: Number(event.target.value) }) }))),
        toggle('desktop', '显示桌面通知', p.desktop, value => { if (value) void notifier.requestPermission(); else notifier.update({ desktop: false }); }, '由当前浏览器向系统发送通知。'),
        p.desktop && state.permission !== 'granted' && row('grant', h('div', { className: 'dsn-notice' },
          h('span', null, state.desktopStatus),
          state.permission === 'default' && h('button', { className: 'dsn-button', type: 'button', onClick: () => { void notifier.requestPermission(); } }, '点击授权桌面通知'))),
        toggle('quietWhenFocused', '窗口处于前台时静音', p.quietWhenFocused, value => notifier.update({ quietWhenFocused: value }), '关注当前窗口时，暂停浏览器提醒。')),
      collapsible('sounds', '声音方案与试听', '为五类事件选择不同的提示音', [
        row('global', h('label', { className: 'dsn-sound-row' }, h('span', null, '统一声音方案'),
          select('global-preset', '统一声音方案', '', preset => {
            if (preset) notifier.update({ sounds: Object.fromEntries(Object.keys(LABELS).map(kind => [kind, preset])) });
          }, [['', '应用到全部…'], ...presetOptions]))),
        ...Object.entries(LABELS).map(([kind, text]) => h('div', { key: kind, className: 'dsn-sound-row' },
          h('span', null, text), h('div', { className: 'dsn-actions' },
            select(`preset-${kind}`, `${text}声音`, p.sounds[kind], preset => notifier.update({ sounds: { ...p.sounds, [kind]: preset } }), presetOptions),
            h('button', { className: 'dsn-button', type: 'button', 'aria-label': `试听${text}`, onClick: () => { void notifier.enableSound(kind); } }, '试听')))),
        h('small', { key: 'note' }, '所有声音均在本机合成，无需下载素材。'),
      ]),
      collapsible('appearance', '通知外观', '图标、会话名称与提问内容', [
        row('icon', h('div', null, h('span', { className: 'dsn-label' }, '铃铛图标'),
          h('div', { className: 'dsn-icons' }, ICON_CHOICES.map(choice => h('button', {
            key: choice, type: 'button', className: 'dsn-icon', 'aria-label': `使用 ${choice} 图标`, 'aria-pressed': p.icon === choice,
            onClick: () => { notifier.update({ icon: choice, iconData: '' }); setIconName(''); setIconError(''); },
          }, choice))))),
        row('upload', h('div', null,
          h('input', { ref: fileInput, type: 'file', hidden: true, accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', 'aria-label': '上传自定义图标', onChange: onIconFile }),
          h('div', { className: 'dsn-actions' },
            h('button', { className: 'dsn-button', type: 'button', onClick: () => fileInput.current?.click() }, '选择图标文件'),
            h('span', { className: 'dsn-file-name' }, iconName || (p.icon === CUSTOM_ICON ? '已使用自定义图标' : '未选择文件')),
            p.icon === CUSTOM_ICON && h('button', { className: 'dsn-button', type: 'button', onClick: () => { notifier.update({ icon: ICON_CHOICES[0], iconData: '' }); setIconName(''); setIconError(''); } }, '清除')),
          h('small', null, '最大 32KB · PNG、JPEG、WebP、GIF 或 SVG · 仅保存在本机'),
          iconError && h('p', { role: 'alert', className: 'dsn-error' }, iconError))),
        toggle('title', '显示会话标题', p.showSessionTitle, value => notifier.update({ showSessionTitle: value }), '用会话名称代替简短标识。'),
        toggle('question', '显示提问的问题', p.showQuestion, value => notifier.update({ showQuestion: value }), '关闭后，提问正文不会发送到此浏览器。'),
      ]),
      collapsible('native', '系统通知穿透', '实验性 · 由宿主发送，仅 Windows / WSL', [
        row('mode', h('label', { className: 'dsn-sound-row' }, h('span', null, '穿透模式'),
          select('native-mode', '穿透模式', native?.mode ?? 'off', mode => { void applyNative(mode, manualPath); },
            [['off', '关闭'], ['auto', '自动探测'], ['manual', '手动指定']]))),
        row('probe', h('div', { className: 'dsn-actions' },
          h('button', { className: 'dsn-button', type: 'button', onClick: () => { void runProbe(); }, disabled: probing }, probing ? '检测中…' : '检测环境'),
          h('span', { style: { opacity: 0.8 } },
            !native ? '尚未检测'
              : native.available ? `可用（${native.wsl ? 'WSL' : native.platform}，${native.candidates?.length ?? 0} 个候选）`
                : `不可用：${native.reason || '未知原因'}`))),
        native?.candidates?.length ? row('candidates', h('div', null,
          h('div', { style: { opacity: 0.8 } }, '探测到的解释器'),
          h('ul', { style: { margin: '2px 0 0 16px', padding: 0 } },
            native.candidates.slice(0, 4).map(path => h('li', { key: path, style: { wordBreak: 'break-all' } }, path))))) : null,
        native?.mode === 'manual' && row('manual', h('div', null,
          h('div', null, '解释器绝对路径'),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
            h('input', {
              className: 'dsn-text', type: 'text', value: manualPath, 'aria-label': '解释器绝对路径', placeholder: '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
              style: { flex: 1, minWidth: 0 }, onChange: event => setManualPath(event.target.value),
            }),
            h('button', { className: 'dsn-button', type: 'button', onClick: () => { void applyNative('manual', manualPath); } }, '应用')))) ,
        row('test', h('div', { className: 'dsn-actions' },
          h('button', { className: 'dsn-button', type: 'button', onClick: () => { void runTest(); }, disabled: testing }, testing ? '发送中…' : '发送测试通知'),
          testResult && h('span', { role: 'status', className: testResult.ok ? 'dsn-help' : 'dsn-error' },
            testResult.ok ? `已发出 · ${STATE_TEXT[testResult.state] ?? STATE_TEXT.unknown}` : `失败：${testResult.reason ?? '未知'}`))),
        row('hint', h('small', null,
          '通知由宿主发送，只接受 powershell.exe 或 pwsh.exe。'
          + '模式改动立即生效，重启后回到 profile 配置的 native 值。')),
        row('allow', h('small', null,
          '首次启用时 Windows 可能询问是否允许此应用发送通知，请选择允许。若曾关闭，可在“设置 → 系统 → 通知”里重新打开；'
          + '插件不会尝试绕过这个决定。')),
      ]),
      collapsible('runtime', '权限及运行信息', '浏览器状态、连接与宿主输出策略', [
        h('dl', { key: 'status', className: 'dsn-runtime' }, [
          ['连接', state.transport], ['声音', state.soundStatus], ['桌面通知', state.desktopStatus], ['多标签页', state.tabStatus],
          ['宿主输出策略', { auto: '自动', browser: '浏览器', terminal: '终端', none: '关闭' }[state.playback]],
        ].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value)))),
        ...[state.storageStatus, state.resetMessage, state.navigationError].filter(Boolean).map(text => h('p', { key: text, className: 'dsn-notice' }, text)),
      ]),
      h('p', { className: 'dsn-footnote' }, '浏览器偏好即时保存，并同步到同一网站的其他标签页。全局事件与输出策略由宿主配置决定。'),
    );
    return compact ? h('details', { className: 'dsn-bell' },
      h('summary', { 'aria-label': '任务状态提醒', title: '任务状态提醒' }, p.enabled ? bellIcon : '🔕'),
      h('div', { ref: popover, className: 'dsn-popover' }, content)) : content;
  }
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'state-notifier', order: 90,
  }, () => h(Controls, { compact: true })));
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: 'dsh-state-notifier#state-notifier',
  }, ({ view }) => view === 'page' ? h(Controls) : null));
}

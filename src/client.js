import React from 'react';
import { createBrowserNotifier, LABELS, SOUND_PRESET_LABELS, ICON_CHOICES, CUSTOM_ICON, startPolling } from './browser.js';

export const inject = ['slots', 'connection'];

export function apply(ctx) {
  const notifier = createBrowserNotifier(globalThis, sessionId => {
    const navigation = ctx.get('uiWorkspace');
    if (!navigation) throw new Error('session navigation unavailable');
    return navigation.openSession(sessionId);
  });
  const polling = startPolling(ctx.connection.rpc, notifier);
  ctx.effect(() => () => { polling.dispose(); notifier.dispose(); });
  const h = React.createElement;
  const row = (key, children) => h('div', { key, style: { margin: '6px 0' } }, children);
  const toggle = (key, text, checked, onChange) => row(key, h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }), text));
  const collapsible = (key, title, children) => h('details', { key, style: { marginTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2, GrayText)', paddingTop: 6 } },
    h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, title),
    h('div', { style: { padding: '4px 0 0 10px' } }, children));

  function Controls({ compact = false }) {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const [iconError, setIconError] = React.useState('');
    const [, setTick] = React.useState(0);
    React.useEffect(() => notifier.subscribe(refresh), []);
    const state = notifier.snapshot();
    const p = state.preferences;
    const onIconFile = event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setIconError(notifier.setIcon(String(reader.result)) ? '' : '图标未保存：只接受 32KB 以内的 PNG、JPEG、WebP、GIF 或 SVG');
        setTick(value => value + 1);
      };
      reader.onerror = () => setIconError('图标读取失败');
      reader.readAsDataURL(file);
    };
    const preview = String(state.icon ?? '').startsWith('data:')
      ? h('img', { src: state.icon, alt: '自定义图标', width: 16, height: 16, style: { verticalAlign: '-3px' } })
      : state.icon;
    const select = (key, label, value, onChange, options) => h('select', { key, value, 'aria-label': label, onChange: event => onChange(event.target.value) },
      options.map(([id, text]) => h('option', { key: id, value: id }, text)));
    const presetOptions = Object.entries(SOUND_PRESET_LABELS);
    const content = h('div', { role: 'group', 'aria-label': '任务状态提醒设置', style: { padding: 12, minWidth: 280, maxWidth: 400, fontSize: 13, lineHeight: 1.6 } },
      h('strong', null, preview, ' 任务状态提醒'),
      toggle('enabled', '启用此浏览器的提醒', p.enabled, value => notifier.update({ enabled: value })),
      toggle('sound', '播放声音', p.sound, value => { if (value) void notifier.unlockSound(); else notifier.update({ sound: false }); }),
      p.sound && !state.soundUnlocked && row('unlock', h('button', { type: 'button', onClick: () => { void notifier.unlockSound(); } }, '点击解锁声音（浏览器要求一次点击）')),
      p.sound && state.soundUnlocked && row('volume', h('label', { style: { display: 'block' } }, `音量 ${Math.round(p.volume * 100)}% `,
        h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: p.volume, 'aria-label': '提醒音量', onChange: event => notifier.update({ volume: Number(event.target.value) }) }))),
      toggle('desktop', '显示桌面通知', p.desktop, value => { if (value) void notifier.requestPermission(); else notifier.update({ desktop: false }); }),
      p.desktop && state.permission === 'default' && row('grant', h('button', { type: 'button', onClick: () => { void notifier.requestPermission(); } }, '点击授权桌面通知')),
      toggle('quietWhenFocused', '窗口处于前台时静音', p.quietWhenFocused, value => notifier.update({ quietWhenFocused: value })),
      collapsible('sounds', '声音方案与试听', [
        row('global', h('label', null, '统一方案 ',
          select('global-preset', '统一声音方案', '', preset => {
            if (preset) notifier.update({ sounds: Object.fromEntries(Object.keys(LABELS).map(kind => [kind, preset])) });
          }, [['', '选择以应用到全部'], ...presetOptions]))),
        ...Object.entries(LABELS).map(([kind, text]) => row(`sound-${kind}`, h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('span', { style: { flex: '0 0 74px' } }, text),
          select(`preset-${kind}`, `${text}声音`, p.sounds[kind], preset => notifier.update({ sounds: { ...p.sounds, [kind]: preset } }), presetOptions),
          h('button', { type: 'button', onClick: () => { void notifier.enableSound(kind); } }, '试听')))),
        h('small', { key: 'note' }, `可选方案：${Object.values(SOUND_PRESET_LABELS).join('、')}。全部为本机合成的短音，不读取任何文件。`),
      ]),
      collapsible('appearance', '通知外观', [
        row('icon', h('div', null,
          h('div', null, '铃铛图标'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 } },
            ICON_CHOICES.map(icon => h('button', {
              key: icon, type: 'button', 'aria-pressed': p.icon === icon,
              style: { fontSize: 16, padding: '2px 6px', outline: p.icon === icon ? '2px solid var(--dsw-alias-brand-primary, Highlight)' : 'none' },
              onClick: () => notifier.update({ icon, iconData: '' }),
            }, icon))))),
        row('upload', h('div', null,
          h('div', null, '自定义图标（仅保存在本机）'),
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', 'aria-label': '上传自定义图标', onChange: onIconFile }),
          p.icon === CUSTOM_ICON && h('button', { type: 'button', onClick: () => notifier.update({ icon: ICON_CHOICES[0], iconData: '' }) }, '清除自定义图标'),
          iconError && h('div', { role: 'alert', style: { color: 'var(--dsw-alias-label-error, #c00)' } }, iconError))),
        toggle('title', '通知中显示会话标题（默认只显示会话短标识）', p.showSessionTitle, value => notifier.update({ showSessionTitle: value })),
        toggle('question', '显示提问的问题（默认开启）', p.showQuestion, value => notifier.update({ showQuestion: value })),
        h('small', { key: 'question-note' }, '关闭后，提问正文不会随订阅发给浏览器，通知只显示分类与会话标识。'),
      ]),
      collapsible('runtime', '权限及运行信息', [
        ...[state.soundStatus, state.desktopStatus, state.storageStatus, state.tabStatus, state.transport, state.resetMessage, state.navigationError]
          .filter(Boolean).map(text => h('div', { key: text }, text)),
        h('div', { key: 'playback' }, `主机输出策略：${{ auto: '自动', browser: '浏览器', terminal: '终端', none: '关闭' }[state.playback]}`),
        h('small', { key: 'privacy' }, '此处偏好仅适用于本机同源浏览器。全局分类、完成耗时门槛和输出策略由主机配置决定。上传图标保存在本机 localStorage，不发送到宿主。'),
      ]),
    );
    return compact ? h('details', { style: { position: 'relative' } },
      h('summary', { 'aria-label': '任务状态提醒', title: '任务状态提醒', style: { cursor: 'pointer', listStyle: 'none', padding: '4px 8px' } }, p.enabled ? preview : '🔕'),
      h('div', { style: { position: 'absolute', zIndex: 100, right: 0, background: 'var(--dsw-alias-bg-layer-2, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)', border: '1px solid var(--dsw-alias-border-l2, GrayText)', borderRadius: 8, boxShadow: '0 4px 16px #0003' } }, content)) : content;
  }
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'state-notifier', order: 90,
  }, () => h(Controls, { compact: true })));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'state-notifier', order: 90,
  }, Controls));
}

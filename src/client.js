import React from 'react';
import { createBrowserNotifier, LABELS, startPolling } from './browser.js';

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
  function Controls({ compact = false }) {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    React.useEffect(() => notifier.subscribe(refresh), []);
    const state = notifier.snapshot();
    const p = state.preferences;
    const checkbox = (key, text) => h('label', { key, style: { display: 'block', margin: '6px 0' } },
      h('input', { type: 'checkbox', checked: p[key], onChange: event => notifier.update({ [key]: event.target.checked }) }), ` ${text}`);
    const content = h('div', { style: { padding: 12, minWidth: 260, maxWidth: 380, fontSize: 13, lineHeight: 1.6 } },
      h('strong', null, '任务状态提醒'),
      checkbox('enabled', '启用此浏览器的提醒'), checkbox('sound', '播放声音'), checkbox('desktop', '显示桌面通知'),
      checkbox('quietWhenFocused', '窗口处于前台时静音'),
      h('label', { style: { display: 'block' } }, `音量 ${Math.round(p.volume * 100)}% `,
        h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: p.volume, 'aria-label': '提醒音量', onChange: event => notifier.update({ volume: Number(event.target.value) }) })),
      h('button', { type: 'button', onClick: () => { void notifier.enableSound(); } }, '启用 / 试听声音'),
      h('button', { type: 'button', onClick: () => { void notifier.requestPermission(); }, style: { marginLeft: 6 } }, '允许桌面通知'),
      h('div', null, '试听分类：'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, Object.entries(LABELS).map(([kind, text]) =>
        h('button', { key: kind, type: 'button', onClick: () => { void notifier.enableSound(kind); } }, text))),
      h('div', { role: 'status', 'aria-live': 'polite', style: { marginTop: 8 } },
        [state.soundStatus, state.desktopStatus, state.storageStatus, state.tabStatus, state.transport, state.resetMessage, state.navigationError].filter(Boolean).map(text => h('div', { key: text }, text))),
      h('div', null, `主机输出策略：${{ auto: '自动', browser: '浏览器', terminal: '终端', none: '关闭' }[state.playback]}`),
      h('small', null, '此处偏好仅适用于本机同源浏览器。全局分类、完成耗时门槛和输出策略由主机配置决定。通知仅显示分类与会话短标识。'),
    );
    return compact ? h('details', { style: { position: 'relative' } },
      h('summary', { 'aria-label': '任务状态提醒', title: '任务状态提醒', style: { cursor: 'pointer', listStyle: 'none', padding: '4px 8px' } }, p.enabled ? '🔔' : '🔕'),
      h('div', { style: { position: 'absolute', zIndex: 100, right: 0, background: 'var(--dsw-alias-bg-layer-2, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)', border: '1px solid var(--dsw-alias-border-l2, GrayText)', borderRadius: 8, boxShadow: '0 4px 16px #0003' } }, content)) : content;
  }
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'state-notifier', order: 90,
  }, () => h(Controls, { compact: true })));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'state-notifier', order: 90,
  }, Controls));
}

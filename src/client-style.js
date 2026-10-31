// 局部样式复用宿主语义颜色；不修改宿主页面容器。
export default `
.dsn-settings {
  --dsn-border: var(--dsw-alias-border-l2, GrayText);
  --dsn-muted: var(--dsw-alias-label-secondary, GrayText);
  --dsn-surface: var(--dsw-alias-bg-layer-3, ButtonFace);
  --dsn-inset: var(--dsw-alias-bg-layer-2, Canvas);
  --dsn-accent: var(--dsw-alias-brand-primary, Highlight);
  width: 100%; max-width: 760px; min-width: 0;
  color: var(--dsw-alias-label-primary, CanvasText); font-size: 14px; line-height: 1.6;
}
.dsn-settings, .dsn-settings *, .dsn-settings *::before { box-sizing: border-box; }
.dsn-settings :is(button,input,select) { font: inherit; }
.dsn-settings :is(button,input,select,summary):focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsn-accent)); outline-offset: 3px; }
.dsn-settings small, .dsn-help { display: block; color: var(--dsn-muted); font-size: 12px; line-height: 1.6; }
.dsn-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.dsn-heading h3 { font-size: 20px; font-weight: 600; letter-spacing: -.3px; margin: 0 0 4px; }
.dsn-heading p { margin: 0; font-size: 12px; color: var(--dsn-muted); }
.dsn-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsn-muted); white-space: nowrap; padding: 5px 9px; border-radius: 999px; background: var(--dsn-surface); }
.dsn-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsn-badge[data-enabled='true']::before { background: var(--dsn-accent); }
.dsn-basics, .dsn-section { background: var(--dsn-surface); border-radius: 14px; box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary, CanvasText) 5%, transparent), 0 1px 2px #00000008; }
.dsn-basics { padding: 2px 18px; margin-bottom: 20px; }
.dsn-basics > .dsn-field { margin: 0 0 12px; }
.dsn-basics .dsn-notice { background: var(--dsn-inset); }
.dsn-setting { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 15px 0; cursor: pointer; }
.dsn-setting + .dsn-setting { border-top: 1px solid var(--dsn-border); }
.dsn-copy { flex: 1; min-width: 0; }
.dsn-label, .dsn-section strong { display: block; font-weight: 600; }
.dsn-copy small { margin-top: 3px; }
.dsn-switch { position: relative; appearance: none; width: 36px; height: 22px; flex: 0 0 auto; margin: 0; border: 1px solid var(--dsn-border); border-radius: 999px; corner-shape: round; background: var(--dsw-alias-bg-layer-3, ButtonFace); cursor: pointer; transition: background-color 120ms; }
.dsn-switch::before { content: ''; display: block; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; corner-shape: round; background: var(--dsn-muted); transition: transform 120ms; }
.dsn-switch:checked { background: var(--dsn-accent); border-color: transparent; }
.dsn-switch:checked::before { transform: translateX(14px); background: var(--dsw-alias-label-primary-foreground, HighlightText); }
.dsn-field { margin: 10px 0; min-width: 0; }
.dsn-volume { display: block; max-width: 360px; padding-bottom: 8px; }
.dsn-volume > span { display: flex; justify-content: space-between; color: var(--dsn-muted); font-size: 12px; }
.dsn-volume output { color: var(--dsw-alias-label-primary, CanvasText); font-variant-numeric: tabular-nums; }
.dsn-range { display: block; width: 100%; height: 24px; margin: 5px 0 0; accent-color: var(--dsn-accent); cursor: pointer; }
.dsn-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; background: var(--dsw-alias-bg-layer-3, ButtonFace); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--dsn-muted); }
.dsn-notice > span { flex: 1 1 180px; }
.dsn-button, .dsn-select, .dsn-text { color: inherit; border: 1px solid var(--dsn-border); background: var(--dsw-alias-bg-layer-2, Canvas); border-radius: 7px; min-height: 34px; padding: 5px 10px; }
.dsn-button, .dsn-select { cursor: pointer; }
.dsn-button { white-space: nowrap; flex-shrink: 0; }
.dsn-button:hover, .dsn-icon:hover { background: var(--dsw-alias-interactive-bg-hover, ButtonFace); }
.dsn-button:disabled { cursor: wait; opacity: .55; }
.dsn-select { max-width: 100%; min-width: 105px; }
.dsn-text { min-width: 0; width: 100%; }
.dsn-section { margin-top: 10px; }
.dsn-section > summary { display: flex; align-items: center; gap: 12px; list-style: none; padding: 16px 18px; cursor: pointer; border-radius: inherit; }
.dsn-section > summary::-webkit-details-marker, .dsn-bell > summary::-webkit-details-marker { display: none; }
.dsn-section > summary:hover strong { color: var(--dsn-accent); }
.dsn-section-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border-radius: 10px; color: var(--dsn-muted); background: var(--dsn-inset); }
.dsn-chevron { display: block; width: 18px; height: 18px; flex: 0 0 18px; color: var(--dsn-muted); transform-origin: center; transition: transform 160ms cubic-bezier(.2,.8,.2,1); }
.dsn-section[open] > summary .dsn-chevron { transform: rotate(180deg); }
.dsn-section-body { padding: 0 18px 18px; min-width: 0; }
/* 支持尺寸插值时平滑展开；旧浏览器沿用原生 details 开合。 */
@supports (interpolate-size: allow-keywords) and selector(::details-content) {
  .dsn-section::details-content {
    interpolate-size: allow-keywords; block-size: 0; opacity: 0; overflow: clip;
    transition: block-size 160ms cubic-bezier(.2,.8,.2,1), opacity 120ms ease-out, content-visibility 160ms allow-discrete;
  }
  .dsn-section[open]::details-content { block-size: auto; opacity: 1; }
}
.dsn-sound-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
.dsn-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dsn-icons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dsn-icon { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--dsn-border); border-radius: 8px; background: transparent; cursor: pointer; font-size: 20px !important; }
.dsn-icon[aria-pressed='true'] { border-color: var(--dsn-accent); box-shadow: inset 0 0 0 1px var(--dsn-accent); }
.dsn-file-name { color: var(--dsn-muted); font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.dsn-field .dsn-actions + small { margin-top: 8px; }
.dsn-bell img { object-fit: contain; vertical-align: middle; }
.dsn-runtime { margin: 0; }
.dsn-runtime > div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 16px; padding: 8px 0; font-size: 12px; }
.dsn-runtime dt { color: var(--dsn-muted); }
.dsn-runtime dd { margin: 0; overflow-wrap: anywhere; }
.dsn-error { color: var(--dsw-alias-state-error-primary, CanvasText); font-size: 12px; }
.dsn-footnote { color: var(--dsn-muted); padding: 16px 2px 0; margin: 0; font-size: 12px; }
.dsn-bell { position: relative; }
.dsn-bell > summary { list-style: none; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
.dsn-bell > summary:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, Highlight); }
.dsn-popover { box-sizing: border-box; position: absolute; z-index: 100; right: 0; width: min(400px, calc(100vw - 32px)); max-height: min(720px, 80dvh); overflow: auto; scrollbar-gutter: stable; overflow-anchor: none; scroll-behavior: auto; overscroll-behavior: contain; padding: 20px; border: 1px solid var(--dsw-alias-border-l2, GrayText); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, Canvas); box-shadow: 0 8px 28px #0002; }
/* 原生 details 延后隐藏，让弹层的淡入淡出在关闭时也能完成。 */
@supports selector(::details-content) {
  .dsn-bell::details-content { transition: content-visibility 100ms allow-discrete; }
  .dsn-bell > .dsn-popover { opacity: 0; transform: translateY(-2px); transition: opacity 100ms ease-out, transform 100ms ease-out; }
  .dsn-bell[open] > .dsn-popover { opacity: 1; transform: translateY(0); }
}
.dsn-settings[data-compact='true'] .dsn-heading { flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.dsn-settings[data-compact='true'] .dsn-heading h3 { font-size: 17px; }
.dsn-settings[data-compact='true'] .dsn-setting { padding: 12px 0; gap: 12px; }
.dsn-settings[data-compact='true'] .dsn-section > summary { padding: 14px; }
.dsn-settings[data-compact='true'] .dsn-section-body { padding: 0 14px 14px; }
.dsn-settings[data-compact='true'] .dsn-basics { padding: 2px 14px; }
@media (max-width: 600px) {
  .dsn-heading { flex-wrap: wrap; gap: 8px; }
  .dsn-heading h3 { font-size: 18px; }
  .dsn-setting { gap: 12px; }
  .dsn-sound-row { flex-wrap: wrap; }
  .dsn-runtime > div { grid-template-columns: minmax(0,1fr); gap: 2px; }
  .dsn-popover { padding: 16px; }
  .dsn-basics { padding: 2px 14px; }
  .dsn-section > summary { padding: 14px; }
  .dsn-section-body { padding: 0 14px 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsn-switch, .dsn-switch::before, .dsn-chevron, .dsn-section::details-content, .dsn-bell::details-content, .dsn-bell > .dsn-popover { transition: none; }
}
@media (forced-colors: active) { .dsn-switch { appearance: auto; } .dsn-switch::before { display: none; } }
`;

/** 分组开合时只滚动插件弹层；用户手动操作或视图卸载立即结束跟随。 */
export function followPopoverSections(popover) {
  const view = popover.ownerDocument.defaultView;
  let frame = 0;
  const cancel = () => {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
  };
  const click = event => {
    const summary = event.target.closest('summary');
    const section = summary?.parentElement;
    if (!section?.matches('.dsn-section') || section.closest('.dsn-popover') !== popover) return;
    cancel();
    const opening = !section.open;
    const startScroll = popover.scrollTop;
    const inset = view.getComputedStyle(popover);
    const topPadding = parseFloat(inset.paddingTop) || 0;
    const bottomPadding = parseFloat(inset.paddingBottom) || 0;
    const startTop = section.getBoundingClientRect().top - popover.getBoundingClientRect().top - popover.clientTop;
    const step = () => {
      frame = 0;
      if (!popover.isConnected || !section.isConnected || !popover.closest('.dsn-bell')?.open) return;
      const viewportTop = popover.getBoundingClientRect().top + popover.clientTop;
      const bounds = section.getBoundingClientRect();
      const sectionTop = bounds.top - viewportTop + popover.scrollTop;
      const sectionBottom = bounds.bottom - viewportTop + popover.scrollTop;
      // 短内容露出下沿即可；长内容最多将标题对齐顶部，不把标题推走。
      const desired = opening
        ? Math.min(Math.max(startScroll, sectionBottom - popover.clientHeight + bottomPadding), sectionTop - topPadding)
        : sectionTop - startTop;
      popover.scrollTop = Math.max(0, Math.min(desired, popover.scrollHeight - popover.clientHeight));
      // 直接跟随当前布局，不叠加第二段 smooth scroll，也不依赖固定动画时长。
      if (section.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')) {
        frame = view.requestAnimationFrame(step);
      }
    };
    // click 在 details 默认动作之前捕获；下一帧读取开合后的布局。
    frame = view.requestAnimationFrame(step);
  };
  const interrupts = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  popover.addEventListener('click', click, true);
  for (const name of interrupts) popover.addEventListener(name, cancel, { capture: true, passive: true });
  return () => {
    cancel();
    popover.removeEventListener('click', click, true);
    for (const name of interrupts) popover.removeEventListener(name, cancel, true);
  };
}

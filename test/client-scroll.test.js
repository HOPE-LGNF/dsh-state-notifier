import test from 'node:test';
import assert from 'node:assert/strict';
import { followPopoverSections } from '../src/client-scroll.js';

function fixture() {
  const listeners = new Map(), frames = new Map();
  let id = 0;
  const state = { top: 250, height: 60, trailing: 500, running: false };
  const view = {
    getComputedStyle: () => ({ paddingTop: '12px', paddingBottom: '12px' }),
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
  };
  const bell = { open: true };
  const popover = {
    ownerDocument: { defaultView: view }, isConnected: true, clientTop: 1, clientHeight: 300, scrollTop: 0,
    get scrollHeight() { return state.top + state.height + state.trailing; },
    getBoundingClientRect: () => ({ top: 100 }), closest: () => bell,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
  };
  const section = {
    open: false, isConnected: true, matches: selector => selector === '.dsn-section', closest: () => popover,
    getBoundingClientRect: () => ({ top: 101 + state.top - popover.scrollTop, bottom: 101 + state.top + state.height - popover.scrollTop }),
    getAnimations: () => state.running ? [{ playState: 'running' }] : [],
  };
  const summary = { parentElement: section };
  const dispose = followPopoverSections(popover);
  return { state, frames, listeners, popover, bell, section, dispose,
    click() { listeners.get('click')({ target: { closest: () => summary } }); section.open = !section.open; },
    tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test('expansion exposes the lower edge without scrolling the section title above the viewport', () => {
  const f = fixture();
  try {
    f.click(); f.state.height = 200; f.state.running = true; f.tick();
    assert.equal(f.popover.scrollTop, 162);
    f.state.height = 600; f.state.running = false; f.tick();
    assert.equal(f.popover.scrollTop, 238);
    assert.equal(f.section.getBoundingClientRect().top, 113);
    assert.equal(f.frames.size, 0);
  } finally { f.dispose(); }
});

test('collapsing retains the reading position and only retreats when the remaining content requires it', () => {
  const f = fixture();
  try {
    f.section.open = true; f.state.height = 600; f.popover.scrollTop = 200;
    f.click(); f.state.height = 200; f.state.running = true; f.tick();
    assert.equal(f.popover.scrollTop, 200);
    f.state.trailing = 20; f.state.height = 60; f.state.running = false; f.tick();
    assert.equal(f.popover.scrollTop, 30);
  } finally { f.dispose(); }
});

test('manual input releases scroll control and rapid toggles replace the pending follow', () => {
  const f = fixture();
  try {
    f.click(); f.click(); assert.equal(f.frames.size, 1);
    f.listeners.get('wheel')(); f.popover.scrollTop = 75; f.tick();
    assert.equal(f.frames.size, 0); assert.equal(f.popover.scrollTop, 75);
  } finally { f.dispose(); }
});

test('view cleanup cancels pending frames and removes all listeners', () => {
  const f = fixture(); f.click();
  assert.equal(f.frames.size, 1);
  f.dispose();
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  f.tick(); assert.equal(f.popover.scrollTop, 0);
});

test('closing the bell ends a pending section follow', () => {
  const f = fixture();
  try {
    f.click(); f.bell.open = false; f.tick();
    assert.equal(f.frames.size, 0); assert.equal(f.popover.scrollTop, 0);
  } finally { f.dispose(); }
});

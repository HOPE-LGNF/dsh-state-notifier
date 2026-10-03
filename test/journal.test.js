import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournal } from '../src/journal.js';

const request = (cursor = null, clientId = 'tab-1', browserReady = true) => ({ cursor, clientId, browserReady });
const signal = () => new AbortController().signal;
test('首次只建基线，断线补发；重复游标可重读，epoch和缺口显式重置', async () => {
  const j = createJournal({ capacity: 2 });
  j.publish({ kind: 'approval' });
  const baseline = await j.poll(request(), signal());
  assert.equal(baseline.notices.length, 0);
  const cursor = { epoch: baseline.epoch, seq: baseline.cursor };
  j.publish({ kind: 'question' });
  const next = await j.poll(request(cursor), signal());
  assert.deepEqual(next.notices.map(n => n.kind), ['question']);
  assert.deepEqual((await j.poll(request(cursor), signal())).notices, next.notices);
  assert.equal((await j.poll(request({ epoch: 'old', seq: 500 }), signal())).reset, true);
  j.publish({ kind: 'block' }); j.publish({ kind: 'error' });
  assert.equal((await j.poll(request(cursor), signal())).reset, true);
  j.dispose();
});

test('事件唤醒长轮询，取消和卸载结束等待', async () => {
  const j = createJournal();
  const baseline = await j.poll(request(), signal());
  const cursor = { epoch: baseline.epoch, seq: baseline.cursor };
  const pending = j.poll(request(cursor), signal());
  j.publish({ kind: 'complete' });
  const result = await pending;
  assert.equal(result.notices[0].kind, 'complete');
  const next = { epoch: baseline.epoch, seq: result.cursor };
  const controller = new AbortController();
  const aborted = j.poll(request(next), controller.signal);
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  const stopped = j.poll(request(next), signal());
  j.dispose();
  await assert.rejects(stopped, /卸载/);
});

test('浏览器就绪租约会过期，输入和客户端数量有界', async () => {
  let time = 0;
  const j = createJournal({ now: () => time });
  await j.poll(request(), signal());
  assert.equal(j.hasBrowser(), true);
  time = 36_000;
  assert.equal(j.hasBrowser(), false);
  await assert.rejects(j.poll({ cursor: { epoch: 'a', seq: -1 }, clientId: 'x', browserReady: true }, signal()), TypeError);
  for (let i = 0; i < 32; i++) await j.poll(request(null, `tab-${i}`, false), signal());
  await assert.rejects(j.poll(request(null, 'overflow'), signal()), /上限/);
  assert.equal(j.hasBrowser(), false);
  j.dispose();
});

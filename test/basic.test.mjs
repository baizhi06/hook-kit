import test from 'node:test';
import assert from 'node:assert/strict';
import { createHookKit, renderHooksDoc, INTERFACE_NAMES } from '../src/index.mjs';

test('顺序：order 小的先跑，同 order 按注册先后', async () => {
  const kit = createHookKit();
  const seen = [];
  kit.register('incoming', 'b', () => seen.push('b'), { order: 10 });
  kit.register('incoming', 'a', () => seen.push('a'), { order: 5 });
  kit.register('incoming', 'c', () => seen.push('c'), { order: 10 });
  await kit.run('incoming', {});
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('失败隔离：一个扩展抛错，其他照跑，onError 收到现场', async () => {
  const errors = [];
  const kit = createHookKit({ onError: (e, info) => errors.push([e.message, info.id]) });
  const seen = [];
  kit.register('context', 'ok1', () => '一', { order: 1 });
  kit.register('context', 'bad', () => { throw new Error('炸了'); }, { order: 2 });
  kit.register('context', 'ok2', () => '二', { order: 3 });
  const blocks = await kit.collect('context', {});
  assert.deepEqual(blocks, ['一', '二']);
  assert.deepEqual(errors, [['炸了', 'bad']]);
  assert.equal(seen.length, 0);
});

test('闸门：第一个否决即生效，并带回 id', async () => {
  const kit = createHookKit();
  kit.register('gate', 'whitelist', () => ({ allow: false, reason: '不在白名单' }), { order: 1 });
  kit.register('gate', 'quiet', () => ({ allow: false, reason: '静音中' }), { order: 2 });
  const veto = await kit.veto('gate', {});
  assert.equal(veto.allow, false);
  assert.equal(veto.reason, '不在白名单');
  assert.equal(veto.id, 'whitelist');
});

test('闸门：手动唤醒例外放行', async () => {
  const kit = createHookKit();
  kit.register('gate', 'quiet', (ctx) => (ctx.reason === 'manual' ? { allow: true } : { allow: false, reason: '静音' }));
  assert.equal(await kit.veto('gate', { reason: 'manual' }), null);
  assert.equal((await kit.veto('gate', { reason: 'message' })).reason, '静音');
});

test('生成后：链式改写，返回空则保持原样', async () => {
  const kit = createHookKit();
  kit.register('transform', 'trim', (_ctx, text) => text.trim(), { order: 1 });
  kit.register('transform', 'noop', () => undefined, { order: 2 });
  kit.register('transform', 'cut', (_ctx, text) => text.slice(0, 3), { order: 3 });
  assert.equal(await kit.transform('transform', {}, '  abcdef  '), 'abc');
});

test('缓存键：只收声明 invalidatesCache 的扩展', () => {
  const kit = createHookKit();
  kit.register('context', 'memory', () => '', { invalidatesCache: true });
  kit.register('context', 'static', () => '');
  kit.register('afterSend', 'ledger', () => '', { invalidatesCache: true, stateKey: (ctx) => ctx.day });
  const keys = kit.stateKeys({ day: '2026-11-02' });
  assert.deepEqual(keys, ['afterSend:ledger', 'afterSend:ledger:2026-11-02', 'context:memory']);
});

test('登记表：describe 写清读写与缓存', () => {
  const kit = createHookKit();
  kit.register('context', 'memory', () => '', { invalidatesCache: true, description: '记忆卡' });
  kit.register('afterSend', 'ledger', () => '', { access: 'write', description: '额度记账' });
  const md = kit.describe({ format: 'md' });
  assert.match(md, /\| context \| memory \| 只读 \| 是 \| 100 \| 记忆卡 \|/);
  assert.match(md, /\| afterSend \| ledger \| 改写 \| 否 \| 100 \| 额度记账 \|/);
});

test('文档：renderHooksDoc 含全部接口与登记表', () => {
  const kit = createHookKit();
  kit.register('incoming', 'seen', () => {});
  const doc = renderHooksDoc(kit);
  for (const name of INTERFACE_NAMES) assert.ok(doc.includes(`\`${name}\``), `缺接口 ${name}`);
  assert.match(doc, /## 登记表/);
});

test('未注册的接口名直接报错', () => {
  const kit = createHookKit();
  assert.throws(() => kit.register('nope', 'x', () => {}), /未知接口/);
});

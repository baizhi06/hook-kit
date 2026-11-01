/**
 * 把四个接口接到一个「已经长了内联补丁」的桥接上。
 *
 * 这个文件不是真代码，是迁移时的对照样例：
 *   左边 = 以前在内联补丁里做的事，右边 = 现在拆成「功能自带声明」。
 *
 * 运行：node examples/wire-into-bridge.mjs
 */
import { createHookKit, renderHooksDoc } from '../src/index.mjs';
import { pathToFileURL } from 'node:url';

/** 建一套接线（真实项目里这个函数在启动时调用一次）。 */
export function buildKit({ cfg = {}, memory = { blocks: [] }, log = () => {} } = {}) {
  const kit = createHookKit({
    onError: (error, info) => log(`扩展 ${info.interfaceName}/${info.id} 抛错：${error.message}`),
  });

  // ① 上下文：记忆块。只读，读文件 → 必须让缓存感知
  kit.register('context', 'memory', (ctx) => memory.blocks[ctx.key] ?? '', {
    order: 10,
    invalidatesCache: true,
    stateKey: (ctx) => `${memory.version ?? 0}:${ctx.key ?? ''}`,
    description: '记忆卡（按会话）',
  });

  // ② 上下文：B站视频抽帧的提示（只在该条消息带链接时出现）
  kit.register('context', 'bili-frames', (ctx) => (ctx.hasBiliLink ? '【B站视频】这段只有画面，听不到声音。' : ''), {
    order: 20,
    description: '抽帧说明',
  });

  // ③ 决策：静音闸门（手动唤醒放行）
  kit.register('gate', 'quiet', (ctx) => {
    if (ctx.reason === 'manual' || ctx.reason === 'admin') return { allow: true };
    if (cfg.quiet?.includes(ctx.key)) return { allow: false, reason: '这个会话在静音里' };
    return { allow: true };
  }, { order: 10, access: 'read', description: '静音/学习模式' });

  // ④ 生成后：截断 + 去重
  kit.register('transform', 'trim-dupe', (_ctx, text) => {
    const lines = String(text ?? '').split('\n');
    return [...new Set(lines)].join('\n').slice(0, cfg.maxChars ?? 500);
  }, { order: 10, access: 'write', description: '截断与去重' });

  // ⑤ 发送后：额度记账
  kit.register('afterSend', 'ledger', (ctx) => { log(`记账 ${ctx.key} ${ctx.tokens ?? 0} tokens`); }, {
    order: 10,
    access: 'write',
    description: '额度记账',
  });

  return kit;
}

// 只有直接运行这个文件时才跑演示；被别的模块 import 时保持安静。
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const kit = buildKit({
    log: (line) => console.log('[bridge]', line),
    memory: { blocks: { 'private:1': '她记得你昨天说过要早睡' }, version: 3 },
  });
  console.log(await kit.collect('context', { key: 'private:1', hasBiliLink: true }));
  console.log(await kit.veto('gate', { key: 'private:1', reason: 'manual' }));
  console.log(await kit.transform('transform', {}, 'a\nb\na'));
  console.log(kit.stateKeys({ key: 'private:1' }));
  console.log(renderHooksDoc(kit).split('\n').slice(0, 8).join('\n'));
}

# hook-kit

[![ci](https://github.com/baizhi06/hook-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/baizhi06/hook-kit/actions/workflows/ci.yml)

> 给「已经长歪的机器人插件」装四个接口：**接入 / 决策 / 上下文 / 回执**。
> 零依赖、纯 ESM、Node 18+，配一张由代码生成的登记表（`HOOKS.md`）。

很多 QQ 机器人插件都是同一个路径长出来的：一开始在内联补丁里加功能，加到最后变成

- 决策入口十几处（新消息、补唤醒、定时器、重试、主动机会各走各的）；
- 发送出口几十处（每处自己限流、自己脱敏）；
- 提示词块七个函数，硬编码在一行 `return [a, b, c]` 里；
- 生成后没有出口，清理逻辑散在几处。

结果每加一个功能都要改装配代码，每次升级上游都要手工合并。

这个包不重构你的业务，只提供**四个接口 + 一张登记表 + 一条失败隔离规则**，让功能自己声明「我插在哪一层」。

## 安装

```bash
npm i hook-kit
# 或者直接把这个仓库当文件用：复制 src/index.mjs 到你项目里
```

## 最小用法

```js
import { createHookKit, renderHooksDoc } from 'hook-kit';

const kit = createHookKit({
  onError: (err, info) => log(`扩展 ${info.interfaceName}/${info.id} 出错：${err.message}`),
});

// ① 上下文：记忆块（只读、影响缓存）
kit.register('context', 'memory', (ctx) => loadMemory(ctx.key), {
  order: 10, invalidatesCache: true, stateKey: (ctx) => `${memoryVersion()}:${ctx.key}`,
});

// ② 决策：静音闸门（手动唤醒放行）
kit.register('gate', 'quiet', (ctx) => {
  if (ctx.reason === 'manual') return { allow: true };
  return isQuiet(ctx.key) ? { allow: false, reason: '静音中' } : { allow: true };
}, { order: 10 });

// ③ 生成后：截断与去重
kit.register('transform', 'trim', (_ctx, text) => text.slice(0, 800), { access: 'write' });

// ④ 发送后：额度记账
kit.register('afterSend', 'ledger', (ctx) => recordUsage(ctx), { access: 'write' });

// 调用
await kit.run('incoming', ctx);                       // 观察者
const veto = await kit.veto('gate', ctx);             // null = 放行
const blocks = await kit.collect('context', ctx);     // string[]
const text = await kit.transform('transform', ctx, modelOutput);
await kit.run('afterSend', ctx);

// 缓存键：拼进你自己的提示词缓存里
const cacheKey = `prompt:${kit.stateKeys(ctx).join('|')}`;

// 登记表：直接写进 HOOKS.md
fs.writeFileSync('docs/HOOKS.md', renderHooksDoc(kit));
```

## 四个接口

| 接口 | 语义 | 返回值 |
| --- | --- | --- |
| `incoming` | 收到消息，观察 | 无 |
| `gate` | 要不要醒 / 要不要说 | `{ allow, reason }` |
| `context` | 提示词里塞什么 | 字符串或字符串数组 |
| `transform` | 生成后清理 | 改写后的字符串 |
| `afterSend` | 发送后回调 | 无 |

「四层」里 `gate` 就是决策层，`context` 是上下文层；`transform` 是很多人缺的那一格。

## 三条硬约定

1. **失败隔离**：每个扩展单独 try/catch，坏一个不拖垮主流程，错误进 `onError`；
2. **保命层不进接口**：限流、审计、去重、日志脱敏留在主干唯一的发送函数里；
3. **缓存要能感知**：读文件的扩展必须声明 `invalidatesCache`，把 `stateKeys()` 拼进缓存键，否则会读到旧内容。

## 登记表

`describe({ format: 'md' })` 直接产出：

| 接口 | 注册者 | 读写 | 影响缓存 | 顺序 | 说明 |
| --- | --- | --- | --- | --- | --- |
| context | memory | 只读 | 是 | 10 | 记忆卡（按会话） |
| gate | quiet | 只读 | 否 | 10 | 静音/学习模式 |
| transform | trim-dupe | 改写 | 否 | 10 | 截断与去重 |
| afterSend | ledger | 改写 | 否 | 10 | 额度记账 |

这张表是给三个月后的自己和接手的人看的：谁在改提示词、谁影响缓存、谁排第几。

## 自检

```bash
npm test          # 单元测试（顺序 / 失败隔离 / 闸门 / 链式改写 / 缓存键 / 登记表）
npm run verify    # 语法 + 测试 + 打印登记表
npm run doc       # 重写 docs/HOOKS.md
```

## 迁移顺序

别一次重构上百处，按 `docs/MIGRATION.md` 的五步来：先登记、再抽空接口、再逐块迁、再动行为、最后冻结接口存基线。

## 不要抄的部分

- 整份补丁直接打：别人的补丁长在单个部署实例上，函数名和状态路径都不一样；
- 3D 可视化：2D 够用；
- 「接口越多越好」：**功能接口**越多越好接，**装配接口**越少越好维护，这两句混在一起就会打架。

## License

MIT

> **这个仓库已改名为 [four-point-hooks](https://github.com/baizhi06/four-point-hooks)。**
> 新版把接口从五个收敛成四个（接入 / 决策 / 上下文 / 回执），并带上开关面板与基线检查。
> 这里的 hook-kit 0.1.0 留作存档，不再更新。

# hook-kit —— 把插件功能插在接口上，别散在主干里

[!\[ci](https://github.com/baizhi06/hook-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/baizhi06/hook-kit/actions/workflows/ci.yml)
[!\[node](https://img.shields.io/badge/node-18%2B-3c873a)](https://nodejs.org)
[!\[license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> \*\*这是一个接口层，不是框架，也不重构你的业务。\*\*
> 它只做一件事：给「已经长歪的插件」装上四个固定接口，让功能自己声明「我插在哪一层」。
>
> 零依赖、纯 ESM、Node 18+，一共 9 KB。配一张\*\*由代码生成的登记表\*\*，谁在改提示词、谁影响缓存、谁排第几，一眼看完。
>
> English: \*A 9 KB zero-dependency hook layer for chat-bot plugins that have grown into inline patches.
> Five interfaces (incoming / gate / context / transform / afterSend) with explicit ordering,
> read-write access, cache invalidation rules, per-extension failure isolation, and a registry
> table generated from code.\*

\---

## 一眼看懂：我解决的 3 个问题

|症状|不装接口的样子|装完接口之后|
|-|-|-|
|加个新功能就得改装配代码|决策入口十几处、发送出口几十处，每处自己限流自己脱敏|功能在自己的文件里 `register()`，装配代码一行不动|
|升级上游要手工合并一堆补丁|100+ 处内联，函数名和状态路径全绑死在单个实例上|只保留**插口**那几行，其余都是独立模块|
|三个月后没人知道谁改了什么|靠记忆和 `git log` 考古|`HOOKS.md` 由代码生成：接口 / 注册者 / 只读还是改写 / 是否影响缓存 / 顺序|

\---

## 功能清单

### 1\. 五个接口

|接口|语义|返回值|典型注册者|
|-|-|-|-|
|`incoming`|收到消息，观察|无|统计、样本收集|
|`gate`|要不要醒 / 要不要说|`{ allow, reason }`|静音、学习模式、频率闸门|
|`context`|提示词里塞什么|字符串或字符串数组|记忆块、抽帧说明|
|`transform`|生成后清理|改写后的字符串|截断、去重、安全检查|
|`afterSend`|发送后回调|无|额度记账、捕获待办|

`gate` 是决策层，`context` 是上下文层，`transform` 是很多人缺的那一格（生成完文本没地方清理，只能塞进发送函数）。

### 2\. 三条硬约定

* **失败隔离**：每个扩展单独 try/catch，坏一个不拖垮主流程，错误进 `onError(err, { interfaceName, id, phase })`。
* **保命层不进接口**：限流、审计、去重、日志脱敏留在主干唯一的发送函数里。这些要是也能被插件改，出事就没人兜底。
* **缓存要能感知**：读文件的扩展必须声明 `invalidatesCache`，把 `stateKeys(ctx)` 拼进你自己的缓存键，否则会读到旧内容。

### 3\. 登记表（由代码生成）

```bash
node verify.mjs --write-doc    # 重写 docs/HOOKS.md
```

|接口|注册者|读写|影响缓存|顺序|说明|
|-|-|-|-|-|-|
|gate|quiet|只读|否|10|静音 / 学习模式|
|context|memory|只读|是|10|记忆卡（按会话）|
|context|bili-frames|只读|否|20|抽帧说明|
|transform|trim-dupe|改写|否|10|截断与去重|
|afterSend|ledger|改写|否|10|额度记账|

手改这张表会被下次生成覆盖——要改就改 `register()` 的 meta。

### 4\. 自检

```bash
npm test           # 9 个用例：顺序 / 失败隔离 / 闸门首个否决 / 手动唤醒放行 / 链式改写 / 缓存键 / 登记表 / 缺接口报错
npm run verify     # 语法 + 单测 + 打印登记表
npm run doc        # 重写 docs/HOOKS.md
```

CI 跑 Node 18 / 20 / 22 三档，徽章在上面。

\---

## 最小接入

```js
import { createHookKit, renderHooksDoc } from 'hook-kit';

const kit = createHookKit({
  onError: (err, info) => log(`扩展 ${info.interfaceName}/${info.id} 出错：${err.message}`),
});

// 记忆块：只读、影响缓存
kit.register('context', 'memory', (ctx) => loadMemory(ctx.key), {
  order: 10,
  invalidatesCache: true,
  stateKey: (ctx) => `${memoryVersion()}:${ctx.key}`,
});

// 静音闸门：手动唤醒放行
kit.register('gate', 'quiet', (ctx) => {
  if (ctx.reason === 'manual') return { allow: true };
  return isQuiet(ctx.key) ? { allow: false, reason: '静音中' } : { allow: true };
}, { order: 10 });

// 生成后：截断
kit.register('transform', 'trim', (\_ctx, text) => text.slice(0, 800), { access: 'write' });

// 发送后：记账
kit.register('afterSend', 'ledger', (ctx) => recordUsage(ctx), { access: 'write' });

// 主干上的四个调用点
await kit.run('incoming', ctx);
const veto = await kit.veto('gate', ctx);            // null = 放行
const blocks = await kit.collect('context', ctx);    // string\[]
const text = await kit.transform('transform', ctx, modelOutput);
await kit.run('afterSend', ctx);

// 缓存键带上状态，登记表写进文档
const cacheKey = `prompt:${kit.stateKeys(ctx).join('|')}`;
fs.writeFileSync('docs/HOOKS.md', renderHooksDoc(kit));
```

接进一个已经有主干的老插件，别一次重构上百处——按 [`docs/MIGRATION.md`](docs/MIGRATION.md) 的五步来：量入口 → 登记 → 抽空接口跑基线 → 逐块迁 → 最后才冻接口。

\---

## 文档索引

|想看什么|去哪|
|-|-|
|接口签名、meta 字段、错误对象长什么样|[`src/index.mjs`](src/index.mjs)（单文件，带注释）|
|怎么把它接进一个现有的桥接|[`examples/wire-into-bridge.mjs`](examples/wire-into-bridge.mjs)|
|五步迁移、八条前人踩过的坑|[`docs/MIGRATION.md`](docs/MIGRATION.md)|
|登记表样例|[`docs/HOOKS.md`](docs/HOOKS.md)|

\---

## 已验证环境

|项目|状态|
|-|-|
|Node|18 / 20 / 22（CI 三档全绿）|
|依赖|0 个，只有 Node 内置模块|
|模块格式|纯 ESM（`.mjs`）|
|使用场景|单进程聊天机器人插件的主干；也可单独当小型事件总线用|

\---

## 三条「别抄」

* **别整份打别人的补丁**：别人的补丁长在单个部署实例上，函数名和状态路径都不一样，打进来只会更难维护。
* **别把装配接口也做成插件**：功能接口越多越好接，装配接口越少越好维护——这两句混在一起就会打架。
* **别急着上可视化**：登记表现在是一张 markdown 表，够用。星图、时间轴留给业务面板，不属于接口层。

## License

MIT


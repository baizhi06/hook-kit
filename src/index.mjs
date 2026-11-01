/**
 * hook-kit —— 给「已经长歪的机器人插件」装四个接口
 *
 * 解决的是同一个病：决策入口十处、发送出口几十处、提示词块硬编码在一行 return 里、
 * 生成后没有出口。结果每加一个功能都要改装配代码，每次升级都要手工合并。
 *
 * 核心主张：
 *   1. 功能与接线分开 —— 功能自己声明在哪个接口插进来，装配代码不动；
 *   2. 保命层不进接口 —— 限流、审计、去重、日志、脱敏留在主干；
 *   3. 失败隔离 —— 一个扩展坏了不许拖垮主流程；
 *   4. 可复核 —— describe() 直接生成 HOOKS.md，stateKeys() 直接喂缓存。
 *
 * 零依赖，纯 ESM，Node 18+。
 */

/** 五个接口类型。前四个对应「接入 / 决策 / 上下文 / 回执」，transform 是生成后的清理口。 */
export const INTERFACES = Object.freeze({
  incoming: '收到消息（观察者，不返回值，不能改内容）',
  gate: '决策闸门（返回 { allow:false, reason } 就拦下这次唤醒；多个扩展时第一个否决即生效）',
  context: '生成前（返回字符串或字符串数组，按顺序拼进提示词）',
  transform: '生成后（拿到模型输出，返回改写后的文本，可截断/去重/安全检查）',
  afterSend: '发送后（回调，不返回值，适合记账/捕获待办）',
});

export const INTERFACE_NAMES = Object.freeze(Object.keys(INTERFACES));

/** 登记表里「读写」一栏的取值。 */
export const ACCESS = Object.freeze({ READ: 'read', WRITE: 'write' });

const DEFAULTS = Object.freeze({
  order: 100,
  access: ACCESS.READ,
  invalidatesCache: false,
  description: '',
});

function assertInterface(name) {
  if (!INTERFACE_NAMES.includes(name)) {
    throw new Error(`未知接口 "${name}"；可选：${INTERFACE_NAMES.join(' / ')}`);
  }
}

function normalizeText(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((x) => typeof x === 'string' && x.trim());
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return [];
}

/**
 * 建一个接口中枢。
 *
 * @param {object} [options]
 * @param {(error: Error, info: {interfaceName: string, id: string, phase: string}) => void} [options.onError]
 *        扩展抛错时的回调。默认只往 stderr 打一行（不会中断主流程）。
 * @param {(line: string) => void} [options.logger] 调试输出。
 * @returns 中枢对象（见下方 return）。
 */
export function createHookKit(options = {}) {
  const onError = typeof options.onError === 'function'
    ? options.onError
    : (error, info) => {
      try {
        process.stderr.write(`[hook-kit] ${info.interfaceName}/${info.id} 抛错：${error?.message ?? error}\n`);
      } catch {}
    };
  const logger = typeof options.logger === 'function' ? options.logger : null;

  /** @type {Map<string, Map<string, object>>} */
  const tables = new Map(INTERFACE_NAMES.map((name) => [name, new Map()]));
  let sequence = 0;

  function table(name) {
    assertInterface(name);
    return tables.get(name);
  }

  function sorted(name) {
    return [...table(name).values()].sort((a, b) => (a.order - b.order) || (a.seq - b.seq));
  }

  function guard(name, entry, phase, fn) {
    try {
      return fn();
    } catch (error) {
      onError(error, { interfaceName: name, id: entry.id, phase });
      return undefined;
    }
  }

  const kit = {
    /**
     * 注册一个扩展。
     * @param {string} name 接口名（incoming / gate / context / transform / afterSend）
     * @param {string} id 唯一名，也是 HOOKS.md 里的「注册者」和缓存键的一部分
     * @param {Function} fn 处理函数
     * @param {object} [meta]
     * @param {number} [meta.order] 顺序，小的先跑；相同则按注册先后
     * @param {'read'|'write'} [meta.access] 只读还是改写（写进登记表，供人复核）
     * @param {boolean} [meta.invalidatesCache] 为 true 时，它的 id 会进 stateKeys()
     * @param {(ctx: any) => string} [meta.stateKey] 动态缓存键片段
     * @param {string} [meta.description] 一句说明，写进 HOOKS.md
     */
    register(name, id, fn, meta = {}) {
      assertInterface(name);
      if (typeof id !== 'string' || !id.trim()) throw new Error('id 不能为空');
      if (typeof fn !== 'function') throw new Error(`扩展 ${id} 的 fn 必须是函数`);
      const entry = {
        id: id.trim(),
        fn,
        order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : DEFAULTS.order,
        access: meta.access === ACCESS.WRITE ? ACCESS.WRITE : ACCESS.READ,
        invalidatesCache: meta.invalidatesCache === true,
        stateKey: typeof meta.stateKey === 'function' ? meta.stateKey : null,
        description: String(meta.description ?? DEFAULTS.description),
        seq: ++sequence,
        interfaceName: name,
      };
      table(name).set(entry.id, entry);
      logger?.(`[hook-kit] 注册 ${name}/${entry.id} order=${entry.order}`);
      return kit;
    },

    unregister(name, id) {
      return table(name).delete(String(id ?? '').trim());
    },

    /** 观察者：按顺序跑，忽略返回值。 */
    async run(name, ctx) {
      for (const entry of sorted(name)) {
        await guard(name, entry, 'run', () => entry.fn(ctx));
      }
    },

    /**
     * 决策：按顺序问每个闸门。
     * 任何一个返回 { allow:false } 就立即停下并返回它（reason 一并带回）。
     * 返回 null 表示没人反对。
     */
    async veto(name, ctx) {
      for (const entry of sorted(name)) {
        const result = await guard(name, entry, 'veto', () => entry.fn(ctx));
        if (result && result.allow === false) {
          return { allow: false, reason: result.reason ?? '', id: entry.id };
        }
      }
      return null;
    },

    /** 生成前：收集所有扩展产出的文字块，按顺序拼成数组。 */
    async collect(name, ctx) {
      const out = [];
      for (const entry of sorted(name)) {
        const value = await guard(name, entry, 'collect', () => entry.fn(ctx));
        out.push(...normalizeText(value));
      }
      return out;
    },

    /** 生成后：链式改写文本。扩展拿到当前值，返回新值；返回空则保持原样。 */
    async transform(name, ctx, input) {
      let current = input;
      for (const entry of sorted(name)) {
        const value = await guard(name, entry, 'transform', () => entry.fn(ctx, current));
        if (typeof value === 'string') current = value;
      }
      return current;
    },

    /**
     * 影响缓存的键：所有声明 invalidatesCache 的扩展，加上它们的动态 stateKey(ctx)。
     * 拼进你自己的提示词缓存键里，就能避免「读到旧内容」。
     */
    stateKeys(ctx) {
      const keys = [];
      for (const name of INTERFACE_NAMES) {
        for (const entry of sorted(name)) {
          if (!entry.invalidatesCache) continue;
          keys.push(`${name}:${entry.id}`);
          if (entry.stateKey) {
            try {
              const extra = entry.stateKey(ctx);
              if (extra) keys.push(`${name}:${entry.id}:${extra}`);
            } catch (error) {
              onError(error, { interfaceName: name, id: entry.id, phase: 'stateKey' });
            }
          }
        }
      }
      return keys.sort();
    },

    /** 列出某个接口下的扩展（按执行顺序）。 */
    entries(name) {
      return sorted(name).map(({ fn, seq, ...rest }) => ({ ...rest }));
    },

    /** 全部扩展 + 登记表。format: 'json' | 'md' */
    describe({ format = 'json' } = {}) {
      const rows = [];
      for (const name of INTERFACE_NAMES) rows.push(...sorted(name));
      if (format === 'json') {
        return rows.map(({ fn, seq, ...rest }) => ({ ...rest, order: rest.order }));
      }
      const lines = [
        '| 接口 | 注册者 | 读写 | 影响缓存 | 顺序 | 说明 |',
        '| --- | --- | --- | --- | --- | --- |',
      ];
      for (const row of rows) {
        lines.push(`| ${row.interfaceName} | ${row.id} | ${row.access === ACCESS.WRITE ? '改写' : '只读'} | ${row.invalidatesCache ? '是' : '否'} | ${row.order} | ${row.description || '—'} |`);
      }
      return lines.join('\n');
    },

    clear() {
      for (const name of INTERFACE_NAMES) tables.get(name).clear();
    },
  };

  return kit;
}

/** 生成一份完整的 HOOKS.md（接口说明 + 登记表）。 */
export function renderHooksDoc(kit, { title = 'HOOKS', intro = '' } = {}) {
  const parts = [`# ${title}`, ''];
  if (intro) parts.push(intro, '');
  parts.push('## 接口一览', '', '| 接口 | 语义 |', '| --- | --- |');
  for (const [name, doc] of Object.entries(INTERFACES)) parts.push(`| \`${name}\` | ${doc} |`);
  parts.push('', '## 登记表', '', kit.describe({ format: 'md' }), '');
  parts.push('> 这张表由代码生成：`node verify.mjs --write-doc`。手改会被下次覆盖，要改就改 `register()` 的 meta。');
  return parts.join('\n');
}

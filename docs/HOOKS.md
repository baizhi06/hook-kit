# HOOKS

> 这张表由 `node verify.mjs --write-doc` 生成。

## 接口一览

| 接口 | 语义 |
| --- | --- |
| `incoming` | 收到消息（观察者，不返回值，不能改内容） |
| `gate` | 决策闸门（返回 { allow:false, reason } 就拦下这次唤醒；多个扩展时第一个否决即生效） |
| `context` | 生成前（返回字符串或字符串数组，按顺序拼进提示词） |
| `transform` | 生成后（拿到模型输出，返回改写后的文本，可截断/去重/安全检查） |
| `afterSend` | 发送后（回调，不返回值，适合记账/捕获待办） |

## 登记表

| 接口 | 注册者 | 读写 | 影响缓存 | 顺序 | 说明 |
| --- | --- | --- | --- | --- | --- |
| gate | quiet | 只读 | 否 | 10 | 静音/学习模式 |
| context | memory | 只读 | 是 | 10 | 记忆卡（按会话） |
| context | bili-frames | 只读 | 否 | 20 | 抽帧说明 |
| transform | trim-dupe | 改写 | 否 | 10 | 截断与去重 |
| afterSend | ledger | 改写 | 否 | 10 | 额度记账 |

> 这张表由代码生成：`node verify.mjs --write-doc`。手改会被下次覆盖，要改就改 `register()` 的 meta。

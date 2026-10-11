# 02. 协议设计

## 1. 协议原则

`protocols` 是跨层通信的唯一共享语言。任何新事件或命令必须先在协议层定义，再实现生产者和消费者。

协议需要同时满足：

- TypeScript 编译期类型约束。
- zod 运行时校验。
- 前后端共享。
- 事件可追加、可回放、可测试。

## 2. 事件 Envelope

所有服务端到客户端事件都共享同一组元字段：

| 字段 | 说明 |
| --- | --- |
| `type` | 事件名，使用 `noun.verb`。 |
| `sessionId` | 会话 ID。 |
| `ts` | 事件产生时间戳。 |
| `agentId` | Agent 实例 ID。 |
| `owner` | 本地用户或会话所有者。 |
| `payload` | 事件体，按 `type` 区分。 |

事件不可变，只能追加到 `events.jsonl`。

## 3. 服务端到客户端事件

| 事件 | Payload | 生产者 | 消费者 |
| --- | --- | --- | --- |
| `session.created` | `sessionId` | `server` | `clients`, `store` |
| `session.attached` | `sessionId`, `replayFrom?` | `server` | `clients` |
| `user.message` | `text` | `server` | `clients`, `store` |
| `turn.started` | `goal` | `core` via `server` | `clients`, `store` |
| `turn.completed` | `answer` | `core` via `server` | `clients`, `store` |
| `turn.interrupted` | empty | `server` or `core` | `clients`, `store` |
| `message.delta` | `messageId`, `text` | `llm`/`core` via `server` | `clients`, `store` |
| `message.completed` | `messageId`, `role`, `content` | `core` | `clients`, `store` |
| `tool.started` | `toolCallId`, `tool`, `args` | `core` | `clients`, `store` |
| `tool.finished` | `toolCallId`, `tool`, `result?`, `error?` | `core` | `clients`, `store` |
| `approval.requested` | `approvalId`, `tool`, `args`, `timeoutMs` | `server` | `clients`, `store` |
| `approval.resolved` | `approvalId`, `approved` | `server` | `clients`, `store` |
| `error` | `message`, `code?` | 任意层经 `server` | `clients`, `store` |

## 4. 客户端到服务端命令

| 命令 | Payload | 发送者 | 处理者 |
| --- | --- | --- | --- |
| `session.create` | empty | `clients` | `server` |
| `session.attach` | `sessionId`, `since?` | `clients` | `server` |
| `message.send` | `sessionId`, `text` | `clients` | `server` |
| `approval.respond` | `approvalId`, `approved` | `clients` | `server` |
| `interrupt` | `sessionId` | `clients` | `server` |

## 5. 校验边界

必须校验的位置：

1. `client` 发送命令前校验。
2. `server` 接收命令时校验。
3. `server` 广播事件前校验。
4. `store` 写入事件前校验。
5. `replay` 读取历史事件时校验。

不允许在跨层调用中传裸对象。即使同进程内调用，只要穿过层边界，也必须以协议类型为准。

## 6. 事件演进规则

- 新增字段必须可选，除非新建事件类型。
- 不删除已有事件类型。
- 不改变已有字段含义。
- 不在 UI 层推断未定义字段。
- 破坏性协议变更必须提供 replay 迁移策略。

## 7. 阶段 1 协议范围

阶段 1 只需要完成协议定义和最小启动验证：

- 建立事件与命令 schema。
- 导出协议类型。
- 提供解析函数或校验入口。
- 不实现业务逻辑。
- 不实现真实网络通信细节之外的 Agent 行为。

## 8. 消息内容块与工具图片结果

多模态内容同样先在协议层定义，再实现生产者和消费者。

`src/protocols/content.ts` 定义消息内容块：

| 块 | 字段 | 说明 |
| --- | --- | --- |
| `text` | `text` | 纯文本片段。 |
| `image` | `data`, `mimeType` | Base64 图片字节与其 MIME 类型。 |

`Message.content` 的取值为 `string | ContentPart[]`：单模态消息保持字符串，包含图片时使用内容块数组。

工具图片结果的约定：

1. 工具在结果里附带 `image`（`type`/`data`/`mimeType`）字段。
2. `core` 识别该字段，将图片作为一条 `user` 消息发给模型。
3. `core` 从工具消息和 `tool.finished` 事件中剥离 Base64，事件只保留 `path`、`mimeType`、`bytes`、`resized` 等元数据。

设计理由：

- 图片不进入 `events.jsonl`，避免 Base64 撑大会话记录。
- 图片作为独立 `user` 消息，不依赖任何 provider 对工具结果多模态内容的支持。
- provider 负责把内容块适配成各自线格式（如 OpenAI 的 `image_url` data URL），`core` 不感知线格式。
- `clients` 只能渲染事件中的元数据，不渲染图片字节。
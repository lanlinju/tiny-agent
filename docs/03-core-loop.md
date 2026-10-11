# 03. Core Loop 设计

## 1. 设计目标

`core` 的主循环保持极简：把消息交给 LLM，执行工具调用，把工具结果写回消息，再继续请求 LLM，直到没有工具调用。

`core` 不认识：

- HTTP。
- WebSocket。
- CLI 或 Web UI。
- 文件系统细节。
- 会话落盘格式。
- 审批策略配置。

## 2. Core 只依赖的抽象

| 抽象 | 来源层 | 用途 |
| --- | --- | --- |
| `LLMProvider` | `llm` | 调用 `chat` 得到 assistant 消息。 |
| `ToolRegistry` / tool schemas | `tools` | 暴露工具 schema 并执行指定工具。 |
| `Emitter` | `core/types`，由 `server` 注入实现 | 发出事件，不关心事件如何广播或落盘。 |
| `ApprovalRequester` | `core/types`，由 `server` 注入实现 | 请求审批，不关心 CLI/Web 如何响应。 |
| `Memory` / compaction hook | `core` 可选模块 | 控制上下文压缩，不污染主循环。 |

## 3. 主循环步骤

1. 组装 system、history、user goal。
2. 发出 `turn.started`。
3. 如超过上下文阈值，调用可选压缩钩子。
4. 调用 `LLMProvider.chat`。
5. 追加 assistant message。
6. 发出 `message.completed` 或流式 `message.delta`。
7. 如果没有 tool call，发出 `turn.completed` 并返回。
8. 如果有 tool call，逐个发出 `tool.started`。
9. 对需要审批的工具，请求 `server` 层审批。
10. 执行工具，将结果或错误作为 tool message 反馈给 LLM。
11. 发出 `tool.finished`。
12. 重复直到完成或超过最大步数。

## 4. 错误处理原则

- 工具失败不直接中断主循环。
- 工具失败会转换成 tool result，让 LLM 有机会修正。
- 超过最大步数时发出 `error` 事件并抛出错误。
- `catch` 不允许静默吞掉异常，必须通过事件或日志暴露。

## 5. 审批边界

`core` 可以询问“这个工具调用是否需要审批”，但不拥有审批策略。

审批策略属于 `server`：

| 工具 | 默认策略 |
| --- | --- |
| `read` | 默认放行 |
| `shell` | 需要审批 |
| `write` | 需要审批 |
| `edit` | 需要审批 |

这样可以保持工具定义纯净，也能让不同运行环境使用不同审批策略。

## 6. 与 pi 风格的关系

本项目采用 pi-style 的最小 ReAct loop：

- 主循环只围绕 messages 和 tool calls。
- 工具、审批、上下文压缩都通过上下文钩子注入。
- 规划和记忆是装饰层，不改变主循环核心职责。
- 所有可观察行为都变成事件。
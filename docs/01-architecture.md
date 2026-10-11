# 01. 分层架构

## 1. 架构目标

本项目优先追求清晰的分层边界，而不是一次性实现完整功能。每一层只承担一个主要职责，并通过下层接口或共享协议通信。

## 2. 总览图

```text
┌────────────────────────────────────────────────────────────────────┐
│                            clients/                                │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐                │
│   │   CLI    │      │   Web    │      │  IDE/VSC │  ← 只做渲染    │
│   └────┬─────┘      └────┬─────┘      └────┬─────┘                │
└────────┼─────────────────┼─────────────────┼──────────────────────┘
         │                 │                 │
         │  事件流 ↓        │  命令 ↑         │   WebSocket
         └────────────┬────┴─────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────────────────┐
│                          server/                                   │
│   ws-handler / http-routes / event-bus / approval                  │
│   会话管理 / 广播 / 落盘协调 / 审批                                 │
└──────────────────────────────────┬────────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
┌─────────▼──────────┐   ┌─────────▼─────────┐   ┌──────────▼─────┐
│      core/         │   │      store/       │   │  plugins/      │
│  agent-loop        │   │  session-store    │   │  manager       │
│  planner/memory    │   │  replay           │   │  permissions   │
│  prompt/types      │   │  events/snapshot  │   │  受控扩展点     │
└─────────┬──────────┘   └───────────────────┘   └────────────────┘
          │
   ┌──────┴───────┐
   │              │
┌──▼────────┐ ┌───▼────────┐
│   llm/    │ │   tools/   │
│ provider  │ │ registry   │
│ openai    │ │ shell/read │
│ mock      │ │ write/edit │
│ anthropic │ │            │
└───────────┘ └────────────┘
          ▲
          │
   ┌──────┴──────────────────┐
   │      protocols/         │
   │   events / commands     │
   └─────────────────────────┘
```

## 3. 依赖方向

```text
clients ──► protocols ◄── server ──► core ──► llm
                                 │           └► tools
                                 ├──► store
                                 └──► plugins
```

只允许向下依赖：

- `clients` 可以依赖 `protocols`，不能依赖 `server`、`core`、`store`。
- `server` 可以依赖 `protocols`、`core`、`store`、`plugins`。
- `core` 可以依赖 `llm`、`tools` 的接口类型，不能依赖 `server`、`store`、`clients`。
- `tools` 不依赖 `server`，不内置审批策略。
- `store` 被动记录，不驱动业务流程。
- `protocols` 不依赖任何业务层。

## 4. 各层职责

| 层 | 只负责 | 不负责 |
| --- | --- | --- |
| `protocols` | 事件、命令、运行时校验 schema | 业务流程、网络、存储 |
| `clients` | `render(event)`、发送命令、UI 交互 | Agent 推理、工具执行、业务状态 |
| `server` | 会话、事件总线、审批、HTTP/WS、落盘协调 | LLM 决策细节、工具内部实现 |
| `core` | Agent loop、消息追加、工具调用编排、事件发射 | 网络、UI、文件系统、会话持久化 |
| `llm` | `chat` provider 适配 | prompt 业务策略、工具执行 |
| `tools` | 真实世界动作与 JSON Schema | 审批策略、会话状态、UI |
| `store` | `events.jsonl`、`snapshot`、replay | 修改历史事件、推理决策 |
| `plugins` | 受控扩展点、权限声明、加载/卸载生命周期 | 绕过审批、绕过协议 |

## 5. 核心数据流

1. `client` 发送 `message.send` 命令。
2. `server` 校验命令并找到目标 session。
3. `server` 调用 `core`，传入 `RunContext`。
4. `core` 通过 `LLMProvider.chat` 获取 assistant 消息。
5. 如果出现 tool call，`core` 通过上下文请求审批并调用工具。
6. 所有关键动作都发出事件。
7. `server` 广播事件并协调 `store` 追加写入。
8. `client` 只根据事件渲染 UI。

## 6. 新增文件归属规则

新增文件时必须说明：

- 属于哪一层。
- 依赖哪些下层接口或协议。
- 被哪些上层使用。
- 是否产生跨进程或跨层数据；如果是，必须先进入 `protocols`。
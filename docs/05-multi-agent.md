# 05. 多 Agent 设计

## 1. 设计目标

多 Agent 的关键不是“复制多个 Loop”，而是在**保持单 Agent Loop 不变**的前提下，在外面加一层编排与消息传递。

对应到本项目的既有原则：

- `core` 不认识网络，因此也不认识“其他 Agent”。
- `agent-loop` 只负责“某个 Agent 的一次推理循环”。
- Agent 之间只通过**工具**和**事件**交互，不直接互相 import。
- 所有跨 Agent 的可见行为都必须先进入 `protocols`，再实现生产者和消费者。

一句话：多 Agent = 单 Agent Loop + Agent 注册表 + 委派工具 + 带 `agentId` 的事件流。

## 2. 协作模式与 MVP 选择

多 Agent 有五种典型协作模式，先选模式，再谈实现。

| 模式 | 结构 | 适合场景 | 决策者 |
| --- | --- | --- | --- |
| Supervisor | 一个主 Agent 分派子任务 | 任务可分解 | 主 Agent 的 LLM |
| Handoff | Agent 之间直接交接 | 客服、流程流转 | 当前 Agent |
| Group Chat | 多 Agent 群聊、轮流发言 | 辩论、评审 | 一个 selector |
| Pipeline | planner → executor → reviewer | 固定流程 | 代码 |
| Hierarchical | 多层 Supervisor | 复杂组织 | 上层 Agent |

**MVP 从 Supervisor 开始**，理由：

1. 复用现有架构最多。
2. 一个 session 已有事件总线，天然能汇聚多 Agent 事件。
3. 只需要新增“委派”这一个工具即可闭环。

其余模式作为后续可插拔的编排实现，共享同一套 Agent 定义、运行时和协议，不改变核心 Loop。

## 3. 架构变化（在原有图上的增量）

```text
┌─────────────────────────────────────────────────────────────┐
│                        clients/                             │
│   CLI / Web —— 事件流里带 agentId，按 Agent 分组渲染          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                        server/                              │
│   event-bus  ←── 所有 Agent 的事件都汇聚到这里               │
│   session    ←── 一个 session 可挂多个 Agent                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
│ orchestration/ │ │   core/        │ │  messaging/    │
│  supervisor    │ │  agent-loop    │ │  mailbox       │
│  handoff       │ │  agent-runtime │ │  channel       │
│  group-chat    │ │  agent-registry│ │                │
└───────┬────────┘ └───────┬────────┘ └───────┬────────┘
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                  ┌────────▼────────┐
                  │   tools/        │
                  │  ...            │
                  │  delegate  ←── 新增：Agent 调 Agent
                  │  send_message   │  新增：异步消息
                  └─────────────────┘
```

关键点：

- `core/agent-loop` 一行不改，它只是“某个 Agent 的循环”。
- 新增 `orchestration/` 决定“谁来跑、跑几个、怎么协调”。
- 新增 `messaging/` 处理 Agent 之间的消息。
- Agent 之间通过 `delegate` / `send_message` 两个工具交互，不直接互相引用。

## 4. 目录扩展

```text
src/
├── core/
│   ├── agent-loop.ts          # 不变（单 Agent 循环）
│   ├── agent-runtime.ts       # 新增：Agent 实例的运行时包装
│   ├── agent-registry.ts      # 新增：Agent 定义注册表
│   └── ...
├── orchestration/             # 新增：多 Agent 编排
│   ├── supervisor.ts          # 主 Agent 调度子 Agent
│   ├── handoff.ts             # Agent 间交接
│   ├── group-chat.ts          # 群聊式
│   ├── pipeline.ts            # 流水线式
│   └── types.ts
├── messaging/                 # 新增：Agent 间消息
│   ├── mailbox.ts             # 每个 Agent 的收件箱
│   └── channel.ts             # Agent 之间的命名通道
└── tools/builtin/
    ├── delegate.ts            # 把任务派给另一个 Agent
    └── send-message.ts        # 给另一个 Agent 发消息（异步）
```

## 5. 依赖与边界

在原有依赖方向上新增两条规则，且不允许反向依赖：

```text
server ──► orchestration ──► core ──► llm / tools
                 │
                 └──► messaging
tools(delegate) ──► orchestration（只通过接口/回调注入，不 import 具体编排实现）
```

| 层 | 只负责 | 不负责 |
| --- | --- | --- |
| `core/agent-registry` | 保存 Agent 定义（数据）、按 id 查询、列出全部 | 实例化 LLM、执行工具、编排 |
| `core/agent-runtime` | 把一个 Agent 定义包装成可 `run(goal)` 的循环实例，注入 `agentId` | 决定由谁运行、何时运行 |
| `orchestration` | 选择模式、决定谁跑、创建子 Agent、收敛结果 | 修改单 Agent Loop、直接操纵 UI |
| `messaging` | Agent 之间的收件箱与命名通道 | 业务编排、持久化 |
| `tools/delegate` | 把“调用另一个 Agent”表达成一个普通工具 | 了解目标 Agent 的内部实现 |
| `server` | 会话、事件总线、审批、落盘协调 | 多 Agent 决策逻辑 |

核心约束：

- `core` 不依赖 `orchestration`、`messaging`、`server`。
- `orchestration` 可以依赖 `core` 的运行时接口与 `messaging`。
- `tools` 不直接 import 具体编排实现，`delegate` 通过注入的编排接口回调。
- 新增任何跨 Agent 数据，必须先进入 `protocols`。

## 6. 核心概念

### 6.1 Agent 定义（不是实例）

Agent 定义是**数据**，运行时实例是**对象**。区分的目的是让 Agent 能被插件注册、被配置覆盖、被编排层按需实例化。

| 字段 | 含义 |
| --- | --- |
| `id` | Agent 类型标识，如 `researcher`、`coder` |
| `role` | 显示名 |
| `systemPrompt` | 角色边界与职责说明 |
| `tools` | 允许使用的工具 allowlist |
| `llm` | 可选：使用哪个 LLM |
| `maxSteps` | 可选：单次运行最大步数 |
| `budget` | 可选：token / 成本预算 |

注册表只保存定义，不做运行。

### 6.2 Agent 运行时

运行时负责把定义包装成一次可执行循环：

- 向单 Agent Loop 注入 `agentId`、system prompt、工具 allowlist、事件出口、收件箱。
- 复用既有 `RunContext` 的各钩子（`emit`、`callTool`、`requestApproval`、`maxSteps`）。
- 所有事件在发出时带上当前 `agentId`。

边界：运行时**不**决定“跑几个 Agent”，那是编排层的职责。

### 6.3 编排层

编排层决定“谁来跑、跑几个、怎么收敛”，并把结果通过事件暴露出来。不同模式是同一编排接口的不同实现。

### 6.4 消息传递

Agent 之间只通过两种机制通信：

| 机制 | 语义 | 用途 |
| --- | --- | --- |
| `delegate` | 同步，父等子，返回子结果 | MVP 主路径，任务分解 |
| `send_message` | 异步，不等待，写入收件箱 | 协同、补充信息（可选，后置） |

对调用方来说，`delegate` 就是一个普通工具；对被调用方来说，它就是一次普通的 `run()`。两边都不需要知道对方存在。

## 7. Supervisor 编排（MVP）

Supervisor 的结构：

1. 主 Agent（如 `supervisor`）本身就是一个 Agent 运行时。
2. 给主 Agent 挂上 `delegate` 工具。
3. 主 Agent 的 LLM 决定把哪些子任务派给哪些子 Agent。
4. 编排层收到委派请求后，实例化目标 Agent 的运行时并执行。
5. 子 Agent 结果作为工具返回值回到主 Agent。
6. 全过程的 `agent.spawned` / `agent.completed` / `agent.failed` 进入同一条事件流。

委派生命周期（编排层职责）：

| 阶段 | 行为 |
| --- | --- |
| 委派前 | 校验目标 Agent 是否存在、是否超出委派深度限制 |
| 创建 | 发 `agent.spawned`，实例化子运行时 |
| 运行 | 子 Agent 事件带自己的 `agentId` |
| 成功 | 发 `agent.completed`，把答案作为工具结果返回父 Agent |
| 失败 | 发 `agent.failed`，作为工具错误返回父 Agent，由父 Agent 决定重试或兜底 |

## 8. 协议设计

### 8.1 已有基础

事件 Envelope 已经包含 `sessionId`、`ts`、`agentId`、`owner`。这意味着 `agentId` 这个“多 Agent 分组维度”**已经存在**，多 Agent 主要是新增事件类型与可选字段，而不是改协议底座。

### 8.2 新增事件

| 事件 | Payload | 生产者 | 消费者 |
| --- | --- | --- | --- |
| `agent.spawned` | `parentId`, `agentId`, `goal` | `orchestration` via `server` | `clients`, `store` |
| `agent.completed` | `parentId`, `agentId`, `answer` | `orchestration` via `server` | `clients`, `store` |
| `agent.failed` | `parentId`, `agentId`, `error` | `orchestration` via `server` | `clients`, `store` |
| `agent.message` | `from`, `to`, `content` | `messaging` via `server` | `clients`, `store` |
| `agent.handoff` | `from`, `to`, `reason` | `orchestration` via `server` | `clients`, `store` |

### 8.3 Envelope 新增字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `agentId` | 已有 | 哪个 Agent 产生的事件 |
| `parentAgentId` | 新增，可选 | 父 Agent，用于还原调用树 |

新增字段必须可选，符合既有“事件演进规则”：

- 不删除已有事件类型。
- 不改变已有字段含义。
- 新增字段可选，除非新建事件类型。
- UI 不推断未定义字段。
- 破坏性变更必须提供 replay 迁移策略。

### 8.4 命令扩展

| 命令 | Payload | 说明 |
| --- | --- | --- |
| 暂不新增 | — | MVP 的多 Agent 由 LLM 通过 `delegate` 工具驱动，客户端无需新命令 |

后续若开放“手动指定 Agent / 手动 handoff”，再按协议先行原则新增命令。

## 9. 前端展示

前端不需要改协议，只是多了一个 `agentId` 分组维度：

- 按 `agentId` 把事件分到不同面板。
- 用 `parentAgentId` 还原调用树。
- 支持“只看某个 Agent”的过滤。

CLI：分层缩进，父 Agent 一条主线，子 Agent 以缩进块展示。

```text
[supervisor] 目标：写一个 CLI 计算器
[supervisor] 需要先研究需求 → delegate(researcher)
  [researcher] 目标：研究需求
  [researcher] read(requirements.md)
  [researcher] 返回：需要支持四则运算的 CLI
[supervisor] 让 coder 实现 → delegate(coder)
  [coder] 目标：实现计算器
  [coder] write(calc.ts)
  [coder] shell("tsc calc.ts")
  [coder] 返回：已实现
[supervisor] 完成
```

Web：每个 Agent 一个泳道或卡片，`agent.spawned` 时新建卡片，`agent.completed` 时收尾。

## 10. 进程内 vs 进程外

| 维度 | 进程内（推荐起步） | 进程外（分布式） |
| --- | --- | --- |
| 实现 | 一个 Node 进程，多个 Agent 运行时实例 | 每个 Agent 一个进程，通过 WS/gRPC |
| 通信 | 直接函数调用 / 内存收件箱 | 消息队列 / RPC |
| 事件 | 事件总线直接广播 | 需要 gateway 转发 |
| 优点 | 简单、快、易调试 | 隔离、可扩展、可异构 |
| 缺点 | 一个崩全崩 | 复杂、需要服务发现 |

演进路径：先用进程内，把 Agent 运行时抽象成**接口**；当某个 Agent 需要独立部署时，把它换成“远程运行时”，接口不变，编排层与工具层代码不改。

这与“client 换传输层”是同一思路。

## 11. 安全与限额（边界设计）

Agent 数量一多，安全与成本边界必须由编排层统一兜底，而不是散落在各个 Agent 里。

| 风险 | 表现 | 边界对策 |
| --- | --- | --- |
| 无限委派 | A 派给 B，B 派回 A | 限制调用深度 `depth`，超限报错 |
| 上下文爆炸 | 每个子 Agent 都塞全量历史 | 子 Agent 只拿自己的 goal + 必要共享上下文 |
| 事件淹没 | 多 Agent 事件混在一起 | 前端按 `agentId` 分组；服务端可过滤 |
| 审批冲突 | 多个 Agent 同时请求审批 | 按 `approvalId` 去重，一次只弹一个 |
| 状态共享 | Agent 想读对方记忆 | 显式通过 `delegate` 返回值或 `send_message` 传递，不共享内存 |
| 角色漂移 | 子 Agent 忘记自己的角色 | system prompt 中明确“你是 X，只做 Y” |
| 权限越界 | 子 Agent 使用未授权工具 | 工具 allowlist 由 Agent 定义强制约束 |
| 成本失控 | 子 Agent 层层调用 LLM | 每个 Agent 有 `maxSteps` 与 token 预算 |

原则：编排层是唯一的“资源与安全仲裁者”，与 `server` 是唯一审批层保持一致的分工。

## 12. 与已有架构的呼应

```text
单 Agent 时代：          多 Agent 时代：

agent-loop               agent-loop（不变）
   │                        │
   │                     agent-runtime（新增：注入 agentId）
   │                        │
   │                     orchestration（新增：决定谁跑）
   │                        │
   │                     delegate 工具（新增：Agent 调 Agent）
   │                        │
event-bus                event-bus（不变：只是事件多了 agentId / parentAgentId）
   │                        │
clients                  clients（不变：多了一个分组维度）
```

- 与“`core` 不认识网络”一致：Loop 不认识其他 Agent，只通过工具和事件交互。
- 与“client 换传输层”一致：Agent 运行时抽象成接口，进程内外可替换。
- 与“协议先行”一致：新增事件和字段先进入 `protocols`。

## 13. 阶段规划（接续原路线图）

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| 10 | 事件补齐 `agentId` 分组与 `parentAgentId`，前端按 Agent 分组渲染 | 单 Agent 场景不受影响，类型检查通过 |
| 11 | Agent 注册表 + Agent 运行时重构 | 原 Loop 代码零改动，既有测试全绿 |
| 12 | `delegate` 工具 + Supervisor 编排 | 主 Agent 能派任务给子 Agent，事件树可见 |
| 13 | 内置两个角色（researcher / coder） | 一个真实多 Agent 任务跑通 |
| 14 | 前端多 Agent 视图（CLI 缩进 / Web 分栏） | 能看清谁在做什么 |
| 15 | `send_message` + 收件箱（可选） | Agent 之间能异步协作 |
| 16 | 远程运行时（可选） | 某个 Agent 独立进程运行，接口不变 |

阶段 10、11 是纯增量重构，不改变单 Agent 行为；阶段 12 起才产生真正的多 Agent 能力。

## 14. 阶段边界（禁止越界）

- 阶段 10–11 不允许改变单 Agent 的输出行为与协议语义。
- 阶段 12 之前不允许编排逻辑进入 `core`。
- 任何阶段都禁止子 Agent 直接 import 另一个 Agent 的实现。
- 任何跨 Agent 数据都必须走 `protocols` 或工具返回值，不允许共享内存状态。
- 审批策略仍只属于 `server`，多 Agent 不引入第二套审批入口。

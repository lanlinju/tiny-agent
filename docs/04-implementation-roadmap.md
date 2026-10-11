# 04. 实施路线图

## 1. 总体规则

每个阶段结束后停下来验收，不跨阶段实现。

每次交付需要说明：

1. 写代码前：5 行设计意图和与其他层的关系。
2. 写完后：运行命令、预期输出、验证了哪个架构原则。
3. 新增文件：所属层、依赖谁、被谁依赖。

## 2. 阶段列表

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| 1 | 协议 + TypeScript 工程骨架 | `npm run dev` 打印 `ready`，`tsc --noEmit` 通过。 |
| 2 | Core Loop + MockLLM + time 工具 | `npm run demo:core` 能看到 ReAct 循环输出。 |
| 3 | Server + Store + CLI | CLI 里发消息能看到完整推理链。 |
| 4 | 接真实 LLM，OpenAI-compatible | 设置 `OPENAI_API_KEY` 后跑通真实任务。 |
| 5 | 4 个内置工具：`shell`、`read`、`write`、`edit` | LLM 能读写文件、执行命令。 |
| 6 | 审批流，配置驱动 | `shell`/`write`/`edit` 先弹审批，`read` 直接过。 |
| 7 | Web GUI | CLI 与 Web 同会话实时同步。 |
| 8 | 事件回放 | `npm run replay <id>` 复现完整推理。 |
| 9 | 插件系统 + 示例插件 | 加载插件后新工具自动出现在 tools 列表。 |

## 3. 阶段 1 文件边界

阶段 1 允许新增：

| 路径 | 层 | 依赖 | 被依赖 |
| --- | --- | --- | --- |
| `package.json` | 工程配置 | 无业务层依赖 | 开发脚本使用 |
| `tsconfig.json` | 工程配置 | 无业务层依赖 | TypeScript 编译使用 |
| `.env.example` | 配置示例 | 无业务层依赖 | 开发者使用 |
| `src/index.ts` | 装配入口 | `server` 或最小启动函数 | `npm run dev` |
| `src/protocols/events.ts` | `protocols` | `zod` | `server`, `clients`, `store` |
| `src/protocols/commands.ts` | `protocols` | `zod` | `server`, `clients` |
| 空层目录 | 各自层 | 无 | 后续阶段填充 |

阶段 1 不允许实现：

- Agent Loop。
- 真实工具执行。
- LLM provider。
- 持久化 store。
- Web/CLI 业务交互。
- 插件加载。

## 4. 阶段 2 文件边界

阶段 2 聚焦 `core` 的最小闭环：

- `core/agent-loop` 只操作 messages、tool calls、事件钩子。
- `llm/mock` 提供确定性响应。
- `tools` 只加入临时 `time` 工具用于证明 loop，不进入最终 MVP 工具集。
- `scripts/demo-core` 只用于本地演示，不成为生产入口。

## 5. 阶段 3 文件边界

阶段 3 才允许引入：

- 本地 `server`。
- `event-bus`。
- `session-store`。
- CLI 命令输入和事件渲染。

CLI 仍然不能依赖 `core`，只能通过命令和事件与 `server` 通信。

## 6. 安全演进顺序

1. 阶段 1：协议中预留审批事件和命令。
2. 阶段 5：工具实现不写审批策略。
3. 阶段 6：在 `server/approval` 配置审批策略。
4. 阶段 7：CLI/Web 都只渲染 `approval.requested` 并发送 `approval.respond`。

## 7. 文档到实现的切换条件

进入阶段 1 前需要确认：

- 是否接受当前文档中的默认假设。
- 是否接受阶段 1 只做骨架和协议。
- 是否接受核心依赖先限制为 `ws` + `zod`。
- 是否接受 Anthropic 只占位、不实现。
- 是否接受 Web 只规划协议边界，真正 GUI 阶段 7 再实现。
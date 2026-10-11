# tiny-agent

一个**本地优先、分层清晰**的编码 Agent 脚手架：自带极简 Agent Loop 循环、OpenAI 兼容 LLM（含流式与思考）、4 个内置工具、插件系统、事件存储与回放，以及 CLI + React Web 双客户端。

> 设计目标是**边界稳定**而不是功能堆叠：`protocols` 先行，`core` 只管消息与工具编排，`server` 是唯一翻译层，`clients` 只渲染事件并发送命令。

---

## 特性

- 🧠 **极简 ReAct 循环**：messages + tool calls + 事件钩子，不掺杂网络/UI/文件系统。
- 🔌 **可替换 LLM**：`LLMProvider` 边界；内置 `mock` 与 OpenAI 兼容 provider（OpenAI / DeepSeek / 其他兼容端点）。
- 🌊 **流式输出**：正文 `message.delta`、思考 `reasoning.delta`，SSE 上游解析。
- 💭 **思考模式**：通过 DeepSeek 的 `thinking` / `reasoning_effort` 参数开关，思考内容默认折叠。
- 🛠 **4 个内置工具**：`read` / `write` / `edit` / `shell`（工具内**不含**审批策略）。
- 🔁 **事件存储与回放**：每个会话写入 `sessions/<id>/events.jsonl`，`npm run replay <id>` 离线复现完整推理链。
- 🧩 **插件系统**：`plugin.json` + `index.js` 贡献工具；宿主可启用/白名单/黑名单。
- 🎮 **Steering**：运行中追加消息进入队列，在“当前轮工具执行完、下一次 LLM 调用前”注入。
- 🖥 **CLI + Web**：Web 为 React（亮色、DeepSeek 风格输入框），与 CLI **同会话实时同步**。
- ⚙️ **配置驱动**：默认值 < 配置文件 < 环境变量 < 代码覆盖，zod 运行时校验。

---

## 架构

```
clients ──► protocols ◄── server ──► core ──► llm
                              │           └► tools
                              ├──► store
                              └──► plugins
```

| 层 | 只负责 | 不负责 |
| --- | --- | --- |
| `protocols` | 事件 / 命令 / 运行时校验 schema | 业务流程、网络、存储 |
| `clients` | 渲染事件、发送命令 | 推理、工具执行、业务状态 |
| `server` | 会话、事件总线、路由、落盘协调 | LLM 决策、工具内部实现 |
| `core` | Agent loop、消息追加、工具编排、发事件 | 网络、UI、文件系统、持久化 |
| `llm` | `chat` provider 适配 | prompt 策略、工具执行 |
| `tools` | 真实世界动作 + JSON Schema | 审批策略、会话状态 |
| `store` | `events.jsonl`、回放 | 修改历史、推理决策 |
| `plugins` | 受控扩展点、权限声明、生命周期 | 绕过审批、绕过协议 |

只允许**向下依赖**；跨层数据必须先进入 `protocols`。

---

## 快速开始

要求 **Node.js >= 22**。

```bash
git clone <your-repo-url> tiny-agent
cd tiny-agent
npm install
cp .env.example .env        # 编辑其中的 OPENAI_* 配置
```

### 1. 起服务并打开 Web

```bash
npm run server
# ready ws://localhost:3987 web=http://localhost:3987 agent=agent-1 ...
```

浏览器打开 `http://localhost:3987`。附加已有会话：`http://localhost:3987/?session=<id>`。

### 2. CLI（自动拉起本地 server）

```bash
npm run cli                 # 若未运行则自动启动 server，退出时自动关闭
npm run cli -- <sessionId>  # 附加到已有会话（与 Web 同会话同步）
```

CLI 选项：`-v/--verbose`、`--no-color`、`--timestamps`、`--max-output <n>`、`--log <path>`。

### 3. 离线回放

```bash
npm run replay <sessionId>  # 从 events.jsonl 复现完整推理链（不重跑 LLM / 工具）
```

### 4. 纯本地 no-key 演示

```bash
npm run demo:core           # 使用确定性 mock LLM 跑一遍 ReAct 循环
```

---

## 配置

优先级：**默认值 < 配置文件 < 环境变量 < 代码覆盖**。

配置文件：项目根目录的 `agent.config.json`，或由 `AGENT_CONFIG=/path/to/config.json` 指定（见 `agent.config.example.json`）。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | API Key（未设置时回退到 mock LLM） |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容端点 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 模型名 |
| `OPENAI_REASONING_EFFORT` | `high` | 思考强度 `none\|low\|high\|max`（DeepSeek） |
| `OPENAI_TEMPERATURE` | — | 温度 |
| `AGENT_ID` | `agent-1` | Agent 实例 ID（写入每个事件的 envelope） |
| `AGENT_OWNER` | `local` | 会话所有者 |
| `AGENT_PORT` | `3987` | HTTP + WebSocket 端口 |
| `AGENT_SESSION_DIR` | `sessions` | 事件落盘目录 |
| `AGENT_WORKSPACE_DIR` | `.` | 工具的工作目录（相对路径解析基准） |
| `AGENT_WEB_DIR` | `dist/clients/web` | Web GUI 静态目录 |
| `AGENT_PLUGIN_DIR` | `plugins` | 插件目录 |
| `AGENT_PLUGINS_ENABLED` | `true` | 插件总开关 |
| `AGENT_PLUGINS_ALLOW` | — | 白名单（逗号分隔，空=不限） |
| `AGENT_PLUGINS_DENY` | — | 黑名单（逗号分隔） |
| `AGENT_LOG_FILE` | — | CLI transcript 文件（可选） |
| `AGENT_MAX_STEPS` | `8` | Agent 循环最大步数 |
| `AGENT_CONFIG` | `agent.config.json` | 指定配置文件路径 |

### DeepSeek 示例

```bash
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
OPENAI_REASONING_EFFORT=high
OPENAI_API_KEY=sk-...
```

勾选输入框的 **深度思考** 后，请求会带上 `thinking: { type: "enabled" }` 与 `reasoning_effort`，思考内容以 `reasoning.delta` 流式返回。

---

## 工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `read` | `path`, `offset?`, `limit?` | 读 UTF-8 文本，可按行窗口切片 |
| `write` | `path`, `content` | 写文件，自动创建父目录 |
| `edit` | `path`, `oldText`, `newText`, `replaceAll?` | 文本替换，要求唯一匹配（除非 `replaceAll`） |
| `shell` | `command`, `cwd?`, `timeoutMs?` | 执行 shell 命令，返回 stdout/stderr/exitCode |

工具定义**不含审批策略**。`time` 工具仅用于 `demo:core`，不属于 MVP 工具集。

---

## 插件

```
plugins/<name>/plugin.json   # { name, version, description?, permissions?, entry?, enabled? }
plugins/<name>/index.js      # module.exports = { tools: [ToolDef], onLoad?, onUnload? }
```

示例见 `plugins/example-wordcount/`。宿主策略（`server.plugins`）：

```jsonc
{
  "server": {
    "pluginDir": "plugins",
    "plugins": { "enabled": true, "allow": [], "deny": ["wordcount"] }
  }
}
```

判定顺序（命中即跳过，且**跳过前不加载插件代码**）：`enabled=false` → `deny` → `allow` 非空且不含 → manifest `enabled=false`。加载后插件工具自动并入 tools 列表。

> `permissions` 目前只是**声明占位**（可见、可审计），尚未强制执行。

---

## Steering（运行中调整方向）

Agent 运行中发出的追加消息进入 steering 队列，在**当前轮工具执行完、下一次 LLM 调用前**注入为 user 消息：

- **CLI**：运行中输入的下一行自动作为 `steer`。
- **Web**：运行中提交即为 steering（发送按钮语义随之切换）。
- **协议**：`{ "type": "steer", "payload": { "sessionId": "...", "text": "..." } }`。
- 队列变化通过 `queue_update` 事件广播。

---

## 协议

事件（server → client，均带 `sessionId/ts/agentId/owner`）：

`session.created` `session.attached` `user.message` `turn.started` `turn.completed` `turn.interrupted` `message.delta` `message.completed` `reasoning.delta` `reasoning.completed` `tool.started` `tool.finished` `approval.requested` `approval.resolved` `error` `queue_update`

命令（client → server）：

`session.create` `session.attach` `message.send` `approval.respond` `interrupt` `steer`

- 所有事件/命令都用 zod 做**编译期 + 运行时**双校验。
- 事件不可变、只追加；`message.delta` / `reasoning.delta` / `reasoning.completed` / `queue_update` 为**瞬态事件**，只广播不落盘。
- 破坏性协议变更必须提供 replay 迁移策略。

---

## 目录结构

```
src/
  protocols/    事件与命令（zod schema）
  core/         agent-loop、prompt、RunContext 类型
  llm/          provider 接口、mock、OpenAI 兼容实现
  tools/        registry、types、builtin/{read,write,edit,shell}
  store/        session-store（events.jsonl）、replay
  server/       agent-server、event-bus、ws-handler、http-server、main
  plugins/      manager、manifest、permissions、types
  config.ts     配置加载与校验
clients/
  cli/          命令行客户端（发送命令、渲染事件、transcript）
  web/          React Web GUI（esbuild 打包）
plugins/        官方插件目录
scripts/        demo-core、cli（启动器）、replay、build-web
docs/           架构、协议、核心循环、路线图
test/           node:test 测试
```

---

## 开发

```bash
npm run check   # 类型检查（主项目 + Web）
npm test        # 构建后运行 node:test（dist/test/**/*.test.js）
npm run build   # 编译 TS + 打包 Web 到 dist/
```

- 类型系统：strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。
- 运行时依赖极小：`ws` + `zod`；React / esbuild 等仅为 Web 构建期依赖。
- Web 产物输出到 `dist/clients/web`（已 gitignore，`npm run build` 自动生成）。

---

## 项目状态

| 能力 | 状态 |
| --- | --- |
| 协议 + 工程骨架 | ✅ |
| Core ReAct + Mock LLM | ✅ |
| Server + Store + CLI | ✅ |
| OpenAI 兼容 provider（流式） | ✅ |
| 内置工具 read/write/edit/shell | ✅ |
| Web GUI（React，CLI/Web 同会话同步） | ✅ |
| 事件回放 | ✅ |
| 插件系统 + 示例插件 | ✅ |
| Steering | ✅ |
| 思考模式（thinking / reasoning_effort） | ✅ |
| 审批流 | ⏳ 协议已预留，尚未启用（当前工具免审批执行） |

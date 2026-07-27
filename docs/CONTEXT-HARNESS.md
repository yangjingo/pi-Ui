# Context Harness

`src/harness/context` 管理 Agent 请求中对 prefix cache 敏感的部分。它不实现 Provider
缓存，也不依赖 Pi SDK；Core/Pi 负责把这份策略接到 Pi 的 extension 和 session API。

设计依据：

- Anthropic 的 [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  强调最小高信号上下文、按需检索、清晰工具边界和可恢复的长任务状态。
- Manus 的 [Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
  将 KV-cache 命中率视为生产 Agent 的核心指标，并要求稳定前缀、append-only history、
  确定性序列化以及固定 Tool definition。

## 请求组装协议

```text
稳定区（跨轮次保持字节级一致）
  Pi base system prompt
  + ContextHarness 静态策略
  + 固定顺序的 Tool definitions
  + 稳定的相对 workspace 语义

追加区（只在尾部增长）
  历史 user / assistant / toolResult
  + 当前显式激活的 SKILL.md
  + 当前 user request
```

具体约束：

1. Pi 默认 system prompt 末尾包含物理 CWD。应用的 CWD 带有 `sessionId`，因此
   `before_agent_start` adapter 将它统一为相对 workspace 语义；工具仍在真实 session CWD
   中执行。
2. Core 在创建 session 时一次性声明 Coding 和 Goal tools。Skill、Goal 状态和 UI
   操作都不能在 Agent loop 中动态增删 Tool definition。
3. 禁用 Pi 对全局 Skill 和 context file 的自动前置注入。Workspace Skill 仅在用户显式
   输入 `/skill-name` 时展开；`SKILL.md` 放在该 user turn 的前部，具体请求在后，支持
   文件只保留稳定路径并按需读取。
4. 多轮消息继续由 Pi `SessionManager` 以 append-only 方式维护。工具失败不从历史中
   擦除；长任务状态和大体积中间结果写入 workspace 文件，由 Goal/文件 Harness 恢复。
5. Context Harness 不手写 Provider `cache_control`。pi-ai 已根据 Provider capability 在
   system、最后一个 Tool 和最近消息上设置对应 breakpoint；不支持缓存的 Provider 会
   正常返回零值。

## 可观测性

每个完成的 Agent turn 记录：

- `input`、`output`、`totalTokens`：直接聚合 pi-ai assistant response 的 `usage` metadata；
  不通过文本长度估算。`input` 是 SDK 归一化后的未缓存输入。
- `cacheRead`：SDK response metadata 报告的缓存读取 token。
- `cacheWrite`、`cacheWrite1h`：SDK response metadata 报告的缓存写入 token。
- `cacheHitRate`：`cacheRead / (input + cacheRead + cacheWrite)`。
- `contextPrefix`：System + active Tools 的短 SHA-256 指纹。
- `contextPrefixStable`：当前静态前缀是否与 session 创建时一致。

命中率是 Provider 的实际结果；前缀稳定只证明本应用没有改变 System/Tools。Provider
最低缓存长度、TTL、模型能力以及服务端路由仍会影响实际命中。

普通 Turn/Traj 报告与 Goal 预算终止报告都消费同一份 canonical response usage。
Provider 没有返回缓存字段时，pi-ai 会将对应值归一为 `0`，报告不会自行推测命中量。

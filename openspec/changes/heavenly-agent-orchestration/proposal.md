## Why

当前清风、明月的协作已经具备基础能力，但你希望扩展为“天庭议事团”：所有角色都能接入 Arena 聊天室参与讨论，同时保持按需触发，避免每轮全员推理导致 prompt 和 token 失控。为此需要一个统一的角色联通、激活策略和记忆架构。

## What Changes

- 建立“全员联通聊天室、按需激活”的多角色编排架构。
- 支持角色通过规则触发与 `@角色名` 显式唤醒进入当前轮讨论。
- 在 prompt 组装中采用 `Core + Persona + Skill Capsules + Context` 的预算化拼装，确保提示词规模可控。
- 建立长短期记忆协同策略：短期优先、长期按需召回，并基于意图选择合适记忆。
- 引入每日定时 AI 资讯管道（抓取、去重、标注、可信度评估），并把结果作为可检索记忆而非全量常驻上下文。

## Capabilities

### New Capabilities
- `agent-chatroom-presence`: 多角色全员可连通 Arena 聊天室并具备可寻址身份。
- `agent-activation-orchestration`: 默认常驻+按需激活+`@`唤醒的角色激活控制能力。
- `memory-tiered-retrieval`: 长短期记忆分层管理与按意图检索能力。
- `daily-ai-intel-pipeline`: 每日 AI 资讯采集、去重、评估与记忆入库能力。

### Modified Capabilities
- `agent-prompt-skill-composition`: 扩展到多角色激活场景下的按需技能拼装与预算裁剪策略。

## Impact

- Affected code:
  - 角色路由与调度（runner/router）
  - prompt 构建与角色人格注入
  - 记忆存储与检索链路
  - 定时任务与资讯摄取管道
- APIs/systems:
  - 聊天室消息协议需要支持更多角色身份与唤醒信号（`@角色名`）。
  - 资讯来源接入需要新增抓取与归档流程。
- Dependencies:
  - 可能需要定时调度机制与检索索引能力（可先复用现有存储逐步演进）。

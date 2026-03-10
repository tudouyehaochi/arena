## Context

目标是把“天庭议事团”做成可扩展的多角色协作系统：
- 所有角色都可连通 Arena 聊天室并可被 `@角色名` 唤醒。
- 不是每条消息都全员推理，按规则与意图按需激活。
- 提示词体积可控（预算化拼装），避免 token 快速膨胀。
- 记忆可分层管理（短期/长期）并按意图检索。
- 支持每日 AI 资讯采集并沉淀为可检索记忆。

## Goals / Non-Goals

### Goals
- 提供“全员在线、按需激活”的统一编排机制。
- 为每个角色建立独立 persona 与 skill capsule 的可插拔体系。
- 建立长短期记忆与资讯入库闭环，支持检索增强回复。
- 保持现有聊天室协议兼容，渐进式演进。

### Non-Goals
- 不在本期引入复杂多租户权限系统。
- 不在本期引入外部向量数据库（先基于 Redis + 结构化索引）。
- 不追求一次性覆盖所有角色，先支持首批核心角色并可扩展。

## Architecture

### 1) Role Registry（角色注册中心）
- 维护角色元数据：`name`, `alias`, `persona`, `skills`, `activationRules`, `priority`。
- 支持状态：`idle`, `active`, `muted`。
- 统一暴露给 router / prompt builder / dashboard。

### 2) Activation Orchestrator（激活编排）
输入：新消息、最近会话窗口、当前路由状态。
输出：本轮激活角色列表与执行顺序。

激活来源：
- 显式激活：消息中出现 `@角色名`。
- 规则激活：topic/intention 命中预设规则（如 AI 资讯触发情报角色）。
- 保底激活：默认主协作角色（如清风）兜底。

约束策略：
- 每轮最大激活角色数（防止全员并发推理）。
- 连续 agent 回合上限沿用现有 `MAX_AGENT_TURNS`。
- 深度与队列策略沿用 `A2A Router`，新增角色优先级裁剪。

### 3) Prompt Composer（预算化提示词拼装）
Prompt 分区：
- Core（通用规则，固定小体积）
- Persona（仅激活角色）
- Skill Capsules（仅激活角色+当前任务需要）
- Context（短期窗口 + 长期检索摘要 + 资讯摘要）

预算控制：
- 按 section 设置字符/token 预算。
- 超预算时优先裁剪顺序：低优先技能块 -> 历史细节 -> 非关键 persona 描述。
- 保证 `Core` 不被裁剪。

### 4) Memory Layer（分层记忆）
- Short-term：当前房间近期消息窗口与 session summary（已有能力扩展）。
- Long-term：结构化条目（决策、偏好、已验证结论、常用步骤）。
- Retrieval Policy：按意图检索（故障排查优先步骤记忆，资讯问题优先新闻记忆）。

写入策略：
- 回合结束后异步抽取可沉淀信息。
- 去重与版本化（避免相同记忆重复堆积）。

### 5) Daily AI Intel Pipeline（每日资讯管道）
流程：
1. 定时拉取来源（白名单源）。
2. 去重（URL + 标题近似 + 时间窗口）。
3. 打标签（模型发布、政策、产品更新、生态工具等）。
4. 可信度打分（来源权重 + 交叉验证）。
5. 写入长期记忆供检索。

输出不直接常驻 prompt，仅在“资讯相关意图”时按需注入摘要。

## Data Contracts

### Activation Input
- `roomId`
- `message`（from/content/seq）
- `mentions[]`
- `intent`
- `routeState`

### Activation Output
- `activeRoles[]`
- `reasonByRole`
- `executionOrder[]`
- `droppedRoles[]`（含原因：budget/priority/depth）

### Memory Record（长期）
- `id`
- `type`（decision/preference/procedure/news）
- `summary`
- `evidence`
- `tags[]`
- `confidence`
- `updatedAt`

## Rollout Plan

### Phase 1
- 角色注册中心 + `@` 显式激活。
- prompt composer 支持 active-only persona/skills。

### Phase 2
- 规则激活与预算裁剪。
- 长短期记忆检索策略接入。

### Phase 3
- 每日 AI 资讯管道与记忆入库。
- dashboard 展示角色激活原因与记忆命中情况。

## Risks & Mitigations

- 风险：角色过多导致调度复杂、响应抖动。
  - 缓解：最大激活数 + 优先级裁剪 + 回退到主角色兜底。
- 风险：资讯源噪声导致误导。
  - 缓解：白名单来源 + 可信度评分 + 证据字段。
- 风险：记忆膨胀导致检索慢。
  - 缓解：去重、TTL、按 type 分桶索引。

## Validation

- 单测：激活规则、`@` 唤醒、预算裁剪、记忆检索路由。
- 集成：多角色聊天室场景下不触发全员推理。
- 回归：现有双角色（清风/明月）流程行为保持兼容。

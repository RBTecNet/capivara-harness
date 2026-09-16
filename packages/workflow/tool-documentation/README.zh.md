---
description: "面向模型的 documentation 工具：强制人工访谈、可配置执行器和独立验证器，用于处理项目文档请求。"
kind: "package-reference"
---

# @capivara-harness/dsh-tool-documentation

[English](README.md) | 中文

## 概述

`documentation` 把文档请求转换为有记录的访谈、一个全新的执行器子 agent 与另一个独立的全新验证器子 agent。执行器修改共享工作区；验证器读取目标、访谈记录和生成的文件，并且必须在父调用成功前确认每项要求。执行器与验证器的路由是独立设置；部署也可以有意让两个角色使用同一个模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`documentation` 工具是文档工作的产品入口；文档工作必须以人工回答为依据。它在基础 headless 组合中启用；不公开文档编辑的部署可以禁用它。

### 调用工具

模型提交 `{ objective }`。objective 说明所需的文档结果，并保留在父级结果中。模型不能在调用中指定模型路由、跳过访谈、跳过验证或传入子 agent 提示词。

### 强制访谈

每次调用都会向直接用户询问四个固定问题，涉及范围、受众与语言、验收标准以及限制或排除项。当这些回答还不足以确定完整目标时，需求子 agent 可以提出有界的后续问题。达到配置的访谈轮数上限时调用会失败，而不会静默使用模型推断填补缺失事实。

### 执行与验证

访谈后，执行器子 agent 检查仓库文档规则，修改共享工作区，并返回有界的结构化报告。随后，一个新的验证器子 agent 以只读方式对照原始 objective 与完整访谈记录进行比较。验证失败会启动修正执行器，再启动另一个验证器，直到达到配置的验证上限。只有验证器报告通过时工具结果才会成功。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `subagentProvider` | `spawn` | 执行器、需求分析器和验证器子 agent 使用的提供方。 |
| `maxInterviewRounds` | `3` | 固定问题加自适应问题的最大访谈轮数。 |
| `maxValidationRounds` | `3` | 验证尝试的最大次数，包含修正循环。 |
| `maxObjectiveChars` | `16384` | 序列化 objective 的最大大小。 |
| `maxInterviewChars` | `24576` | 序列化访谈记录的最大大小。 |
| `maxReportChars` | `16384` | 执行器或验证器报告的最大大小。 |
| `maxResultChars` | `16384` | 成功父级结果的最大大小。 |

执行器和验证器模型路由保存在 `documentation-model-selection` 设置命名空间中。每个路由包含 `provider` 与 `model`；Settings 面板从实时 LLM 目录提供两个选择器，并在提供方暂时不可用时保留已保存路由。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-documentation)覆盖运行时工作流字段，生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-documentation)覆盖模型可见的调用，而本 README 负责说明双角色设置行为。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该包是基于 `ctx.userQuestions`、`ctx.subagents`、`ctx.documentationModelSelection`、`ctx.systemPrompt` 与 `ctx.tools` 的固定前台 Consumer。它不会向 `agent-loop` 增加模式，也不会使用由模型编写的工作流脚本控制流程。

访谈记录是由父级明确拥有的状态：每个问题必须得到直接用户的一次回答，完整有序的记录会传给所有可能影响结果的子 agent。需求子 agent 只能使用只读工具，并返回有界的后续问题或完整 brief。

执行器和验证器都是全新的结构化输出子 agent。执行器获得工作区编辑工具和报告 schema；验证器获得只读工具和验证器 schema。验证器不能修改文件或启动其他编排；执行器最后一次修改之后必须有验证器通过。

工具会等待每个子 agent 的结果，并在所有路径上 dispose 每个子 agent。提供方必须支持 `agentOptions`、结构化输出和全新子 agent 策略（`inheritsParentContext: false`）。两个配置路由以子 agent 的 `agentOptions` 发送，并出现在父级结果中供运行检查。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 访谈策略、子 agent 提示词、验证循环、工具注册与父级结果。 |
| [`src/model-selection-settings.ts`](src/model-selection-settings.ts) | 持久化执行器与验证器路由设置。 |
| [`tests/integration.spec.ts`](tests/integration.spec.ts) | 对强制访谈、自适应后续问题、修正和终态拒绝的组合级验证。 |
| — | 不发布运行时不变式伴生入口；该工具不拥有独立的持久事件流，只有既有 seam 发出的工具与子会话事件。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [workflow 组](../README.zh.md)——周边的工作流相关包。
- [subagent seam](../../subagent/subagent/README.zh.md)——提供方能力与全新子 agent 的所有权。
- [用户问题能力](../../interaction/user-questions/README.zh.md)——直接用户提问与回答语义。
- [Settings 能力](../../settings/settings/README.zh.md)——按会话持久化设置分区。
- [工作流子系统](../../../docs/subsystems/workflow.zh.md)——工作流 Consumer 与 agent loop 之间的文档化关系。
- [文档执行器与验证器 Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-documentation-executor-validator.zh.md)——决策与被放弃的替代方案。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

该插件启用时，父级会收到以下固定指导：

##### 父级固定指导

```markdown
Use the documentation tool for every documentation request. It always starts with a direct-human interview, including for simple requests. Do not infer missing project requirements. The tool then uses one configured executor model to edit the workspace and a separate configured validator model to compare the result with the original objective and complete interview transcript. A successful result means the validator passed; a failed validation triggers a bounded correction cycle.
```

#### Token 影响

插件启用期间，每个请求都会产生少量固定指导 token 开销。访谈回答与子 agent 报告只发送给需要它们的子 agent 以及终态父级结果。

#### KV Cache 影响

只要插件作用域和指导文本不变，前缀就保持稳定。改变任一模型路由会影响子 agent 请求，但不会改变固定的父级提示词段。

### 工具 schema

#### 模型看到什么

生成的 [`documentation` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-documentation)公开一个必填的 `objective` 字符串。访谈策略、子 agent 提示词、模型路由、报告 schema 与验证上限均由部署侧管理。

#### Token 影响

工具可见时，每个请求都会产生少量固定 schema token 开销。

#### KV Cache 影响

只要定义与可见性不变，前缀就保持稳定。

### 子 agent 请求与父级结果

#### 模型看到什么

直接用户会看到每个固定问题和自适应问题。每个子 agent 都会看到只包含有界 objective、访谈记录和角色专属交接的独立提示词。父级会收到包含两个模型路由、访谈记录、验证尝试、修改文件、摘要及验证器发现的终态结果；未验证的结果会作为工具错误返回。

#### Token 影响

每个需求分析器、执行器、修正执行器和验证器请求都会消耗自己的子 agent 上下文。配置的序列化上限限制了阶段之间以及返回父级的信息量。

#### KV Cache 影响

全新子 agent 拥有独立的请求缓存。父级请求保留可复用前缀，只接收最终有界结果。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 验证器是独立的基于模型的审查，不是证明文档完整性的形式化证明。
- 验证器只读并可以报告不匹配，但只能由后续执行器子 agent 修改工作区。
- 当前调用必须回答访谈问题；回答不会作为可复用的项目规格持久化。
- 工具验证共享工作区与执行器选择的文档检查，但不会发布独立的文档构建产物。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

该包有意把访谈、执行与验证策略保留在一个固定 Consumer 中。未来能力可以持久化已批准的项目 brief 或增加正式文档 linter，但这些行为不属于当前包的结果约定。

</details>

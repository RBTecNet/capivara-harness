# Agent Note: Documentation executor and validator workflow

Status: implemented

[English](2026-09-16-documentation-executor-validator.md) | 中文

## Problem

文档请求可能缺少精确结果所需的项目事实、受众决定和验收标准。只负责修改文档并自行宣布完成的 worker，不能独立确认结果满足直接用户的请求。

## Decision

`documentation` 工具是固定的前台 Consumer，每次调用都会先访谈直接用户，包括简单请求。它询问一组固定的项目问题；当回答还不能形成完整 brief 时，再使用全新的需求子 agent 提出有界的后续问题。达到配置的访谈上限仍缺少答案时调用失败，而不是进行模型推断。

工具把有界 objective 与完整访谈记录发送给全新的结构化输出执行器子 agent。执行器可以修改共享工作区并返回有界报告。另一个独立的全新结构化输出验证器子 agent 获得只读工具，对照 objective、访谈记录和工作区进行比较。验证失败会启动修正执行器和另一个验证器，直到达到配置的验证上限；只有验证器通过时结果才成功。

执行器和验证器路由位于持久化的 `documentation-model-selection` 设置命名空间中，并从实时 LLM 目录独立选择。两个角色可以使用同一路由，但子 agent 运行仍然分离，验证器仍保持只读。

该策略由 `dsh-tool-documentation` 基于现有的 `userQuestions`、`subagents`、`settings`、`systemPrompt` 与 `tools` seam 实现。它不会向 `agent-loop` 增加文档模式，也不会让通用循环负责访谈或评估。

## Alternatives considered

- **修改 `agent-loop`，让它访谈并评估每个请求。** 这会把文档专属策略强加给无关任务，并扩大核心循环约定。独立 Consumer 让策略保持可选，并拥有自己的可见行为文档。
- **让一个模型自行审查它生成的文档。** 自审没有独立的路由或过程，并可能重复同一个无依据的假设。全新的验证器子 agent 拥有独立提示词、报告 schema 和可配置模型路由。
- **使用由模型编写的 `workflow` 脚本。** 模型可以改变顺序，或省略访谈和验证器。固定 Consumer 让这些阶段由部署方拥有，并拒绝未经验证的完成结果。

## Consequences

基础 headless 组合公开一个文档工具，Settings 卡片提供独立的执行器和验证器选择器。一次文档调用包含明确的人工记录并创建多个子 agent 请求，因此比单个编辑子 agent 需要更多延迟和 token。父级结果报告路由、产物、验证尝试、摘要和发现；终态验证失败会作为工具错误返回，而不是声称成功。

验证器是独立的基于模型的审查，不是形式化证明，也不取代仓库的文档检查。每次调用都必须回答访谈问题，回答不会成为可复用的项目规格。组合测试固定了强制访谈、自适应后续问题、修正循环以及终态验证失败的拒绝行为。

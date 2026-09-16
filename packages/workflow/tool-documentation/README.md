---
description: "The model-facing documentation tool: a mandatory human interview, a configurable executor, and an independent validator for project documentation requests."
kind: "package-reference"
---

# @capivara-harness/dsh-tool-documentation

English | [中文](README.zh.md)

## Summary

`documentation` turns a documentation request into a recorded interview, a fresh executor child, and a separate fresh validator child. The executor edits the shared workspace; the validator reads the objective, interview transcript, and resulting files and must certify every requested requirement before the parent call succeeds. Executor and validator routes are independent settings, although a deployment may deliberately point both roles at the same model.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `documentation` tool is the product-facing entry point for documentation work that must be grounded in human answers. It is enabled in the base headless composition and can be disabled by a deployment that does not expose documentation editing.

### Calling the tool

The model submits `{ objective }`. The objective identifies the requested documentation outcome and is retained in the parent result. The tool does not accept a model route, interview bypass, validation bypass, or child prompt from the model.

### Mandatory interview

Every call asks the direct human four fixed questions about scope, audience and language, acceptance criteria, and constraints or exclusions. A requirements child may ask bounded follow-up questions when those answers do not identify a complete objective. The call fails at the configured interview-round limit rather than silently filling missing facts with model assumptions.

### Execution and validation

After the interview, an executor child inspects the repository documentation rules, edits the shared workspace, and returns a bounded structured report. A new validator child then performs a read-only comparison against the original objective and the complete interview transcript. A failed validation starts a correction executor followed by another validator, up to the configured validation limit. Only a passing validator report produces a successful tool result.

### Config

| Field | Default | Meaning |
|---|---|---|
| `subagentProvider` | `spawn` | Provider used for the executor, requirements-analysis, and validator children. |
| `maxInterviewRounds` | `3` | Maximum fixed-plus-adaptive interview rounds. |
| `maxValidationRounds` | `3` | Maximum validator attempts, including correction cycles. |
| `maxObjectiveChars` | `16384` | Maximum serialized objective size. |
| `maxInterviewChars` | `24576` | Maximum serialized interview transcript size. |
| `maxReportChars` | `16384` | Maximum executor or validator report size. |
| `maxResultChars` | `16384` | Maximum successful parent result size. |

The executor and validator model routes are stored under the `documentation-model-selection` settings namespace. Each route contains a `provider` and `model`; the Settings panel exposes both selectors from the live LLM catalog and preserves a saved route when its provider is temporarily unavailable. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-documentation) covers the runtime workflow fields, the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-documentation) covers the model-visible call, and this README owns the two-role settings behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is a fixed foreground consumer over `ctx.userQuestions`, `ctx.subagents`, `ctx.documentationModelSelection`, `ctx.systemPrompt`, and `ctx.tools`. It does not add a mode to `agent-loop` and does not use a model-authored workflow script for its control flow.

The interview transcript is explicit parent-owned state: every asked question must receive one direct-human answer, and the full ordered transcript is passed to every child that can affect the result. The requirements child receives only read-only tool access and returns either bounded follow-up questions or a complete brief.

The executor and validator are fresh structured-output children. The executor receives workspace-editing tools and a report schema; the validator receives read-only tools and a validator schema. The validator cannot edit files or start another orchestration, and a validator pass is required after the final executor mutation.

The tool awaits each child result and disposes each child on every path. A provider must support `agentOptions`, structured output, and a fresh-child policy (`inheritsParentContext: false`). The two configured routes are sent as child `agentOptions` and are visible in the parent result for operational inspection.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Interview policy, child prompts, validation loop, tool registration, and parent result. |
| [`src/model-selection-settings.ts`](src/model-selection-settings.ts) | Persistent executor and validator route settings. |
| [`tests/integration.spec.ts`](tests/integration.spec.ts) | Composition-level proof of mandatory interview, adaptive follow-up, correction, and terminal rejection. |
| — | No runtime invariant companion is published; the tool owns no independent durable event stream beyond the tool and child-session events emitted by existing seams. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workflow group](../README.md) — the surrounding workflow-related packages.
- [Subagent seam](../../subagent/subagent/README.md) — provider capabilities and fresh-child ownership.
- [User-question capability](../../interaction/user-questions/README.md) — direct-human question and answer semantics.
- [Settings capability](../../settings/settings/README.md) — persistent per-session settings sections.
- [Workflow subsystem](../../../docs/subsystems/workflow.md) — the documented relationship between workflow consumers and the agent loop.
- [Documentation executor and validator Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-documentation-executor-validator.md) — the decision and alternatives.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

When this plugin is active, the parent receives this fixed guidance:

##### Fixed parent guidance

```markdown
Use the documentation tool for every documentation request. It always starts with a direct-human interview, including for simple requests. Do not infer missing project requirements. The tool then uses one configured executor model to edit the workspace and a separate configured validator model to compare the result with the original objective and complete interview transcript. A successful result means the validator passed; a failed validation triggers a bounded correction cycle.
```

#### Token effect

Small fixed guidance cost per request while the plugin is active. Interview answers and child reports are sent only to the children that need them and to the terminal parent result.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Changing either model route affects child requests, not the fixed parent prompt section.

### Tool schema

#### What the model sees

The generated [`documentation` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-documentation) exposes one required `objective` string. Interview policy, child prompts, model routes, report schemas, and validation limits are deployment-owned.

#### Token effect

Small fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Child requests and parent result

#### What the model sees

The direct human sees every fixed and adaptive question. Each child sees a standalone prompt containing only the bounded objective, interview transcript, and role-specific handoff. The parent receives a terminal result with the two model routes, interview transcript, validation attempts, changed artifacts, summary, and validator findings; an unvalidated result is returned as a tool error.

#### Token effect

Each interview-analysis, executor, correction, and validator request consumes its own child context. The configured serialized limits cap the information that crosses between stages and back to the parent.

#### KV Cache effect

Fresh children have independent request caches. The parent request keeps its reusable prefix and receives only the final bounded result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The validator is an independent model-based review, not a formal proof of documentation completeness.
- The validator is read-only and can report a mismatch, but only a later executor child can change the workspace.
- Interview answers are required for the current call; they are not persisted as a reusable project specification.
- The tool verifies the shared workspace and documentation checks selected by the executor; it does not publish a separate documentation build artifact.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package intentionally keeps interview, execution, and validation policy in one fixed consumer. A future capability may persist approved project briefs or add a formal documentation linter, but neither behavior is part of this package's current result contract.

</details>

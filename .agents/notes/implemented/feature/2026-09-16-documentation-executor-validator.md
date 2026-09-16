# Agent Note: Documentation executor and validator workflow

Status: implemented

English | [中文](2026-09-16-documentation-executor-validator.zh.md)

## Problem

Documentation requests can lack the project facts, audience decisions, and acceptance criteria needed for an exact result. A worker that edits documentation and declares completion does not independently establish that the result satisfies the direct human's request.

## Decision

The `documentation` tool is a fixed foreground consumer that always starts with a direct-human interview, including for simple requests. It asks a fixed set of project questions and uses a fresh requirements child for bounded follow-up questions when the answers do not yet define a complete brief. Missing answers cause the call to fail at the configured interview limit instead of being inferred.

The tool sends the bounded objective and complete interview transcript to a fresh structured-output executor child. The executor can edit the shared workspace and returns a bounded report. A separate fresh structured-output validator child receives read-only tools and compares the workspace with the objective and transcript. A failed validation starts a correction executor and another validator until the configured validation limit; only a validator pass is a successful result.

Executor and validator routes live in the persistent `documentation-model-selection` settings namespace and are selected independently from the live LLM catalog. The two roles may use the same route, but the child runs remain separate and the validator remains read-only.

The policy is implemented in `dsh-tool-documentation` over the existing `userQuestions`, `subagents`, `settings`, `systemPrompt`, and `tools` seams. It does not add a documentation mode to `agent-loop` or make the generic loop responsible for interviews or evaluation.

## Alternatives considered

- **Change `agent-loop` to interview and evaluate every request.** This would impose documentation-specific policy on unrelated tasks and broaden the core loop contract. The dedicated consumer keeps the policy opt-in and documents its own visible behavior.
- **Let one model self-review its own documentation.** Self-review does not provide an independent route or process and can repeat the same unsupported assumption. A fresh validator child has a separate prompt, report schema, and configurable model route.
- **Use a model-authored `workflow` script.** The model could change the ordering or omit the interview and validator. A fixed consumer makes those stages deployment-owned and rejects unvalidated completion.

## Consequences

The base headless composition exposes one documentation tool and a Settings card with separate executor and validator selectors. A documentation call includes an explicit human transcript and creates multiple child requests, so it costs more latency and tokens than a single editing child. The parent result reports the routes, artifacts, validation attempts, summary, and findings; terminal validation failure is a tool error rather than a success claim.

The validator is an independent model-based review, not a formal proof or a replacement for repository documentation checks. Interview answers are required for each call and are not a reusable project specification. Integration coverage pins the mandatory interview, adaptive follow-up, correction cycle, and rejection of a final failed validation.

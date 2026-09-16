import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@capivara-harness/dsh-agent'
import type { AskUserQuestionRequest } from '@capivara-harness/dsh-user-questions'
import UserQuestionService from '@capivara-harness/dsh-user-questions'
import AgentLoop from '@capivara-harness/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@capivara-harness/dsh-agent-loop-testkit'
import { ToolCallId } from '@capivara-harness/dsh-llm'
import { SessionId } from '@capivara-harness/dsh-session'
import SubagentRuntime from '@capivara-harness/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@capivara-harness/dsh-subagent-in-process-driver'
import * as SubagentSpawn from '@capivara-harness/dsh-subagent-spawn-in-process'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import DocumentationModelSelectionConfig from '../src/model-selection-settings.ts'
import * as DocumentationTool from '../src/index.ts'

const BUILDER = { provider: 'mock', model: 'builder-model' }
const VALIDATOR = { provider: 'mock', model: 'validator-model' }

type MockScript = ConstructorParameters<typeof MockAdapter>[0]

function reportResponse(rawCallId: string, value: object) {
  return toolCallResponse(rawCallId, STRUCTURED_OUTPUT_TOOL, value)
}

function completedExecutor(summary = 'Documentation was implemented.') {
  return {
    status: 'completed',
    summary,
    artifacts: ['docs/architecture.md'],
    changes: ['Updated the requested documentation artifact.'],
    assumptions: [],
    openQuestions: [],
  }
}

function passingValidator(summary = 'The documentation satisfies the clarified request.') {
  return {
    status: 'pass',
    summary,
    checkedArtifacts: ['docs/architecture.md'],
    findings: [],
    missingRequirements: [],
    unsupportedAssumptions: [],
  }
}

function failingValidator() {
  return {
    status: 'fail',
    summary: 'The requested acceptance criterion is absent.',
    checkedArtifacts: ['docs/architecture.md'],
    findings: [{
      severity: 'error',
      requirement: 'Document the acceptance criterion.',
      evidence: 'docs/architecture.md does not state the criterion.',
      remediation: 'Add the criterion to the document and verify its wording.',
    }],
    missingRequirements: ['Document the acceptance criterion.'],
    unsupportedAssumptions: [],
  }
}

/** Mount the real Agent, subagent, user-question, and documentation stack. */
async function boot(script: MockScript, options: {
  maxInterviewRounds?: number
  maxValidationRounds?: number
} = {}) {
  const ctx = new Context()
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(DocumentationModelSelectionConfig, { executor: BUILDER, validator: VALIDATOR })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(DocumentationTool, {
    subagentProvider: 'spawn',
    maxInterviewRounds: options.maxInterviewRounds ?? 2,
    maxValidationRounds: options.maxValidationRounds ?? 2,
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  const questions: AskUserQuestionRequest[] = []
  ctx.on('user-questions/request', (request) => {
    questions.push(request)
    return Promise.resolve({
      answers: request.questions.map(question => ({
        id: question.id,
        selected: [],
        custom: `human answer for ${question.id}`,
      })),
    })
  })
  const parentHandle = await ctx.agents.create({
    sessionId: SessionId('documentation-parent'),
    meta: { cwd: '/tmp/documentation-workspace' },
    agentOptions: { provider: 'mock', model: 'parent-model' },
  })
  return { ctx, adapter, questions, parent: parentHandle.agent, parentHandle }
}

async function execute(ctx: Context, parent: Agent, objective = 'Create the requested documentation.') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('documentation-test'),
    name: 'documentation',
    arguments: { objective },
    agent: parent,
  })
}

describe('dsh-tool-documentation over the real spawn stack', () => {
  it('always interviews before using distinct executor and validator routes', async () => {
    const harness = await boot([
      reportResponse('analysis', {
        ready: true,
        brief: 'Create the requested documentation for the stated audience.',
        questions: [],
        risks: [],
      }),
      reportResponse('executor', completedExecutor()),
      reportResponse('validator', passingValidator()),
    ])
    try {
      const result = await execute(harness.ctx, harness.parent, 'Create a simple project guide.')

      expect(result.isError).toBe(false)
      expect(harness.questions).toHaveLength(1)
      expect(harness.questions[0]!.questions.map(question => question.id)).toEqual([
        'artifact-scope', 'audience-language', 'acceptance-criteria', 'constraints-exclusions',
      ])
      expect(harness.adapter.requests.map(request => request.model)).toEqual([
        'builder-model', 'builder-model', 'validator-model',
      ])
      const analysisPrompt = JSON.stringify(harness.adapter.requests[0]!.messages)
      const validatorPrompt = JSON.stringify(harness.adapter.requests[2]!.messages)
      expect(analysisPrompt).toContain('human answer for artifact-scope')
      expect(validatorPrompt).toContain('Create a simple project guide.')
      expect(validatorPrompt).toContain('human answer for acceptance-criteria')
      expect((result.content[0] as { text: string }).text).toContain('"validatorModel": "mock/validator-model"')
    } finally {
      await harness.parentHandle.dispose()
      await harness.ctx.fiber.dispose()
    }
  })

  it('asks adaptive follow-up questions instead of allowing an incomplete brief', async () => {
    const harness = await boot([
      reportResponse('analysis-1', {
        ready: false,
        brief: 'The audience and artifact are known, but a required terminology choice is missing.',
        questions: [{ id: 'terminology', question: 'Which project terminology must remain verbatim?' }],
        risks: ['The terminology policy is not explicit.'],
      }),
      reportResponse('analysis-2', {
        ready: true,
        brief: 'Create the guide and preserve the terminology supplied by the human.',
        questions: [],
        risks: [],
      }),
      reportResponse('executor', completedExecutor()),
      reportResponse('validator', passingValidator()),
    ])
    try {
      const result = await execute(harness.ctx, harness.parent, 'Create a guide with the requested terminology.')

      expect(result.isError).toBe(false)
      expect(harness.questions).toHaveLength(2)
      expect(harness.questions[1]!.questions.map(question => question.id)).toEqual(['follow-up-1-terminology'])
      expect(harness.adapter.requests.map(request => request.model)).toEqual([
        'builder-model', 'builder-model', 'builder-model', 'validator-model',
      ])
    } finally {
      await harness.parentHandle.dispose()
      await harness.ctx.fiber.dispose()
    }
  })

  it('routes validator findings back to the executor and revalidates the correction', async () => {
    const harness = await boot([
      reportResponse('analysis', {
        ready: true,
        brief: 'The final file must include the acceptance criterion.',
        questions: [],
        risks: [],
      }),
      reportResponse('executor-1', completedExecutor('Initial documentation was implemented.')),
      reportResponse('validator-1', failingValidator()),
      reportResponse('executor-2', completedExecutor('The missing acceptance criterion was added.')),
      reportResponse('validator-2', passingValidator('The corrected documentation now satisfies the request.')),
    ])
    try {
      const result = await execute(harness.ctx, harness.parent)

      expect(result.isError).toBe(false)
      expect(harness.adapter.requests.map(request => request.model)).toEqual([
        'builder-model', 'builder-model', 'validator-model', 'builder-model', 'validator-model',
      ])
      expect(JSON.stringify(harness.adapter.requests[3]!.messages)).toContain('Document the acceptance criterion.')
      expect((result.content[0] as { text: string }).text).toContain('"validationAttempts": 2')
    } finally {
      await harness.parentHandle.dispose()
      await harness.ctx.fiber.dispose()
    }
  })

  it('never reports success when the validator still rejects at the configured limit', async () => {
    const harness = await boot([
      reportResponse('analysis', {
        ready: true,
        brief: 'The document must meet the stated acceptance criterion.',
        questions: [],
        risks: [],
      }),
      reportResponse('executor', completedExecutor()),
      reportResponse('validator-1', failingValidator()),
    ], { maxValidationRounds: 1 })
    try {
      const result = await execute(harness.ctx, harness.parent)

      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('validator rejected the deliverable')
      expect((result.content[0] as { text: string }).text).toContain('Document the acceptance criterion.')
    } finally {
      await harness.parentHandle.dispose()
      await harness.ctx.fiber.dispose()
    }
  })
})

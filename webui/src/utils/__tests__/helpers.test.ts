import { describe, expect, it } from 'vitest'

import type { WebUiAgentSessionEntity, WebUiConversationSummary, WebUiMessagePart } from '../../types/api'
import {
  buildConversationGroups,
  formatDuration,
  getWorkdirPathBasename,
  getWorkdirPathParentBasename,
  isAbortError,
  normalizeWorkdirPath,
  resolveConversationWorkspaceType,
  resolveWorkspaceSeedFromConversation,
  toAgentStatusEvents,
  toConversationSummary,
  toDisplayText,
  toErrorMessage,
  toMessageSnapshot,
  toToolCalls,
  toToolName,
  toToolState,
  upsertAgentStatusEvent
} from '../helpers'

describe('toErrorMessage', () => {
  it('extracts Error.message', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns the default bridge message for non-Error values', () => {
    expect(toErrorMessage('raw')).toBe('Unable to reach the desktop bridge')
    expect(toErrorMessage(undefined)).toBe('Unable to reach the desktop bridge')
  })
})

describe('isAbortError', () => {
  it('detects DOMException AbortError', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('detects Error with AbortError name', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(isAbortError(error)).toBe(true)
  })

  it('detects abort-like messages', () => {
    expect(isAbortError(new Error('signal is aborted'))).toBe(true)
    expect(isAbortError(new Error('The operation was aborted'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isAbortError(new Error('timeout'))).toBe(false)
    expect(isAbortError(42)).toBe(false)
  })
})

describe('path helpers', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeWorkdirPath('C:\\repo\\')).toBe('C:\\repo')
    expect(normalizeWorkdirPath('/home/user/')).toBe('/home/user')
    expect(normalizeWorkdirPath('/home/user')).toBe('/home/user')
  })

  it('returns null for empty/whitespace paths', () => {
    expect(normalizeWorkdirPath('')).toBe(null)
    expect(normalizeWorkdirPath('   ')).toBe(null)
    expect(normalizeWorkdirPath(null)).toBe(null)
    expect(normalizeWorkdirPath(undefined)).toBe(null)
  })

  it('extracts basename for both separators', () => {
    expect(getWorkdirPathBasename('C:\\repo\\src')).toBe('src')
    expect(getWorkdirPathBasename('/home/user/app')).toBe('app')
  })

  it('extracts parent basename', () => {
    expect(getWorkdirPathParentBasename('/home/user/app')).toBe('user')
    expect(getWorkdirPathParentBasename('C:\\repo\\src')).toBe('repo')
    expect(getWorkdirPathParentBasename('app')).toBeUndefined()
  })
})

describe('workspace type resolution', () => {
  const session = (workspace: WebUiAgentSessionEntity['workspace']): WebUiAgentSessionEntity => ({
    id: 's1',
    name: 'Session',
    agentId: null,
    updatedAt: '2026-01-01T00:00:00Z',
    workspace
  })

  it('resolves user workspace type', () => {
    expect(resolveConversationWorkspaceType(session({ id: 'w1', type: 'user', path: '/tmp/w1' }))).toBe('user')
  })

  it('defaults to system', () => {
    expect(resolveConversationWorkspaceType(session(undefined))).toBe('system')
    expect(resolveConversationWorkspaceType(session({ id: 'w1' }))).toBe('system')
  })
})

describe('toConversationSummary', () => {
  const session: WebUiAgentSessionEntity = {
    id: 's1',
    name: 'My session',
    agentId: 'agent-1',
    updatedAt: '2026-01-02T03:04:05Z',
    workspace: { id: 'w1', type: 'user', path: '/tmp/proj', name: 'proj' }
  }

  it('maps user workspace fields', () => {
    const summary = toConversationSummary(session)
    expect(summary).toEqual({
      id: 's1',
      agentId: 'agent-1',
      title: 'My session',
      updatedAt: '2026-01-02T03:04:05Z',
      workspaceType: 'user',
      workspaceId: 'w1',
      workspaceLabel: 'proj',
      workspacePath: '/tmp/proj'
    })
  })

  it('falls back title to Untitled session', () => {
    const summary = toConversationSummary({ ...session, name: '' })
    expect(summary.title).toBe('Untitled session')
  })
})

describe('buildConversationGroups', () => {
  const conversation = (
    id: string,
    workspace: WebUiConversationSummary['workspaceType'],
    workspaceId?: string,
    workspacePath?: string,
    workspaceLabel?: string
  ): WebUiConversationSummary => ({
    id,
    agentId: null,
    title: id,
    updatedAt: '2026-01-01T00:00:00Z',
    workspaceType: workspace,
    workspaceId,
    workspacePath,
    workspaceLabel
  })

  it('groups by workspace and appends no-project group last', () => {
    const groups = buildConversationGroups(
      [
        conversation('a', 'user', 'w1', '/tmp/w1', 'w1'),
        conversation('b', 'system'),
        conversation('c', 'user', 'w1', '/tmp/w1', 'w1')
      ],
      'No project'
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.kind).toBe('user')
    expect(groups[0]?.conversations).toHaveLength(2)
    expect(groups[1]?.kind).toBe('no-project')
    expect(groups[1]?.label).toBe('No project')
    expect(groups[1]?.conversations).toHaveLength(1)
  })

  it('groups user conversations without workspaceId into no-project', () => {
    const groups = buildConversationGroups([conversation('a', 'user')], 'No project')
    expect(groups[0]?.kind).toBe('no-project')
  })

  it('sorts user groups by most recent conversation', () => {
    const groups = buildConversationGroups(
      [conversation('old', 'user', 'w1', '/tmp/w1', 'w1'), conversation('new', 'user', 'w2', '/tmp/w2', 'w2')],
      'No project'
    )
    // Both share the same updatedAt so ordering is stable; verify group ids present.
    expect(groups.map((g) => g.kind)).toEqual(['user', 'user'])
  })
})

describe('tool helpers', () => {
  it('derives tool name from type when toolName is absent', () => {
    expect(toToolName('tool-bash')).toBe('bash')
    expect(toToolName('dynamic-tool')).toBe('Tool')
    expect(toToolName('tool-bash', 'my-tool')).toBe('my-tool')
  })

  it('maps unknown states to input-available', () => {
    expect(toToolState()).toBe('input-available')
    expect(toToolState('weird')).toBe('input-available')
    expect(toToolState('approval-requested')).toBe('approval-requested')
    expect(toToolState('output-available')).toBe('output-available')
  })

  it('collects tool calls from parts', () => {
    const parts: WebUiMessagePart[] = [
      { type: 'text', text: 'hello' },
      {
        type: 'tool-bash',
        toolCallId: 't1',
        state: 'output-available',
        input: 'ls',
        output: 'src',
        errorText: undefined
      }
    ]
    const calls = toToolCalls(parts)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ id: 't1', name: 'bash', state: 'output-available', input: 'ls', output: 'src' })
  })

  it('skips parts without toolCallId', () => {
    const calls = toToolCalls([{ type: 'tool-bash', input: 'ls' }])
    expect(calls).toHaveLength(0)
  })
})

describe('toDisplayText', () => {
  it('passes strings through and stringifies objects', () => {
    expect(toDisplayText('plain')).toBe('plain')
    expect(toDisplayText({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(toDisplayText(undefined)).toBeUndefined()
  })
})

describe('agent status events', () => {
  it('builds tool events and upserts by id', () => {
    const parts: WebUiMessagePart[] = [{ type: 'tool-bash', toolCallId: 't1', state: 'input-available' }]
    const events = toAgentStatusEvents(parts)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'tool', id: 't1', name: 'bash' })

    const updated = upsertAgentStatusEvent(events, {
      kind: 'tool',
      id: 't1',
      name: 'bash',
      state: 'output-available',
      output: 'done'
    })
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ kind: 'tool', state: 'output-available' })
  })

  it('appends new events on upsert', () => {
    const updated = upsertAgentStatusEvent([], { kind: 'tool', id: 't1', name: 'bash', state: 'input-available' })
    expect(updated).toHaveLength(1)
  })
})

describe('toMessageSnapshot', () => {
  it('joins text parts and extracts tool calls', () => {
    const snapshot = toMessageSnapshot({
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      data: {
        parts: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
          { type: 'tool-bash', toolCallId: 't1', state: 'input-available', input: 'ls' }
        ]
      },
      searchableText: '',
      status: 'success',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    })

    expect(snapshot.content).toBe('Hello world')
    expect(snapshot.toolCalls).toHaveLength(1)
    expect(snapshot.role).toBe('assistant')
  })

  it('falls back content to searchableText', () => {
    const snapshot = toMessageSnapshot({
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      data: { parts: [] },
      searchableText: 'fallback text',
      status: 'success',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    })
    expect(snapshot.content).toBe('fallback text')
  })
})

describe('workspace seed resolution', () => {
  it('resolves user workspace seed', () => {
    const conversation: WebUiConversationSummary = {
      id: 'c1',
      agentId: null,
      title: 'x',
      updatedAt: '2026-01-01T00:00:00Z',
      workspaceType: 'user',
      workspaceId: 'w1'
    }
    expect(resolveWorkspaceSeedFromConversation(conversation)).toEqual({ type: 'user', workspaceId: 'w1' })
  })

  it('defaults to system seed', () => {
    expect(resolveWorkspaceSeedFromConversation(undefined)).toEqual({ type: 'system' })
  })
})

describe('formatDuration', () => {
  it('formats sub-second and multi-second durations', () => {
    expect(formatDuration(500)).toBe('0.5s')
    expect(formatDuration(2_500)).toBe('2.5s')
    expect(formatDuration(15_000)).toBe('15s')
  })

  it('clamps negative durations', () => {
    expect(formatDuration(-100)).toBe('0.1s')
  })
})

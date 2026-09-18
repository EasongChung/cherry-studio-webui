import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { WebUiAgentStatus, WebUiAgentTask } from '../../utils/agentStatus'
import type { TextKey } from '../../utils/textPacks'
import TaskProgressWidget from '../TaskProgressWidget.vue'

const text = (key: TextKey): string => key

const status = (tasks: readonly WebUiAgentTask[]): WebUiAgentStatus => ({
  tasks,
  completedTaskCount: tasks.filter((task) => task.status === 'completed').length,
  totalTaskCount: tasks.length,
  subagents: [],
  artifacts: []
})

const mountWidget = (over: { tasks?: readonly WebUiAgentTask[]; streaming?: boolean } = {}) =>
  mount(TaskProgressWidget, {
    props: {
      status: status(over.tasks ?? []),
      streaming: over.streaming ?? false,
      text
    }
  })

// jsdom 30 lacks PointerEvent, and MouseEventInit rejects `pointerId`; route around both.
const pointerEvent = (type: string, clientX: number, clientY: number, pointerId = 1) => {
  const init: { clientX: number; clientY: number; bubbles: true } = { bubbles: true, clientX, clientY }
  return typeof PointerEvent !== 'undefined'
    ? new PointerEvent(type, { ...init, pointerId })
    : Object.assign(new MouseEvent(type, init), { pointerId })
}

const sampleTasks: readonly WebUiAgentTask[] = [
  { id: '1', title: 'Read config', status: 'completed' },
  { id: '2', title: 'Edit source', activeText: 'Editing app.ts', status: 'in_progress' },
  { id: '3', title: 'Run tests', status: 'pending' }
]

describe('TaskProgressWidget', () => {
  it('renders the collapsed ball with completed/total count', () => {
    const wrapper = mountWidget({ tasks: sampleTasks, streaming: true })
    const ball = wrapper.find('button.task-progress-ball')
    expect(ball.exists()).toBe(true)
    expect(ball.text()).toBe('1/3')
  })

  it('expands to a task timeline on ball click', async () => {
    const wrapper = mountWidget({ tasks: sampleTasks })
    await wrapper.find('button.task-progress-ball').trigger('click')
    expect(wrapper.find('.task-progress-panel').exists()).toBe(true)
    const titles = wrapper.findAll('.agent-status-item-title').map((n) => n.text())
    expect(titles).toEqual(['Read config', 'Editing app.ts', 'Run tests'])
    expect(wrapper.findAll('.agent-status-item')).toHaveLength(3)
  })

  it('collapses again on the close control', async () => {
    const wrapper = mountWidget({ tasks: sampleTasks })
    await wrapper.find('button.task-progress-ball').trigger('click')
    await wrapper.find('button.task-progress-collapse').trigger('click')
    expect(wrapper.find('.task-progress-panel').exists()).toBe(false)
    expect(wrapper.find('button.task-progress-ball').exists()).toBe(true)
  })

  // jsdom implements no pointer-capture retargeting, so the click above stays green even
  // when a browser would route it to the drag handle. Assert the capture contract instead.
  it('never captures the pointer for a press that starts on the collapse control', async () => {
    const wrapper = mountWidget({ tasks: sampleTasks })
    await wrapper.find('button.task-progress-ball').trigger('click')

    const header = wrapper.find('.task-progress-header').element as HTMLElement
    const capture = vi.fn()
    header.setPointerCapture = capture

    const collapse = wrapper.find('button.task-progress-collapse')
    collapse.element.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    expect(capture).not.toHaveBeenCalled()

    await collapse.trigger('click')
    expect(wrapper.find('.task-progress-panel').exists()).toBe(false)
  })

  it('does not expand the ball when the press was a drag', async () => {
    const wrapper = mountWidget({ tasks: sampleTasks })
    const ball = wrapper.find('button.task-progress-ball')
    ;(ball.element as HTMLElement).setPointerCapture = vi.fn()

    ball.element.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    ball.element.dispatchEvent(pointerEvent('pointermove', 180, 160))
    await wrapper.vm.$nextTick()
    await ball.trigger('click')

    expect(wrapper.find('.task-progress-panel').exists()).toBe(false)
  })

  it('enables the abort button only while streaming and emits abort', async () => {
    const idle = mountWidget({ tasks: sampleTasks, streaming: false })
    await idle.find('button.task-progress-ball').trigger('click')
    const idleAbort = idle.find('button.task-progress-abort')
    expect((idleAbort.element as HTMLButtonElement).disabled).toBe(true)
    await idleAbort.trigger('click')
    expect(idle.emitted('abort')).toBeUndefined()

    const live = mountWidget({ tasks: sampleTasks, streaming: true })
    await live.find('button.task-progress-ball').trigger('click')
    const liveAbort = live.find('button.task-progress-abort')
    expect((liveAbort.element as HTMLButtonElement).disabled).toBe(false)
    await liveAbort.trigger('click')
    expect(live.emitted('abort')).toHaveLength(1)
  })
})
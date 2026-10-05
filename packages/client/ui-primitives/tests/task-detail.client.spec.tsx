// @vitest-environment jsdom
/** Section navigation preserves local forms and keeps every tab linked to its panel. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskDetail } from '../src/TaskWorkspace.tsx'

afterEach(cleanup)

it('preserves an unfinished form across section changes and supports keyboard navigation', () => {
  const execute = vi.fn()
  render(<TaskDetail taskId="one" title="Task" labels={{ taskDetail: 'Task details', hideDetails: 'Close' }} onClose={() => {}}
    sections={[
      { id: 'overview', label: 'Overview', content: <label>Draft<input defaultValue="" /></label> },
      { id: 'execution', label: 'Execution', content: <button onClick={execute}>Start</button> },
    ]} />)
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unfinished work' } })
  const first = screen.getByRole('tab', { name: 'Overview' })
  fireEvent.keyDown(first, { key: 'ArrowRight' })
  const second = screen.getByRole('tab', { name: 'Execution' })
  expect(document.activeElement).toBe(second)
  expect(second.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id)
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(second.id)
  expect(execute).not.toHaveBeenCalled()
  fireEvent.keyDown(second, { key: 'Home' })
  expect(screen.getByLabelText<HTMLInputElement>('Draft').value).toBe('Unfinished work')
  expect(first.getAttribute('aria-selected')).toBe('true')
})

it('opens the overview and resets body scrolling when a different task is selected', () => {
  const props = { title: 'Task', labels: { taskDetail: 'Task details', hideDetails: 'Close' }, onClose: vi.fn(),
    sections: [
      { id: 'overview', label: 'Overview', content: <p>Scope</p> },
      { id: 'history', label: 'History', content: <p>Records</p> },
    ] as const }
  const view = render(<TaskDetail {...props} taskId="one" />)
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
  const body = screen.getByRole('tabpanel').parentElement!
  body.scrollTop = 120
  view.rerender(<TaskDetail {...props} taskId="two" />)
  expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  expect(body.scrollTop).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(props.onClose).toHaveBeenCalledOnce()
})

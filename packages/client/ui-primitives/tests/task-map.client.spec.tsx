// @vitest-environment jsdom
/** Wheel zoom and fullscreen interactions in a detached DOM. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskMap, type TaskMapLabels } from '../src/TaskMap.tsx'
afterEach(cleanup)
const labels: TaskMapLabels = { mindMap: 'Task map', mapCount: '1 node', mapControls: 'Controls', zoomOut: 'Zoom out',
  actualSize: 'Actual size', zoomLevel: 'Zoom {percent}%', zoomIn: 'Zoom in', fitMap: 'Fit', locateTask: 'Locate',
  invalidHierarchy: 'Invalid', mapHint: 'Scroll to zoom', rootTask: 'Root', requiredNode: 'Required', optionalNode: 'Optional',
  hierarchyHint: 'Hierarchy', expandAll: 'Expand all', expandBranch: 'Expand {goal}', collapseBranch: 'Collapse {goal}',
  fullscreen: 'Full screen', exitFullscreen: 'Exit full screen' }
function mount() {
  return render(<TaskMap tasks={[{ id: 'root', parentTaskId: null, goal: 'Task', phaseTitle: '', required: true, status: '', statusLabel: '' }]}
    rootId="root" selected={null} onSelect={() => {}} labels={labels} />)
}
it('zooms on the wheel and consumes scrolling while keeping the zoom bounded', () => {
  mount()
  const viewport = screen.getByRole('region', { name: labels.mapHint })
  Object.defineProperties(viewport, { clientWidth: { value: 100 }, clientHeight: { value: 100 } })
  viewport.scrollLeft = 40; viewport.scrollTop = 30
  const wheel = new WheelEvent('wheel', { deltaY: -120, clientX: 20, clientY: 30, bubbles: true, cancelable: true })
  fireEvent(viewport, wheel)
  expect(wheel.defaultPrevented).toBe(true)
  const scale = Number(viewport.firstElementChild?.getAttribute('style')?.match(/--zoom: ([^;]+)/)?.[1])
  expect((viewport.scrollLeft + 20) / scale).toBeCloseTo(60)
  expect((viewport.scrollTop + 30) / scale).toBeCloseTo(60)
  expect(screen.getByRole('button', { name: 'Zoom 120%' })).toBeTruthy()
  fireEvent.wheel(viewport, { deltaY: -10000 })
  expect(screen.getByRole('button', { name: 'Zoom 150%' })).toBeTruthy()
  fireEvent.wheel(viewport, { deltaY: 10000 })
  expect(screen.getByRole('button', { name: 'Zoom 25%' })).toBeTruthy()
})
it('enters fullscreen, keeps task selection available and exits with the button or Escape', () => {
  const view = mount()
  fireEvent.click(screen.getByRole('button', { name: labels.fullscreen }))
  expect(view.container.querySelector('[data-fullscreen="true"]')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Task' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: labels.exitFullscreen }))
  expect(view.container.querySelector('[data-fullscreen="true"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: labels.fullscreen }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.container.querySelector('[data-fullscreen="true"]')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: labels.fullscreen }))
})

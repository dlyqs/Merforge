// @vitest-environment jsdom
/** Anchored form panels preserve native controls and fit above the composer. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Menu } from '../src/Menu.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('enters from the trigger, preserves form keys, and returns focus on Escape', () => {
  const close = vi.fn()
  render(<Menu open portal role="dialog" label="Execution" onClose={close} anchor={<button>Trigger</button>}>
    <label>Batch<input type="number" defaultValue={2} /></label>
    <button>Confirm</button>
  </Menu>)
  const trigger = screen.getByRole('button', { name: 'Trigger' }), input = screen.getByRole('spinbutton')
  trigger.focus()
  expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(false)
  expect(document.activeElement).toBe(input)
  expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true)
  expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true)
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true)
  expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true)
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(trigger)
})

it('caps a large top panel to available space and keeps its footer outside the scrolling content', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 350, 80, 28))
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(700)
  render(<Menu open portal side="top" role="dialog" label="Execution" onClose={() => {}} anchor={<button>Trigger</button>}
    panelFooter={<button>Bind</button>}><label>Batch<input /></label></Menu>)
  const dialog = screen.getByRole('dialog')
  expect(dialog.style.maxHeight).toBe('334px')
  expect(dialog.style.top).toBe('12px')
  expect(dialog.contains(screen.getByRole('button', { name: 'Bind' }))).toBe(true)
  expect(screen.getByRole('button', { name: 'Bind' }).parentElement).not.toBe(screen.getByRole('textbox').parentElement?.parentElement)
})

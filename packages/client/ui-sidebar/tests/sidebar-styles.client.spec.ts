/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('reserves a persistent rail and an independently scrolling browser', () => {
    expect(declarations('.rail')?.get('flex')).toBe('0 0 72px')
    expect(declarations('.secondary')?.get('min-width')).toBe('0')
    expect(declarations('.regionArea')?.get('min-height')).toBe('0')
    expect(declarations('.footArea')?.get('margin-top')).toBe('auto')
  })

  it('keeps the avatar below macOS traffic lights', () => {
    expect(declarations(":global(html[data-platform='darwin']) .rail")?.get('padding-top')).toBe('52px')
    expect(declarations(":global(html[data-platform='darwin'][data-fullscreen]) .rail")?.get('padding-top')).toBe('20px')
  })
})

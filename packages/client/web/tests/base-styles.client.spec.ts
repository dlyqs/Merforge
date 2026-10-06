/** Shell base styles stay independent from the dynamically loaded theme bundle. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const THEME_PACKAGE = '@deepseek-ai/dsh-client-ui-theme'
const baseCss = readFileSync(fileURLToPath(new URL('../src/base.css', import.meta.url)), 'utf8')

/**
 * Import specifiers of the sheet, in source order. Quote style and surrounding
 * whitespace are intentionally irrelevant; duplicate imports remain visible.
 * @param css - stylesheet text.
 * @returns import specifiers in declaration order.
 */
function importOrder(css: string): string[] {
  return [...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, specifier = '']) => specifier)
}

const imports = importOrder(baseCss)
const normalizedCss = baseCss
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll(/\s+/g, ' ')
const literalContentSelectors = [
  'code',
  'pre',
  '[data-diff]',
  '[data-read]',
  '[data-search]',
  '[data-terminal]',
]

describe('web shell base.css', () => {
  it('leaves theme styles to the dynamic ui-theme client entry', () => {
    expect(imports).toEqual([])
    expect(baseCss).not.toContain(THEME_PACKAGE)
  })

  it.each(['darwin', 'win32'])('excludes controls and portalled overlays from the %s window drag band', (platform) => {
    const rules = [...baseCss.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body = '']) => /-webkit-app-region:\s*no-drag;/.test(body))
    expect(rules).toHaveLength(2)
    for (const [, selector = ''] of rules) expect(selector).toContain(`[data-platform='${platform}']`)
    expect(rules[0]![1]).toContain('body > :not(#root)')
    for (const control of ['button', "[role='menu']", "[role='menuitem']", "[role='tab']", '[tabindex]']) {
      expect(rules[1]![1]).toContain(control)
    }
  })

  it('auto-spaces prose while preserving literal content', () => {
    expect(baseCss).toMatch(/body\s*\{[^}]*text-autospace:\s*normal;/)
    expect(normalizedCss).toContain(
      `${literalContentSelectors.join(', ')} { text-autospace: no-autospace; }`,
    )
  })
})

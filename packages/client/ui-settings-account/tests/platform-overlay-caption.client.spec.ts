/** Desktop return-bar clearance for traffic lights. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/PlatformOverlay.module.css', import.meta.url)), 'utf8')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(css.replace(/\/\*[\s\S]*?\*\//g, ' '))
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

it('reserves inline space for Desktop traffic lights on both platforms', () => {
  expect(declarations(':global(html:is([data-platform="darwin"], [data-platform="win32"])) .trafficLights')).toContain('display: block')
  expect(css).not.toContain('data-windows-titlebar')
})

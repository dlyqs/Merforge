import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Schema {
  definitions?: Record<string, Schema>
  required?: string[]
  properties?: Record<string, unknown>
  [key: string]: unknown
}
interface Evidence {
  fields: unknown
  definitions?: Record<string, unknown>
  threadRequired?: string[]
  threadFields?: string[]
}
const evidence = JSON.parse(readFileSync(new URL('./fixtures/protocol-0.153.4.json', import.meta.url), 'utf8')) as {
  version: string
  schemas: Record<string, Evidence>
  stableFields: Record<string, Record<string, boolean>>
}
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['description', 'title', 'definitions', '$schema'].includes(key))
      .map(([key, item]) => [key, strip(item)]))
  }
  return value
}

describe('Codex 0.153.4 protocol evidence', () => {
  it('matches the pinned payload offline without starting a server or reading credentials', () => {
    const require = createRequire(new URL('../package.json', import.meta.url))
    const path = require.resolve('@openai/codex/package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version: string; bin: { codex: string } }
    const bin = resolve(dirname(path), pkg.bin.codex)
    const root = mkdtempSync(join(tmpdir(), 'merforge-codex-protocol-'))
    try {
      const env = { PATH: process.env.PATH, HOME: root, CODEX_HOME: root }
      expect(pkg.version).toBe(evidence.version)
      expect(execFileSync(process.execPath, [bin, '--version'], { env, encoding: 'utf8' }).trim()).toBe(`codex-cli ${evidence.version}`)
      execFileSync(process.execPath, [bin, 'app-server', 'generate-json-schema', '--experimental', '--out', root], { env, stdio: 'pipe' })
      for (const [file, expected] of Object.entries(evidence.schemas)) {
        const schema = JSON.parse(readFileSync(join(root, file), 'utf8')) as Schema
        expect(strip(schema), file).toEqual(expected.fields)
        for (const [name, definition] of Object.entries(expected.definitions ?? {})) {
          expect(strip(schema.definitions?.[name]), `${file}#${name}`).toEqual(definition)
        }
        if (expected.threadRequired !== undefined) {
          expect(schema.definitions?.Thread?.required).toEqual(expected.threadRequired)
          expect(Object.keys(schema.definitions?.Thread?.properties ?? {})).toEqual(expected.threadFields)
        }
      }
      const stable = join(root, 'stable')
      execFileSync(process.execPath, [bin, 'app-server', 'generate-json-schema', '--out', stable], { env, stdio: 'pipe' })
      for (const [file, fields] of Object.entries(evidence.stableFields)) {
        const schema = JSON.parse(readFileSync(join(stable, file), 'utf8')) as Schema
        for (const [field, present] of Object.entries(fields)) {
          expect(Object.hasOwn(schema.properties ?? {}, field), `${file}.${field}`).toBe(present)
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

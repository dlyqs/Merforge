import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { packPreviewFixture } from '../src/preview.ts'

function fixture(version: number): { root: string; bytes: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-preview-current-'))
  const directory = join(root, 'sessions', 'project', 'example')
  mkdirSync(directory, { recursive: true })
  const bytes = JSON.stringify({ type: 'session', version, id: 'example', createdAt: 1,
    isSeeded: false, delegationDepth: 0 }) + '\n'
  writeFileSync(join(directory, `session.v${version}.jsonl`), bytes)
  return { root, bytes }
}

describe('Preview Session fixtures', () => {
  it('keeps a validated current Session unchanged', () => {
    const { root, bytes } = fixture(4)
    try {
      const overlay = packPreviewFixture([{ mount: 'home', directory: root }])
      expect(new TextDecoder().decode(overlay.files['home/sessions/project/example/session.v4.jsonl'])).toBe(bytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses an older Session format', () => {
    const { root } = fixture(3)
    try {
      expect(() => packPreviewFixture([{ mount: 'home', directory: root }])).toThrow('unsupported Session format v3')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

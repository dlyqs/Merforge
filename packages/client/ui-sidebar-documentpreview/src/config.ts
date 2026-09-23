/** Cache limits shared by the Host configuration and browser document previews. */
import z from '@deepseek-ai/schemastery'

/** Browser document preview limits. */
export interface Config {
  /** Browser spreadsheet parser and dense cell allocation limits. */
  excel: {
    /** Maximum source file bytes. */
    maxBytes: number
    /** Maximum combined rectangular cell area across worksheets. */
    maxCells: number
    /** Maximum parser Worker lifetime in milliseconds. */
    timeoutMs: number
  }
}

/** Deployment limits for document previews. */
export const Config: z<{ excel?: Partial<Config['excel']> }, Config> = z.object({
  excel: z.object({
    maxBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(16 * 1024 * 1024),
    maxCells: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(250_000),
    timeoutMs: z.natural().min(1).max(2_147_483_647).default(15_000),
  }),
})

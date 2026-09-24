/** Pure Session affiliation fold used for live and restored Sessions. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AffiliationProjection, BotId, ProjectId } from './types.ts'

const namedProject = z.object({ id: z.uuid().transform(id => id as ProjectId), name: z.string() }).strict()
const namedBot = z.object({ id: z.uuid().transform(id => id as BotId), name: z.string() }).strict()
const snapshot = z.object({ project: namedProject.optional(), bot: namedBot.optional() }).strict()
const affiliation = z.object({
  projectId: z.uuid().transform(id => id as ProjectId).optional(),
  botId: z.uuid().transform(id => id as BotId).optional(),
}).strict()
const change = z.object({
  from: snapshot,
  to: snapshot,
  source: z.enum(['create', 'move', 'delete']),
  seq: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
}).strict()
const stateSchema = z.object({ current: affiliation, history: z.array(change) }).strict()

/** Session-log-derived classification and history, shared by Host and Client readers. */
export const personalAffiliationProjection = {
  key: 'personalAffiliation',
  stateVersion: 1,
  stateSchema: stateSchema as z.ZodType<AffiliationProjection>,
  init: () => ({ current: {}, history: [] }),
  apply: (state, event) => {
    if (event.type !== 'personal/affiliation') return state
    const { to, from, source } = event.data
    return {
      current: {
        ...(to.project === undefined ? {} : { projectId: to.project.id }),
        ...(to.bot === undefined ? {} : { botId: to.bot.id }),
      },
      history: [...state.history, { from, to, source, seq: event.seq, time: event.time }],
    }
  },
  wire: { viewSchema: stateSchema, view: state => state },
} satisfies ProjectionDefinition<'personalAffiliation', AffiliationProjection>

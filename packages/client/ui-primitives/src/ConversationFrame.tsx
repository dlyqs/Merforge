/** Shared conversation frame for account-owned transcripts and composers. */
import type { ReactNode } from 'react'
import css from './ConversationFrame.module.css'
import composer from './ConversationComposer.module.css'
/** Existing conversation header, scrollport and composer-seat class names. */
export const conversationFrameStyles = css
/** Existing conversation input card and toolbar class names. */
export const conversationComposerStyles = composer

/** @param props - Conversation phase and rendered account-owned content. @returns The common main conversation frame. */
export function ConversationFrame({ phase, children }: { phase: 'hero' | 'active' | 'settling'; children: ReactNode }) {
  return <div className={css.root} data-phase={phase}>{children}</div>
}

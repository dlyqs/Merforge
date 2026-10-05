/** Session-header access to the shared feedback dialog. */
import { useState } from 'react'
import { Button, IconEllipsisOutlineRegular, IconPaperPlaneOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Open the Session feedback draft from the header menu.
 * @param props - Session identity, localized copy and feedback callback.
 * @returns Header menu with the feedback action.
 */
export function SessionFeedbackAction(props: PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'feedback'> & { openFeedback(): void }) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} align="end" dense onClose={() => { setOpen(false) }}
    items={[{ id: 'feedback', label: props.t('header.feedback'), icon: <IconPaperPlaneOutlineRegular /> }]}
    onSelect={() => { setOpen(false); props.openFeedback() }}
    anchor={<Button variant="toolbar" aria-label={props.t('header.more')} aria-haspopup="menu" aria-expanded={open}
      icon={<IconEllipsisOutlineRegular />} onClick={() => { setOpen(value => !value) }} />} />
}

/** Named member selection respects the directory already supplied by native authorization. */
import { useId } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationKey } from './locales.ts'
import css from './Organization.module.css'

/**
 * Select from the authorized directory, retaining an explicit identifier fallback when no directory is available.
 * @param props - Current identity, selected member and localized field label.
 * @returns Named member selector with disabled-member indicators.
 */
export function MemberSelect(props: Pick<OrganizationProps, 't'> & {
  connection: ConnectionSnapshot
  labelKey: OrganizationKey
  value: string
  change: (value: string) => void
  disabled?: boolean
}) {
  const { t, connection: c } = props
  const id = useId()
  const own = c.organizations.find(org => org.id === c.organizationId)?.membershipId
  const choices = c.members.map(member => ({ id: member.id, name: member.username, enabled: member.enabled && member.accountEnabled }))
  if (own && !choices.some(member => member.id === own)) choices.unshift({ id: own, name: c.username ?? t('me'), enabled: true })
  return <div className={css.field}>
    <label htmlFor={id}>{t(props.labelKey)}</label>
    <select id={id} disabled={props.disabled} value={props.value} onChange={(event) => { props.change(event.target.value) }}>
      <option value="">{t('chooseMember')}</option>
      {props.value && !choices.some(member => member.id === props.value) && <option value={props.value}>{t('selectedMember')}</option>}
      {choices.map(member => <option key={member.id} value={member.id} disabled={!member.enabled && props.value !== member.id}>
        {member.name}{member.id === own ? ` · ${t('me')}` : ''}{member.enabled ? '' : ` · ${t('disabledMember')}`}
      </option>)}
    </select>
    {!c.members.length && <details className={css.advanced}><summary>{t('memberById')}</summary>
      <p className={css.muted}>{t('memberDirectoryHint')}</p>
      <Input aria-label={t('memberIdentifier')} disabled={props.disabled} value={props.value} onChange={(event) => { props.change(event.target.value.trim()) }} />
    </details>}
  </div>
}

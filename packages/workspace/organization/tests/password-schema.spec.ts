/** Password length is consistent across account creation and credential changes. */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { initializeSchema, registerSchema, loginSchema, recoverySchema, commandSchema } from '../src/schema.ts'

it('accepts eight characters and rejects seven at every credential entry', () => {
  const operationId = randomUUID(), token = 'a'.repeat(43)
  for (const password of ['1234567', '12345678']) {
    const results = [
      initializeSchema.safeParse({ operationId, username: 'owner', password, organizationName: 'Team', recoveryToken: token }),
      registerSchema.safeParse({ operationId, username: 'member', password, invitationToken: token }),
      loginSchema.safeParse({ username: 'owner', password }),
      recoverySchema.safeParse({ operationId, recoveryToken: token, newRecoveryToken: 'b'.repeat(43), newPassword: password }),
      commandSchema.safeParse({ operationId, kind: 'change-password', currentPassword: '12345678', newPassword: password }),
    ]
    expect(results.map(result => result.success)).toEqual(Array(5).fill(password.length === 8))
  }
})

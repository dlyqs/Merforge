/** Transactional organization identity authority, independent of personal Host services. */
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { openOrganizationDatabase, transaction } from './database.ts'
import { OrganizationError } from './error.ts'
import { createOrganizationToken, digestToken, hashPassword, requestFingerprint, verifyPassword } from './security.ts'
import { accountSchema, commandSchema, configSchema, initializeSchema, invitationSchema, loginSchema, membershipSchema, metadataSchema, organizationSchema, receiptRowSchema, receiptSchema, recoverySchema, registerSchema, sessionSchema, attemptSchema } from './schema.ts'
import type { AccountId, LoginResult, LoginToken, MemberView, OperationId, OrganizationAction, OrganizationId, OrganizationView, Principal, Receipt } from './types.ts'

export type * from './types.ts'
export { OrganizationError } from './error.ts'
export { ORGANIZATION_SCHEMA_VERSION } from './database.ts'
export { createOrganizationToken } from './security.ts'

/** Deployment settings parsed once before database initialization. */
export type Config = z.input<typeof configSchema>
type Command = z.output<typeof commandSchema>
type Account = z.output<typeof accountSchema>
type Membership = z.output<typeof membershipSchema>
type ResultIds = Omit<Receipt, 'operationId' | 'revision'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    organization: OrganizationService
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new OrganizationError('invalid-input')
  return result.data
}

/** Owns durable accounts, memberships and authorization decisions for one organization database. */
export class OrganizationService extends Service {
  static Config = configSchema
  private readonly config: z.output<typeof configSchema>
  private db: DatabaseSync | undefined
  private tail: Promise<void> = Promise.resolve()
  private closing = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'organization')
    this.config = parse(configSchema, config)
  }

  protected [Service.init](): void {
    const db = openOrganizationDatabase(this.config.path, this.config.busyTimeoutMs)
    this.db = db
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail
      db.close()
      this.db = undefined
    }, 'organization.close')
  }

  private enqueue<T>(operation: string, work: (db: DatabaseSync) => Promise<T> | T): Promise<T> {
    if (this.closing || !this.db) return Promise.reject(new OrganizationError('closed'))
    const db = this.db
    const result = this.tail.then(() => work(db))
    this.tail = result.then(() => {}, (error: unknown) => {
      const code = error instanceof OrganizationError ? error.code : 'storage-or-runtime-failure'
      this.ctx.logger.warn('organization operation=%s result=rejected decisionCode=%s', operation, code)
    })
    return result
  }

  private metadata(db: DatabaseSync) { return metadataSchema.parse(db.prepare('SELECT * FROM metadata').get()) }

  private account(db: DatabaseSync, accountId: AccountId): Account {
    const row = db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId)
    if (!row) throw new OrganizationError('unauthenticated')
    return accountSchema.parse(row)
  }

  private principal(db: DatabaseSync, token: LoginToken, organizationId?: OrganizationId, action: OrganizationAction = 'member'): Principal {
    const row = db.prepare('SELECT * FROM login_sessions WHERE tokenHash=?').get(digestToken(token))
    if (!row) throw new OrganizationError('unauthenticated')
    const session = sessionSchema.parse(row)
    const account = this.account(db, session.accountId)
    if (session.expiresAt <= Date.now() || account.enabled !== 1) throw new OrganizationError('unauthenticated')
    const principal: Principal = { serverId: this.metadata(db).serverId, accountId: account.id }
    if (organizationId !== undefined) {
      const member = this.member(db, account.id, organizationId)
      if (member.enabled !== 1 || (action === 'manage' && member.role !== 'admin')) throw new OrganizationError('forbidden')
      return { ...principal, organizationId, membershipId: member.id, role: member.role }
    }
    return principal
  }

  private member(db: DatabaseSync, accountId: AccountId, organizationId: OrganizationId): Membership {
    const row = db.prepare('SELECT * FROM memberships WHERE accountId=? AND organizationId=?').get(accountId, organizationId)
    if (!row) throw new OrganizationError('forbidden')
    return membershipSchema.parse(row)
  }

  private event(db: DatabaseSync, kind: string, actorId: AccountId | null, organizationId: OrganizationId | null): number {
    return Number(db.prepare('INSERT INTO organization_events(kind,actorId,organizationId,at) VALUES (?,?,?,?)')
      .run(kind, actorId, organizationId, Date.now()).lastInsertRowid)
  }

  private previous(db: DatabaseSync, scope: string, operationId: OperationId, fingerprint: string): Receipt | undefined {
    const row = db.prepare('SELECT * FROM operation_receipts WHERE scope=? AND operationId=?').get(scope, operationId)
    if (!row) return undefined
    const stored = receiptRowSchema.parse(row)
    if (stored.fingerprint !== fingerprint) throw new OrganizationError('operation-conflict')
    return receiptSchema.parse(JSON.parse(stored.response))
  }

  private mutate(
    db: DatabaseSync, scope: string, input: { operationId: OperationId }, kind: string,
    actorId: AccountId | null, organizationId: OrganizationId | null, fingerprint: string, work: (revision: number) => ResultIds,
  ): Receipt {
    const revision = this.event(db, kind, actorId, organizationId)
    const receipt: Receipt = { operationId: input.operationId, revision, ...work(revision) }
    db.prepare('INSERT INTO operation_receipts VALUES (?,?,?,?)').run(scope, input.operationId, fingerprint, JSON.stringify(receipt))
    return receipt
  }

  private recordCommit(receipt: Receipt): Receipt {
    this.ctx.logger.info('organization operationId=%s revision=%s result=committed', receipt.operationId, receipt.revision)
    return receipt
  }

  private assertUsernameAvailable(db: DatabaseSync, username: string): void {
    if (db.prepare('SELECT id FROM accounts WHERE username=?').get(username)) throw new OrganizationError('username-taken')
  }

  private assertAdministrators(db: DatabaseSync): void {
    const orphan = db.prepare(`SELECT o.id FROM organizations o WHERE NOT EXISTS (
      SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.accountId
      WHERE m.organizationId=o.id AND m.role='admin' AND m.enabled=1 AND a.enabled=1) LIMIT 1`).get()
    if (orphan) throw new OrganizationError('last-admin')
  }

  /**
   * Initialize once through the private local control channel, never a LAN route.
   * @param input - Strict initialization JSON, including Host-generated recovery credential.
   * @returns Committed receipt; an identical private retry returns that same receipt.
   */
  initialize(input: unknown): Promise<Receipt> {
    return this.enqueue('initialize', async (db) => {
      const request = parse(initializeSchema, input)
      const fingerprint = await requestFingerprint('initialize', request, true)
      const previous = this.previous(db, 'initialize', request.operationId, fingerprint)
      if (previous) return previous
      if (this.metadata(db).rootAccountId) throw new OrganizationError('already-initialized')
      const passwordHash = await hashPassword(request.password)
      const receipt = transaction(db, () => {
        const retry = this.previous(db, 'initialize', request.operationId, fingerprint)
        if (retry) return retry
        if (this.metadata(db).rootAccountId) throw new OrganizationError('already-initialized')
        const accountId = brandString<AccountId>(randomUUID())
        const organizationId = brandString<OrganizationId>(randomUUID())
        return this.mutate(db, 'initialize', request, 'initialize', accountId, organizationId, fingerprint, (revision) => {
          db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(accountId, request.username, passwordHash, 1, revision)
          db.prepare('INSERT INTO organizations VALUES (?,?,?)').run(organizationId, request.organizationName, revision)
          const membershipId = this.insertMember(db, accountId, organizationId, 'admin', revision)
          db.prepare('UPDATE metadata SET rootAccountId=?,rootOrganizationId=?,recoveryHash=?').run(accountId, organizationId, digestToken(request.recoveryToken))
          return { accountId, organizationId, membershipId }
        })
      })
      return this.recordCommit(receipt)
    })
  }

  private insertMember(db: DatabaseSync, accountId: AccountId, organizationId: OrganizationId, role: 'admin' | 'member', version: number) {
    const id = membershipSchema.shape.id.parse(randomUUID())
    db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?,?)').run(id, organizationId, accountId, role, 1, version)
    return id
  }

  private invitation(db: DatabaseSync, token: string) {
    const row = db.prepare('SELECT * FROM invitations WHERE tokenHash=?').get(digestToken(token))
    if (!row) throw new OrganizationError('invalid-invitation')
    const invitation = invitationSchema.parse(row)
    if (invitation.consumed !== 0 || invitation.expiresAt <= Date.now()) throw new OrganizationError('invalid-invitation')
    const issuer = db.prepare(`SELECT m.id FROM memberships m JOIN accounts a ON a.id=m.accountId
      WHERE m.id=? AND m.organizationId=? AND m.enabled=1 AND m.role='admin' AND a.enabled=1`).get(invitation.issuerId, invitation.organizationId)
    if (!issuer) throw new OrganizationError('invalid-invitation')
    return invitation
  }

  /**
   * Atomically consume an invitation, create an account and attach its membership.
   * @param input - Strict registration JSON; existing accounts use accept-invitation instead.
   * @returns Durable receipt without a login token.
   */
  register(input: unknown): Promise<Receipt> {
    return this.enqueue('register', async (db) => {
      const request = parse(registerSchema, input)
      const scope = `register:${digestToken(request.invitationToken)}`
      const fingerprint = await requestFingerprint(scope, request, true)
      const previous = this.previous(db, scope, request.operationId, fingerprint)
      if (previous) return previous
      this.invitation(db, request.invitationToken)
      this.assertUsernameAvailable(db, request.username)
      const passwordHash = await hashPassword(request.password)
      return this.recordCommit(transaction(db, () => {
        const retry = this.previous(db, scope, request.operationId, fingerprint)
        if (retry) return retry
        const invitation = this.invitation(db, request.invitationToken)
        this.assertUsernameAvailable(db, request.username)
        const accountId = brandString<AccountId>(randomUUID())
        return this.mutate(db, scope, request, 'register', accountId, invitation.organizationId, fingerprint, (revision) => {
          db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run(accountId, request.username, passwordHash, 1, revision)
          const membershipId = this.insertMember(db, accountId, invitation.organizationId, invitation.role, revision)
          db.prepare('UPDATE invitations SET consumed=1,version=? WHERE id=?').run(revision, invitation.id)
          return { accountId, membershipId, organizationId: invitation.organizationId }
        })
      }))
    })
  }

  private admitLogin(db: DatabaseSync, username: string): boolean {
    return transaction(db, () => {
      const now = Date.now()
      db.prepare('DELETE FROM login_attempts WHERE startedAt<=?').run(now - this.config.loginWindowMs)
      const limits = [['global', this.config.loginGlobalMaxAttempts], [digestToken(username), this.config.loginMaxAttempts]] as const
      for (const [key, limit] of limits) {
        const row = db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key)
        if (row && attemptSchema.parse(row).attempts >= limit) {
          this.event(db, 'rate-limited', null, null)
          return false
        }
      }
      for (const [key] of limits) {
        db.prepare('INSERT INTO login_attempts VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key, now)
      }
      return true
    })
  }

  /**
   * Issue a fresh bearer login after persistent rate limiting and real password verification.
   * @param input - Username/password JSON, without a caller-supplied actor.
   * @returns One-time delivery of the token, its expiry and server-derived account identity.
   */
  login(input: unknown): Promise<LoginResult> {
    return this.enqueue('login', async (db) => {
      const request = parse(loginSchema, input)
      if (!this.metadata(db).rootAccountId) throw new OrganizationError('not-initialized')
      if (!this.admitLogin(db, request.username)) throw new OrganizationError('rate-limited')
      const row = db.prepare('SELECT * FROM accounts WHERE username=?').get(request.username)
      const account = row ? accountSchema.parse(row) : undefined
      const matches = await verifyPassword(request.password, account?.passwordHash)
      const token = brandString<LoginToken>(createOrganizationToken())
      const result = transaction(db, () => {
        const current = account ? this.account(db, account.id) : undefined
        if (!matches || !current || current.enabled !== 1 || current.passwordHash !== account?.passwordHash) {
          this.event(db, 'login-denied', null, null)
          return undefined
        }
        const expiresAt = Date.now() + this.config.loginTtlMs
        db.prepare('DELETE FROM login_sessions WHERE expiresAt<=?').run(Date.now())
        db.prepare('INSERT INTO login_sessions VALUES (?,?,?)').run(digestToken(token), current.id, expiresAt)
        this.event(db, 'login', current.id, null)
        return { token, expiresAt, principal: { serverId: this.metadata(db).serverId, accountId: current.id } }
      })
      if (!result) throw new OrganizationError('invalid-credentials')
      return result
    })
  }

  /**
   * Revoke one login; repeated calls are harmless even after expiry.
   * @param token - Host-held bearer credential.
   * @returns Resolution only after revocation is durable.
   */
  logout(token: LoginToken): Promise<void> {
    return this.enqueue('logout', (db) =>{  transaction(db, () => {
      const row = db.prepare('SELECT * FROM login_sessions WHERE tokenHash=?').get(digestToken(token))
      if (!row) return
      const session = sessionSchema.parse(row)
      db.prepare('DELETE FROM login_sessions WHERE tokenHash=?').run(session.tokenHash)
      this.event(db, 'logout', session.accountId, null)
    }) })
  }

  /**
   * Check current login, account and optional organization permission at execution time.
   * @param token - Bearer credential resolved by the dedicated protocol consumer.
   * @param organizationId - Target organization, if this is an organization-scoped request.
   * @param action - Membership access or organization administration; neither grants project reads.
   * @returns Current identity; consumers must recheck at later mutation or event delivery.
   */
  authenticate(token: LoginToken, organizationId?: OrganizationId, action: OrganizationAction = 'member'): Promise<Principal> {
    return this.enqueue('authenticate', db => transaction(db, () => this.principal(db, token, organizationId, action)))
  }

  /**
   * List organizations for this account's currently enabled memberships.
   * @param token - Current login credential.
   * @returns Safe organization names and membership roles, excluding other organizations.
   */
  organizations(token: LoginToken): Promise<OrganizationView[]> {
    return this.enqueue('organizations', db => transaction(db, () => {
      const principal = this.principal(db, token)
      return db.prepare(`SELECT o.*,m.id AS membershipId,m.role FROM organizations o JOIN memberships m ON m.organizationId=o.id
        WHERE m.accountId=? AND m.enabled=1 ORDER BY o.id`).all(principal.accountId).map(row => ({
        ...organizationSchema.parse(row), membershipId: membershipSchema.shape.id.parse(row.membershipId),
        role: membershipSchema.shape.role.parse(row.role),
      }))
    }))
  }

  /**
   * Read safe member records only for an organization the caller currently administers.
   * @param token - Current login credential.
   * @param organizationId - Target organization.
   * @returns Member/account status and versions without any authentication material.
   */
  members(token: LoginToken, organizationId: OrganizationId): Promise<MemberView[]> {
    return this.enqueue('members', db => transaction(db, () => {
      this.principal(db, token, organizationId, 'manage')
      return db.prepare('SELECT * FROM memberships WHERE organizationId=? ORDER BY id').all(organizationId).map((row) => {
        const member = membershipSchema.parse(row)
        const account = this.account(db, member.accountId)
        return { id: member.id, accountId: account.id, username: account.username, accountEnabled: account.enabled === 1,
          accountVersion: account.version, role: member.role, enabled: member.enabled === 1, version: member.version }
      })
    }))
  }

  private authorizeCommand(db: DatabaseSync, token: LoginToken, command: Command): Principal {
    if (command.kind === 'invite' || command.kind === 'set-membership') return this.principal(db, token, command.organizationId, 'manage')
    const principal = this.principal(db, token)
    if (command.kind === 'set-account' && this.metadata(db).rootAccountId !== principal.accountId) throw new OrganizationError('forbidden')
    return principal
  }

  /**
   * Execute one allow-listed command, checking current authority and version inside its transaction.
   * @param token - Current bearer credential; request JSON cannot supply identity or authority.
   * @param input - Strict discriminated command JSON with an operation ID.
   * @returns Committed result or an identical prior receipt when still authorized.
   */
  execute(token: LoginToken, input: unknown): Promise<Receipt> {
    return this.enqueue('execute', async (db) => {
      const command = parse(commandSchema, input)
      const principal = this.authorizeCommand(db, token, command)
      const scope = `account:${principal.accountId}`
      const fingerprint = await requestFingerprint(scope, command, command.kind === 'change-password')
      const previous = transaction(db, () => {
        this.authorizeCommand(db, token, command)
        return this.previous(db, scope, command.operationId, fingerprint)
      })
      if (previous) return previous
      let passwordHash: string | undefined
      let oldHash: string | undefined
      if (command.kind === 'change-password') {
        oldHash = this.account(db, principal.accountId).passwordHash
        if (!await verifyPassword(command.currentPassword, oldHash)) throw new OrganizationError('invalid-credentials')
        passwordHash = await hashPassword(command.newPassword)
      }
      return this.recordCommit(transaction(db, () => {
        const current = this.authorizeCommand(db, token, command)
        const retry = this.previous(db, scope, command.operationId, fingerprint)
        if (retry) return retry
        if (oldHash !== undefined && this.account(db, current.accountId).passwordHash !== oldHash) throw new OrganizationError('version-conflict')
        return this.mutate(db, scope, command, command.kind, current.accountId, current.organizationId ?? null, fingerprint,
          revision => this.applyCommand(db, current, command, revision, passwordHash))
      }))
    })
  }

  private applyCommand(
    db: DatabaseSync, principal: Principal, command: Command, revision: number, passwordHash: string | undefined,
  ): ResultIds {
    switch (command.kind) {
      case 'create-organization': {
        const organizationId = brandString<OrganizationId>(randomUUID())
        db.prepare('INSERT INTO organizations VALUES (?,?,?)').run(organizationId, command.name, revision)
        const membershipId = this.insertMember(db, principal.accountId, organizationId, 'admin', revision)
        db.prepare('UPDATE organization_events SET organizationId=? WHERE revision=?').run(organizationId, revision)
        return { organizationId, membershipId }
      }
      case 'invite': {
        const invitationId = invitationSchema.shape.id.parse(randomUUID())
        const tokenHash = digestToken(command.invitationToken)
        if (db.prepare('SELECT id FROM invitations WHERE tokenHash=?').get(tokenHash)) throw new OrganizationError('invalid-invitation')
        const member = this.member(db, principal.accountId, command.organizationId)
        db.prepare('INSERT INTO invitations VALUES (?,?,?,?,?,?,?,?)').run(invitationId, command.organizationId, member.id, command.role, tokenHash, Date.now() + this.config.invitationTtlMs, 0, revision)
        return { invitationId, organizationId: command.organizationId }
      }
      case 'accept-invitation': {
        const invitation = this.invitation(db, command.invitationToken)
        if (db.prepare('SELECT id FROM memberships WHERE accountId=? AND organizationId=?').get(principal.accountId, invitation.organizationId)) throw new OrganizationError('already-member')
        const membershipId = this.insertMember(db, principal.accountId, invitation.organizationId, invitation.role, revision)
        db.prepare('UPDATE invitations SET consumed=1,version=? WHERE id=?').run(revision, invitation.id)
        db.prepare('UPDATE organization_events SET organizationId=? WHERE revision=?').run(invitation.organizationId, revision)
        return { accountId: principal.accountId, membershipId, organizationId: invitation.organizationId }
      }
      case 'set-membership': {
        const row = db.prepare('SELECT * FROM memberships WHERE id=? AND organizationId=?').get(command.membershipId, command.organizationId)
        if (!row) throw new OrganizationError('forbidden')
        const member = membershipSchema.parse(row)
        if (member.version !== command.expectedVersion) throw new OrganizationError('version-conflict')
        db.prepare('UPDATE memberships SET enabled=?,role=?,version=? WHERE id=?').run(Number(command.enabled), command.role, revision, member.id)
        this.assertAdministrators(db)
        return { membershipId: member.id, organizationId: member.organizationId, accountId: member.accountId }
      }
      case 'set-account': {
        const account = this.account(db, command.accountId)
        if (account.version !== command.expectedVersion) throw new OrganizationError('version-conflict')
        db.prepare('UPDATE accounts SET enabled=?,version=? WHERE id=?').run(Number(command.enabled), revision, account.id)
        this.assertAdministrators(db)
        if (!command.enabled) db.prepare('DELETE FROM login_sessions WHERE accountId=?').run(account.id)
        return { accountId: account.id }
      }
      case 'change-password': {
        if (!passwordHash) throw new Error('organization: missing computed password digest')
        db.prepare('UPDATE accounts SET passwordHash=?,version=? WHERE id=?').run(passwordHash, revision, principal.accountId)
        db.prepare('DELETE FROM login_sessions WHERE accountId=?').run(principal.accountId)
        return { accountId: principal.accountId }
      }
      default: return assertNever(command)
    }
  }

  /**
   * Recover the bootstrap administrator through the private channel using a separate one-use credential.
   * @param input - Recovery JSON with old/new recovery tokens and a new password.
   * @returns Committed receipt after restoring the bootstrap membership and revoking every login.
   */
  recover(input: unknown): Promise<Receipt> {
    return this.enqueue('recover', async (db) => {
      const request = parse(recoverySchema, input)
      const scope = `recover:${digestToken(request.recoveryToken)}`
      const fingerprint = await requestFingerprint(scope, request, true)
      const retry = this.previous(db, scope, request.operationId, fingerprint)
      if (retry) return retry
      if (request.recoveryToken === request.newRecoveryToken || this.metadata(db).recoveryHash !== digestToken(request.recoveryToken)) throw new OrganizationError('invalid-recovery')
      const passwordHash = await hashPassword(request.newPassword)
      return this.recordCommit(transaction(db, () => {
        const previous = this.previous(db, scope, request.operationId, fingerprint)
        if (previous) return previous
        const metadata = this.metadata(db)
        if (metadata.recoveryHash !== digestToken(request.recoveryToken) || !metadata.rootAccountId || !metadata.rootOrganizationId) throw new OrganizationError('invalid-recovery')
        const accountId = metadata.rootAccountId
        const organizationId = metadata.rootOrganizationId
        return this.mutate(db, scope, request, 'recover', accountId, organizationId, fingerprint, (revision) => {
          db.prepare('UPDATE accounts SET enabled=1,passwordHash=?,version=? WHERE id=?').run(passwordHash, revision, accountId)
          db.prepare("UPDATE memberships SET enabled=1,role='admin',version=? WHERE accountId=? AND organizationId=?").run(revision, accountId, organizationId)
          db.prepare('UPDATE metadata SET recoveryHash=?').run(digestToken(request.newRecoveryToken))
          db.prepare('DELETE FROM login_sessions').run()
          return { accountId, organizationId }
        })
      }))
    })
  }
}

function assertNever(value: never): never { throw new Error(`organization: unknown command ${String(value)}`) }

export default OrganizationService

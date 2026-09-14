import { describe, it, expect } from 'vitest';
import { planDefinitionSchema, modeCommandSchema } from '@merforge/contracts';
import { openDatabase } from './database.js';

export const definition = {
  schemaVersion: 'plan.v1' as const,
  phases: [
    {
      title: 'one',
      requiresApproval: false,
      tasks: [
        {
          title: 'task',
          executorId: 'mock' as const,
          acceptanceVersion: 'summary.v1' as const,
        },
      ],
    },
  ],
};

describe('plan persistence', () => {
  it('rejects empty structure, unsupported acceptance and invalid control shapes', () => {
    expect(planDefinitionSchema.parse(definition)).toEqual(definition);
    expect(() =>
      planDefinitionSchema.parse({ ...definition, phases: [] }),
    ).toThrow();
    expect(() =>
      planDefinitionSchema.parse({
        ...definition,
        phases: [{ ...definition.phases[0], tasks: [] }],
      }),
    ).toThrow();
    expect(() =>
      planDefinitionSchema.parse({ ...definition, schemaVersion: 'plan.v2' }),
    ).toThrow();
    expect(() =>
      modeCommandSchema.parse({
        revision: 1,
        controlVersion: 0,
        mode: 'auto_until',
      }),
    ).toThrow();
  });
  it('enforces revision membership, ordering, immutable task membership and atomic rollback', () => {
    const { sqlite, close } = openDatabase(':memory:');
    try {
      sqlite.transaction(() => {
        sqlite.exec(`INSERT INTO goals VALUES ('g','goal','now');
          INSERT INTO plans(id,goal_id,revision,review,status) VALUES ('p','g',1,'pending','idle');
          INSERT INTO plan_revisions VALUES ('p',1,'{}','now'),('p',2,'{}','now');
          INSERT INTO phases VALUES ('a','p',1,1,'a',0,'pending'),('b','p',1,2,'b',0,'pending'),('old','p',2,1,'old',0,'pending');`);
      })();
      expect(() =>
        sqlite.exec(
          "INSERT INTO phases VALUES ('x','p',1,1,'duplicate',0,'pending')",
        ),
      ).toThrow('UNIQUE');
      expect(() =>
        sqlite.exec(
          "INSERT INTO approvals VALUES ('x','p',1,'old','phase_entry','pending',NULL,'now',NULL)",
        ),
      ).toThrow('FOREIGN KEY');
      expect(() =>
        sqlite.exec(
          "UPDATE plans SET mode='auto_until',start_phase_id='b',stop_phase_id='a'",
        ),
      ).toThrow('invalid plan boundary');
      expect(() =>
        sqlite.exec(
          "UPDATE plans SET mode='auto_until',start_phase_id='a',stop_phase_id='old'",
        ),
      ).toThrow();
      sqlite.exec(
        "INSERT INTO tasks(id,goal_id,title,status,executor_id,acceptance_version,created_at,phase_id,position) VALUES ('t','g','task','ready','mock','summary.v1','now','a',1)",
      );
      expect(() =>
        sqlite.exec('UPDATE tasks SET phase_id=NULL,position=NULL'),
      ).toThrow('immutable task membership');
      expect(() =>
        sqlite.transaction(() => {
          sqlite.exec(
            "INSERT INTO goals VALUES ('bad','bad','now'); INSERT INTO plans(id,goal_id,revision,review,status) VALUES ('bad','bad',1,'pending','idle')",
          );
        })(),
      ).toThrow();
      expect(
        sqlite.prepare("SELECT * FROM goals WHERE id='bad'").get(),
      ).toBeUndefined();
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(sqlite.pragma('user_version', { simple: true })).toBe(7);
    } finally {
      close();
    }
  });
});

it('migrates the delivered v4 schema without changing artifacts, verification or event history', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'merforge-v4-')),
    path = join(dir, 'db.sqlite');
  const old = new Database(path);
  old.exec(readFileSync(new URL('./fixtures/v4.sql', import.meta.url), 'utf8'));
  const tables = ['goals', 'attempts', 'artifacts', 'verifications'];
  const before = tables.map((t) => old.prepare(`SELECT * FROM ${t}`).all());
  old.close();
  try {
    for (let i = 0; i < 2; i++) {
      const db = openDatabase(path);
      try {
        expect(
          tables.map((t) => db.sqlite.prepare(`SELECT * FROM ${t}`).all()),
        ).toEqual(before);
        expect(
          db.sqlite.prepare('SELECT type,plan_id,task_id FROM events').get(),
        ).toEqual({
          type: 'verification_passed',
          plan_id: null,
          task_id: '00000000-0000-4000-8000-000000000002',
        });
        expect(
          db.sqlite.prepare('SELECT count(*) AS n FROM approvals').get(),
        ).toEqual({ n: 0 });
        expect(db.sqlite.pragma('foreign_key_check')).toEqual([]);
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

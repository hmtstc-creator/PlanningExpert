import { describe, expect, it } from 'vitest'

import { auditPlan, type AuditInputs } from './planAudit'
import { computePlan, type PlanInputs } from './planPipeline'
import { randomPlant } from './randomPlant.fixture'

const base: Omit<AuditInputs, 'jobs'> = {
  maintenance: [],
  moldBlackouts: [],
  todayIso: '2026-09-16',
  setupGapMinutes: 60,
  coilSetupGapMinutes: 30,
  concurrentSetupsPerHall: 1,
}

function job(material: string, press: string, start: number, end: number, extra = {}) {
  return {
    material,
    press,
    hall: 'H1',
    date: '2026-09-16',
    phase: 'backlog',
    dueDate: '2026-09-14',
    segments: [
      { kind: 'setup', date: '2026-09-16', start, end: start + 30 },
      { kind: 'run', date: '2026-09-16', start: start + 30, end },
    ],
    ...extra,
  }
}

function broken(input: AuditInputs) {
  return auditPlan(input)
    .rules.filter((r) => r.violationCount > 0)
    .map((r) => r.id)
}

describe('auditPlan catches each broken rule', () => {
  it('passes a clean plan', () => {
    expect(broken({ ...base, jobs: [job('A', '104', 0, 100), job('B', '105', 200, 300)] })).toEqual([])
  })

  it('a job that was not given its earliest press', () => {
    const j = {
      ...job('A', '104', 0, 100),
      endDate: '2026-09-17',
      endMinute: 100,
      decision: {
        step: 4,
        candidates: [
          { press: '104', endDate: '2026-09-17', endMinute: 100 },
          { press: '105', endDate: '2026-09-16', endMinute: 400 },
        ],
      },
    }
    expect(broken({ ...base, jobs: [j] })).toEqual(['earliest-press'])
  })

  it('a part that is not flexible running off its main press', () => {
    const pressRules = new Map([
      ['A', { main: '104', flexible: false }],
      ['B', { main: '104', flexible: true }],
      ['C', { main: '104', flexible: false, pinned: '105' }],
    ])
    expect(broken({ ...base, pressRules, jobs: [job('A', '105', 0, 100)] })).toEqual(['main-press'])
    expect(broken({ ...base, pressRules, jobs: [job('B', '105', 0, 100)] })).toEqual([])
    expect(broken({ ...base, pressRules, jobs: [job('C', '105', 0, 100)] })).toEqual([])
  })

  it('two jobs on one press at once', () => {
    expect(broken({ ...base, jobs: [job('A', '104', 0, 100), job('B', '104', 90, 300)] })).toContain(
      'press-overlap',
    )
  })

  it('crane: two setups in a hall closer than the gap', () => {
    expect(broken({ ...base, jobs: [job('A', '104', 0, 100), job('B', '105', 60, 300)] })).toEqual([
      'crane',
    ])
  })

  it('one mould on two presses', () => {
    expect(
      broken({ ...base, jobs: [job('A', '104', 0, 100), job('A', '105', 50, 300, { hall: 'H2' })] }),
    ).toContain('mould-twice')
  })

  it('running on a mould blackout day, during press maintenance, too early, in the past', () => {
    expect(
      broken({
        ...base,
        moldBlackouts: [{ material: 'A', date: '2026-09-16' }],
        maintenance: [{ press: '104', date: '2026-09-16', start: 50, end: 60 }],
        jobs: [job('A', '104', 0, 100, { phase: 'fill', dueDate: '2026-09-21' })],
      }),
    ).toEqual(['press-maintenance', 'mould-blackout', 'fill-early'])
    expect(
      broken({ ...base, todayIso: '2026-09-17', jobs: [job('B', '104', 0, 100)] }),
    ).toEqual(['past'])
  })
})

// ---- Motorun kendisi: rastgele fabrikalarda hiçbir kuralı bozmamalı ------

describe('the engine never breaks a rule', () => {
  // Salı 16 Eylül 2026 10:00 Romanya.
  const NOW = Date.UTC(2026, 8, 16, 7, 0)
  for (let seed = 1; seed <= 40; seed++) {
    it(`random plant #${seed}`, () => {
      const run = computePlan(randomPlant(seed), NOW)
      const problems = run.audit.rules.flatMap((r) => r.violations)
      expect(problems).toEqual([])
      expect(run.jobs.length).toBeGreaterThan(0)
    })
  }
})

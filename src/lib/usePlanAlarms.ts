import { api } from '../../convex/_generated/api'
import { useQuery } from './convexTransport'
import type { PlanAlarms } from './planAlarms'

/** Son plan hesabının kalıp ve makine alarmları (bütün planı çekmeden). */
export function usePlanAlarms():
  | { computedAt: number; todayIso?: string; alarms: PlanAlarms }
  | null
  | undefined {
  return useQuery(api.planRuns.latestAlarms) as
    | { computedAt: number; todayIso?: string; alarms: PlanAlarms }
    | null
    | undefined
}

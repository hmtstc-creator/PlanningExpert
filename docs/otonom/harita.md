# Sayfa ilişki haritası

> Üreten: `scripts/otonom/harita.mjs` (elle düzenlenmez)

| Rota | Satır | Okur (query) | Yazar (mutation) | Bağlantı | Bileşen |
|---|---|---|---|---|---|
| __root.tsx | 63 |  |  |  | ConnectionBanner, ErrorReporter, Header, LoginGate, MutationErrorToast, TenancyGate |
| /account | 158 | users.mySessions | auth.changePassword |  | Header, PageHeader |
| /admin | 84 |  |  | /admin/map | AutonomousLog, CompanyAdmin, PageHeader, Tabs, org/OrgAdmin, security/SecurityPanel |
| /admin_/map | 47 |  |  |  | PageHeader, org/OrgMap |
| /alarms | 235 |  |  | /die-followup/maintenance, /machine-followup/breakdowns, /machine-followup/maintenance | EntityLinks, PageHeader |
| /board | 8 |  |  |  | BoardDashboard |
| /capacity | 785 | holidays.listByCountry, planRuns.latestCapacity, planRuns.status, plannedStops.list, pressCalendar.getGlobalSettings, pressCalendar.listAllOverrides, pressCalendar.listTemplates, presses.list, workCalendar.get | pressCalendar.clearOverride, pressCalendar.saveAcceptedPerformanceRate, pressCalendar.saveOverride | /referanslar, /takvim | CapacityChart, OvertimePanels, PageHeader, plan/PlanOrgFilter |
| /compare | 103 | compare.oeeWeeks |  |  | OeeCharts, PageHeader |
| /depolar | 377 |  |  |  | CostCenterLocations, ErrorBanner, PageHeader, SaveStatus, UnsavedBar |
| /die-followup/ | 128 | moldAlarms.list, moldMaintenance.list, moldProblems.list, moldReadiness.list |  | /alarms, /die-followup/maintenance, /die-followup/problems | EntityLinks, ModuleStat, PageHeader |
| /die-followup/maintenance | 835 | actualProduction.listAll, moldAlarms.list, moldMaintenance.list, moldReadiness.list, products.listAll | moldAlarms.sync |  | EntityLinks, ErrorBanner, MaterialPicker, PageHeader |
| /die-followup/problems | 456 | lookups.list, moldProblems.list, products.listAll | moldProblems.generateUploadUrl | /die-followup/reports | EntityLinks, ErrorBanner, MaterialPicker, PageHeader |
| /die-followup/reports | 130 | moldProblems.list |  |  | MaterialPicker, ModuleStat, PageHeader, ParetoChart, ProblemMatrix |
| /gerceklesen | 111 | actualProduction.listAll |  | /depolar, /sapdata | PageHeader |
| /hammadde | 726 | planRuns.latestRawCoverage, pressCalendar.getGlobalSettings, rawLeadTimes.list | pressCalendar.saveRawCoverageSettings, pressCalendar.saveRawOrderRecipients | /depolar, /planlogic, /referanslar | PageHeader, raw/LeadTimePanel |
| / | 293 | setup.checklist |  | /board | Cockpit, UpdatesPanel, nav/CommandPalette, nav/NavIcon |
| /kaliplar | 10 |  |  | /die-followup/maintenance |  |
| /kalipproblem | 10 |  |  | /die-followup/problems |  |
| /kayitlar | 188 |  | changeLog.create, changeLog.remove |  | PageHeader |
| /kpi/ | 55 |  |  | /kpi/monthly/dashboard, /kpi/monthly/entry, /kpi/weekly/dashboard, /kpi/weekly/entry | PageHeader |
| /kpi/monthly/dashboard | 8 |  |  |  |  |
| /kpi/monthly/entry | 8 |  |  |  |  |
| /kpi/weekly/dashboard | 8 |  |  |  |  |
| /kpi/weekly/entry | 8 |  |  |  |  |
| /machine-followup/breakdowns | 543 | lookups.list, machineProblems.list, presses.list | machineProblems.generateUploadUrl | /alarms, /machine-followup/reports | EntityLinks, ErrorBanner, PageHeader |
| /machine-followup/ | 124 | machineProblems.list, pressMaintenance.list |  | /alarms, /machine-followup/breakdowns, /machine-followup/maintenance | EntityLinks, ModuleStat, PageHeader |
| /machine-followup/maintenance | 579 | lookups.list, pressMaintenance.list, presses.list |  |  | EntityLinks, ErrorBanner, PageHeader, SaveStatus, UnsavedBar |
| /machine-followup/reports | 143 | machineProblems.list, presses.list |  |  | ModuleStat, PageHeader, ParetoChart, ProblemMatrix |
| /machine-followup/sop/$id | 358 | sop.get |  | /machine-followup/sop |  |
| /machine-followup/sop/ | 377 | sop.list, sop.status | sop.create, sop.generateUploadUrl | /machine-followup/sop/$id |  |
| /makineler | 1324 | presses.categories, presses.costCentersSeen, presses.frequencyStops, presses.list |  | /settings | ErrorBanner, OrgTree, PageHeader, SaveStatus, UnsavedBar |
| /oee/agent | 176 | machineProblems.list, moldAlarms.list, moldProblems.list, oee.coverage, oee.days, oee.downtimeDays, oee.lossDays, oee.orders, oee.shifts |  | /oee/settings | AgentReportView, DieFollowUpDialog, OeePanel, OeePeriodControl, PageHeader, SavePdfButton |
| /oee/asakai-detail | 249 | oee.downtimeDays, oee.orders, oee.shifts, presses.list |  | /oee/settings | AsakaiSheet, OeePanel, OeePeriodControl, PageHeader, SavePdfButton |
| /oee/asakai-weekly | 263 | oee.days, oee.lossDays, oee.periods, oee.stopDays, presses.list |  | /oee/data, /oee/settings | AsakaiSheet, OeePanel, OeePeriodControl, PageHeader, SavePdfButton |
| /oee/bridge | 826 | oee.days, oee.downtimeDays, oee.lossDays, oee.orders, oee.shifts, oee.stopDays |  | /die-followup/problems, /machine-followup/breakdowns, /oee/data, /oee/dies, /oee/losses, /oee/mttr | DieFollowUpDialog, OeeBridgeCharts, OeePanel, OeePeriodControl, PageHeader, SavePdfButton |
| /oee/data | 323 | oee.days, oee.downtimeDays, oee.orders, oee.periods, oee.shifts | oee.duplicates |  | OeePanel, PageHeader |
| /oee/dies | 173 | oee.days, oee.orders |  | /oee/data | OeeCharts, OeePanel, PageHeader |
| /oee/guide | 218 | oee.coverage, oee.settings |  | /oee/data, /oee/settings | OeePanel, PageHeader |
| /oee/ | 198 | oee.days, oee.periods, oee.plannedStopMinutes, oee.shifts |  | /oee/bridge, /oee/guide, /oee/losses, /oee/settings | OeeCharts, OeePanel, OeePeriodControl, OeePrint, PageHeader, SavePdfButton |
| /oee/insights | 284 | oee.days, oeeInsights.get, oeeInsights.list | oeeInsights.request | /oee/settings | OeePanel, OeePeriodControl, PageHeader |
| /oee/losses | 360 | oee.days, oee.lossDays, oee.periods, oee.stopDays |  | /oee/settings | OeeCharts, OeePanel, OeePeriodControl, OeePrint, PageHeader, SavePdfButton |
| /oee/mttr | 610 | oee.coverage, oee.days, oee.downtimeDays, oee.stopDays |  | /oee/settings | OeePanel, OeePeriodControl, PageHeader |
| /oee/report | 498 | oee.days, oee.downtimeDays, oee.lossDays, oee.orders, oee.shifts, oee.stopDays |  | /oee/data | DieFollowUpDialog, OeeBridgeCharts, OeePanel, OeePeriodControl, PageHeader, SavePdfButton |
| /oee/settings | 557 | oee.coverage, oee.days, oee.downtimeDays, oee.shifts | oee.saveSettings | /oee/data, /settings, /takvim | OeePanel, PageHeader |
| /oee/topics | 200 | oeeTopics.list, oeeTopics.runs | oeeTopics.close, oeeTopics.reopen, oeeTopics.runNow |  | OeePanel, OeePeriodControl, PageHeader |
| /performans | 415 | actualProduction.listAll, holidays.listByCountry, planSnapshots.latest, plannedStops.list, pressCalendar.getGlobalSettings, pressCalendar.listAllOverrides, pressCalendar.listTemplates, presses.list, products.listAll, workCalendar.get | pressCalendar.setCapacityFactor |  | OvertimePanels, PageHeader |
| /planlama | 786 | planJobLocks.list, planOverrides.list, presses.list, products.listAll | planOverrides.remove, planOverrides.set, planRuns.requestNow, planSnapshots.approve | /makineler, /planlogic, /planningexpert, /takvim | PageHeader, WeekGantt, plan/AddJobDialog, plan/JobDialog, plan/MoveDialog, plan/OperatorHeadcountGrid, plan/PlanOrgFilter, plan/PlanPanels, plan/PressStartPanel, plan/PressWeekShifts, plan/usePlanState |
| /planlogic | 1768 | pressCalendar.getGlobalSettings, rawLeadTimes.list |  | /alarms, /capacity, /makineler, /performans, /planlama, /referanslar, /takvim | PageHeader |
| /planningexpert | 267 | demand.listAllWeekly, pressCalendar.getGlobalSettings, presses.list, products.listAll, stock.listAll, storageLocations.listAll, workCalendar.get | planRuns.requestNow | /depolar, /makineler, /performans, /planlama, /siparisler, /takvim | Cockpit, PageHeader, plan/DataCoveragePanel, plan/LateJobs, plan/PlanChecks, plan/PlanPanels, plan/PlanTables, plan/usePlanState |
| /platform | 13 |  |  |  |  |
| /presbakim | 10 |  |  | /machine-followup/maintenance |  |
| /referanslar | 909 | presses.list | products.applyToAll, products.bulkUpsert, products.create, products.remove |  | ErrorBanner, ExcelUpload, PageHeader, SaveStatus, UnsavedBar, plan/PlanOrgFilter |
| /sapdata | 458 | sapUploads.filterCodes, sapUploads.status | sapUploads.appendRows, sapUploads.beginUpload, sapUploads.finishUpload, sapUploads.pruneOld | /depolar, /gerceklesen, /hammadde, /referanslar, /siparisler, /stoklar | ExcelUpload, PageHeader |
| /settings | 90 |  |  | /users | PageHeader, Tabs, org/OrgAdmin, settings/DigestSettings, settings/PlantChangeLog, settings/SelectionLists |
| /settings_/map | 49 |  |  | /users | PageHeader, org/OrgMap |
| /siparisler | 156 | stock.planStock |  | /sapdata | PageHeader |
| /stoklar | 152 |  |  | /depolar, /sapdata | PageHeader |
| /takvim | 1483 | holidays.listByCountry, plannedStops.list, pressCalendar.getGlobalSettings, pressCalendar.listAllOverrides, pressCalendar.listOverrides, pressCalendar.listTemplates, presses.list, workCalendar.get | holidays.replaceYear, pressCalendar.clearOverride, pressCalendar.saveGlobalSettings, pressCalendar.saveOverride, pressCalendar.saveTemplate, workCalendar.save | /capacity, /makineler | CapacityGrid, CollapsibleSection, OvertimePanels, PageHeader, PlannedStopsEditor, ShiftCodesEditor, UnsavedBar, plan/OperatorHeadcountGrid, plan/OperatorWeeklyTable |
| /tani | 491 | diagnostics.duplicates, diagnostics.summary |  |  | QueryCatcher |
| /users | 53 |  |  |  | PageHeader, people/PeopleAdmin, security/SecurityPanel |
| /yonetim | 7 |  |  | /settings |  |

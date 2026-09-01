# Production Convergence Queue View

This is a non-authoritative human view. The only live scheduler is `engineering/execution/NEXT_WORK.json`; update and select work there. API-PC-001 through API-PC-015 were admitted from the 2026-08-30 production-convergence charter. API-PC-016 through API-PC-020 were admitted from the 2026-09-01 productization directive.

| Project | Initial state | Dependency |
|---|---|---|
| API-PC-001 | IN_PROGRESS | none |
| API-PC-002 | PLANNED | API-PC-001 |
| API-PC-003 | PLANNED | API-PC-001 |
| API-PC-004 | PLANNED | API-PC-003 |
| API-PC-005 | PLANNED | API-PC-004 |
| API-PC-006 | PLANNED | API-PC-005 |
| API-PC-007 | PLANNED | API-PC-005 |
| API-PC-008 | PLANNED | API-PC-005, API-PC-007 |
| API-PC-009 | PLANNED | API-PC-008 |
| API-PC-010 | PLANNED | API-PC-009 |
| API-PC-011 | PLANNED | API-PC-006 |
| API-PC-012 | PLANNED | API-PC-007, API-PC-010 |
| API-PC-013 | PLANNED | API-PC-004 |
| API-PC-014 | PLANNED | API-PC-002, API-PC-005, API-PC-006 |
| API-PC-015 | PLANNED | API-PC-001 through API-PC-014 and API-PC-016 through API-PC-020 |
| API-PC-016 | COMPLETE (local) | API-PC-001, API-PC-003, API-PC-009 |
| API-PC-017 | COMPLETE (local) | API-PC-004, API-PC-013, API-PC-016 |
| API-PC-018 | PLANNED / P0-blocked | API-PC-009, API-PC-016, API-PC-017, Room Planner containment |
| API-PC-019 | PLANNED | API-PC-010, API-PC-011, API-PC-016, API-PC-017 |
| API-PC-020 | PLANNED | API-PC-005, API-PC-006, API-PC-017 |

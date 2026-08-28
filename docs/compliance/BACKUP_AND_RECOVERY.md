# Backup and recovery

Last reviewed: 2026-08-28

The production database must use managed backups and point-in-time recovery appropriate to the customer SLA. Quarterly restoration tests must prove that a clean environment can restore canonical data, validate migration history, run RLS checks, and reconcile critical provider state.

Target objectives for the initial paid pilot are RPO 24 hours and RTO 8 hours; contracts promising stronger objectives require measured evidence and an upgraded backup plan. Restoration evidence records timestamps, snapshot identity, row-count checks, policy checksum checks, and reviewer sign-off.

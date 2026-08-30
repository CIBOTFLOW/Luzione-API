# Deployment Provenance, Canary and Rollback V1

Project: `API_SE_012`  
Canonical source: `src/modules/platform-release/releaseContract.ts`  
Contract version: `luzione-release-evidence/v1`

A release record binds repository, 40-character candidate SHA, deployment and environment, contract/migration versions, build/test/security evidence, canary and health observations, rollback capability/rehearsal, timestamps, deferred evidence, promotion decision and production observation.

Every evidence reference carries its own exact SHA, environment, tier, timestamp, source, kind and status. SHA or environment mismatches fail validation. Preview and production environments require a deployment identity. A deployment-platform acknowledgement is never business completion.

Local build/test passes support at most a release-candidate claim. Production promotion requires passing preview canary and health evidence plus a preview-rehearsed rollback path. Security failures and blocking deferred evidence stop promotion. Production finality requires an explicit passing production observation; absence remains release-candidate evidence even after a deployment succeeds.

This project defines and tests the contract only. It does not deploy, promote, canary, roll back, modify a database or claim preview/production observation.

Strongest claim: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

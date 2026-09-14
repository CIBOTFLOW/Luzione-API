# Sultan internal action archival

Outcome: archive a case-linked internal draft/task/proposal using the existing prepare/execute gateway and existing tables. Reuse Stage5 admission, critic, exact case version, signed command approval and tenant-scoped transactions. No provider effects.

Archive tool arguments bind campaign, target receipt, target creation object version and payload hash. Lock and validate target before archive; preserve original evidence and insert a separate archival action receipt atomically. Notes and archival evidence cannot be archived. Readback v2 represents ARCHIVED; active v1 readbacks remain compatible.

Acceptance: preparation rejects stale case/invalid actor; transaction rejects foreign tenant/case/campaign, target mismatch, immutable notes, missing target and update failure; repeated archive is harmless; source readback reflects archival. Local tests only, no production claims.

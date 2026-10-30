# Stage 5 canonical readback context in A0 signed receipts

Date: 2026-10-30. Mode: SHADOW. Production signing flag remains OFF.

## Verified mismatch
The existing `PostgresSultanAgentGatewayStore.requireStage5Admission` compares the tool call's `contextRefs` against the exact canonical readback receipts from the Stage 5 admission. Each expected ref uses `api:canonical-readback/<receiptId>`, `sourceVersion=readbackHash`, `integrityHash=readbackHash`, and `freshness=FRESH`. The v2 receipt signer previously required `contextRefs.length===0`, making valid calls with canonical evidence unsignable. Sultan's acquisition bridge had the same empty-array restriction.

## Change
Permit up to 50 strictly shaped canonical readback refs in the signer; require matching SHA-256 version/integrity, freshness, bounded UTC timestamps, unique source identities, and no additional fields. The existing v2 HMAC `callHash` already binds the complete call, including its readback references. Preserve the original empty-array synthetic fixture for compatibility; it is NOT proof that a real Stage 5 admission can be obtained without evidence.

## Security and release boundaries
This check is supplementary. Only the gateway's tenant-bound PostgreSQL admission and readback verification can establish actual Stage 5 authority. This PR does not export a Stage 5 receipt, prove its independent signature, enable the signer, change auth/RLS, send communications, or write business records. The corresponding Sultan consumer must accept the same bounded refs before activation. Production key custody, independent sender identity, deployed role/RLS, and actual authenticated integration remain unverified. Partner Network stays OFF.

## Test requirements
Run signer tests, full API Release gate, CodeQL and post-merge verification at the exact head. Negative cases include wrong readback hash, stale freshness, stale timestamp, forged source path, extra authority fields and duplicate readback IDs. No paid APIs.

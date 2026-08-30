# Causal Trace and Receipt Navigation V1

Project: `API_SE_017`  
Canonical source: `src/modules/platform-causality/navigation.ts`  
Contract version: `luzione-causal-navigation/v1`

The contract assembles authorized, tenant-scoped evidence references into a causal directed acyclic graph. Nodes cover request, decision, action intent, execution, event, trace, authoritative readback, recovery and release evidence. Edges state caused, confirmed-by, recovered-by, released-by or traced-by relationships.

The graph is navigation metadata, never a business truth store. Traces cannot claim authority, acknowledgements cannot claim finality, and readback nodes require an authoritative source reference. Duplicate nodes, missing edge targets, cycles, invalid timestamps and cross-tenant evidence fail closed.

The result exposes a chronological evidence timeline, correlation/trace references, a bounded answer to “why?”, and what authoritative action can change the state. It does not retrieve evidence or bypass existing authorization; a durable universal receipt store remains pending semantic convergence with PR #31.

Tests prove a request-to-readback chain and known-bad cross-tenant, missing-node, cycle, false-readback and authoritative-trace cases. No external effect is performed.

Strongest claim before exact-head gates: `CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

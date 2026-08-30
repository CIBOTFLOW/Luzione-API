# Test Taxonomy and Harness V1

Project: `API_SE_018`  
Canonical source: `src/modules/platform-testing/taxonomy.ts`  
Contract version: `luzione-test-taxonomy/v1`

Every current `src/**/*.test.ts` suite has exactly one primary class and zero or more secondary classes. The eight canonical classes are UNIT, CONTRACT, INTEGRATION, JOURNEY, RELIABILITY, SECURITY, PERFORMANCE and PRODUCTION_VERIFICATION.

`npm test` remains the single CI release-gate command and already includes all library and module suites. Focused aliases remain debugging conveniences and cannot claim release proof. The localhost performance campaign remains separately measured evidence rather than being hidden inside the functional test count.

The registry deliberately reports zero primary JOURNEY and PRODUCTION_VERIFICATION suites. Local contract or integration tests do not fill those gaps. Future suites must be added to the map in the same changeset, making omitted evidence visible without deleting or relabeling tests for cosmetic coverage.

Tests compare the registry to the actual filesystem, reject duplicates/primary repetition and verify CI uses the canonical command. No suite was deleted and no external effect was performed.

Strongest claim before exact-head gates: `BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

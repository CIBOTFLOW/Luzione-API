# Stage 5 readback request-size enforcement (2026-10-30)

**Status:** PR #99 only; default-disabled; no production activation.

Review found that the authenticated POST admission-readback route checked `Content-Length` but then used `await request.text()` before enforcing its 256-byte cap. Chunked bodies without a trustworthy length could be buffered without the intended bound.

The route now uses `readBoundedStage5RequestText` to read the request stream incrementally and fail at 257 bytes, independent of headers. UTF-8 decoding is fatal for invalid byte sequences; transport errors use sanitized error codes. Tests cover the 256-byte boundary, 257-byte rejection, multibyte UTF-8, invalid UTF-8, and an explicitly chunked request without Content-Length.

**Security scope:** The readback feature remains OFF. This change does not establish OIDC credential custody, tenant RLS, actual Stage 5 admission, or an authenticated end-to-end two-tenant proof. No business records, production flags, credentials, customer communications, or paid services were changed.

**Verification:** PENDING exact-head Release Gate, CodeQL, TypeScript, lint, and preview checks at authoring. Do not merge until all required checks pass and the remaining security and dependency gates are resolved.

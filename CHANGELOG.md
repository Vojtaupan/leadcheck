# Changelog

## 0.1.0

First release.

- Predicted hard-bounce floor over a lead list, with a threshold exit code.
- Domain checks: NXDOMAIN, null MX (RFC 7505), no-MX-no-A, parked address
  detection, provider classification, secure-email-gateway detection.
- RFC 5321 implicit MX honored, so no-MX-but-has-A domains are not false bounces.
- Address checks: syntax, role inbox, free provider, disposable, duplicates
  (Gmail-normalized), and matching against a sent ledger.
- Cleaned and rejects CSV output that together reconstruct the input exactly.
- Human table, JSON summary, and quiet single-line verdict.
- Resolver preflight: falls back to a public resolver when the system one does
  not answer, and refuses to run rather than reporting a whole list as unknown.
- Zero runtime dependencies.

#!/usr/bin/env bash
#
# Publish gate.
#
# This repository is built clean-room and published publicly. Nothing about any
# customer, prospect, campaign or private infrastructure may enter it. This
# script greps the tracked tree for the patterns that must never appear and
# fails the build if it finds one.
#
# Run it before every publish:  bash scripts/scrub-check.sh

set -euo pipefail

fail=0

# Files that are allowed to mention example addresses and domains, because that
# is what they are for.
tracked() {
  git ls-files "$@"
}

report() {
  fail=1
  echo "scrub-check: FAIL - $1"
}

# ---------------------------------------------------------------------------
# 1. Private identifiers that must never appear.
# ---------------------------------------------------------------------------
FORBIDDEN_PATTERNS=(
  'bolteniq'
  'instantly\.ai'
  'apollo\.io'
  'INSTANTLY_API_KEY'
  'ANTHROPIC_API_KEY'
  'AKIA[0-9A-Z]{16}'
  'sk-[A-Za-z0-9]{20,}'
  'BEGIN [A-Z ]*PRIVATE KEY'
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if tracked | xargs grep -lEi -- "$pattern" 2>/dev/null | grep -q .; then
    report "forbidden pattern '$pattern' found in:"
    tracked | xargs grep -lEi -- "$pattern" 2>/dev/null | sed 's/^/    /'
  fi
done

# ---------------------------------------------------------------------------
# 2. Email addresses must be documentation domains only.
#
# RFC 2606 and RFC 6761 reserve example.com/.org/.net, .invalid, .test and
# .example. Anything else in a source or doc file is a real address that should
# not be here. Vendor MX hostnames (aspmx.l.google.com) are not addresses and do
# not match, because the pattern requires an '@'.
# ---------------------------------------------------------------------------
# The two malformed forms are fixtures for the syntax-invalid tests.
ALLOWED_ADDR='@(-?x\.\.?com|example\.(com|org|net)|acme(-corp)?\.com|good\.com|gone\.com|x\.com|y\.com|z\.com|b\.com|g\.com|a\.com|iana\.org|gmail\.com|googlemail\.com|mailinator\.com|yahoo\.co\.uk|[a-z0-9-]*\.invalid|[a-z0-9-]*\.test|[a-z0-9-]*\.example)'

leaked_addresses=$(
  tracked '*.ts' '*.md' '*.json' '*.yml' '*.sh' \
    | xargs grep -hoEi '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' 2>/dev/null \
    | grep -viE "$ALLOWED_ADDR" \
    | sort -u || true
)

if [ -n "$leaked_addresses" ]; then
  report "email addresses outside the reserved documentation domains:"
  echo "$leaked_addresses" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 3. Zero runtime dependencies is a stated property of the package.
# ---------------------------------------------------------------------------
deps=$(node -e 'const p=require("./package.json");process.stdout.write(Object.keys(p.dependencies||{}).join(","))')
if [ -n "$deps" ]; then
  report "package.json declares runtime dependencies: $deps"
fi

# ---------------------------------------------------------------------------
# 4. No absolute local paths from a development machine.
# ---------------------------------------------------------------------------
if tracked '*.ts' '*.md' '*.json' '*.yml' | xargs grep -lE '([A-Z]:\\\\|/Users/|/home/[a-z]+/)' 2>/dev/null | grep -q .; then
  report "absolute local filesystem paths found in:"
  tracked '*.ts' '*.md' '*.json' '*.yml' | xargs grep -lE '([A-Z]:\\\\|/Users/|/home/[a-z]+/)' 2>/dev/null | sed 's/^/    /'
fi

if [ "$fail" -eq 0 ]; then
  echo "scrub-check: clean"
  exit 0
fi

echo "scrub-check: refusing to publish"
exit 1

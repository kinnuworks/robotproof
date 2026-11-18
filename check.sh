#!/usr/bin/env bash
# The checks that prove this project works: tests, typecheck, and the end-to-end script
# that walks the demo path in a real browser against the real API, recording a screen
# video of it. Exits non-zero when anything fails.
#
# Keep it fast enough to run often (a few minutes at most), stop any server it starts
# before it exits, and never make a check pass by skipping, weakening or special-casing it.
set -euo pipefail
cd "$(dirname "$0")"
OUT=${CHECK_OUT:-proto/out/check}
rm -rf "$OUT"; mkdir -p "$OUT"

echo "== 1. typecheck (client and server)"
(cd app && npx tsc --noEmit -p . && npx tsc --noEmit --ignoreConfig --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --esModuleInterop --types node api/*.ts server/*.ts)

echo "== 2. build"
(cd app && npx vite build --logLevel error)

echo "== 3. real Aholo API: the key works and credits are left (no credits spent)"
set -a; . ./.env.local; set +a
printf '%s' "$AHOLO_API_KEY" | python3 proto/lux3d.py balance > "$OUT/balance.txt"
python3 -I - "$OUT/balance.txt" <<'PY'
import json, sys
t = open(sys.argv[1]).read().split("\n", 1)
assert t[0].strip() == "200", t[0]
c = json.loads(t[1])["d"]["availableCredits"]
assert c > 100, f"only {c} credits left"
print(f"Aholo API ok, {c} credits left")
PY

echo "== 4. live site: pages and API answer"
LIVE=${LIVE_URL:-https://robotproof.vercel.app}
for path in / /api/gallery /objects/chest/robot.urdf; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$LIVE$path")
  [ "$code" = 200 ] || { echo "live $path returned $code"; exit 1; }
done
echo "live site ok: $LIVE"

echo "== 5. demo path in a real browser (video recorded), robot runs, download"
(cd app && npx vite preview --port 4180 --strictPort > "../$OUT/preview.log" 2>&1) &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null || true; pkill -f "vite preview --port 4180" 2>/dev/null || true' EXIT
for i in $(seq 1 50); do curl -s -o /dev/null http://localhost:4180/ && break; sleep 0.2; done
~/.hackathon-field/venv/bin/python -I tests/e2e.py http://localhost:4180 "$OUT"

echo "== 6. the download loads and actuates in MuJoCo"
.venv/bin/python -I tests/sim_check.py "$(dirname "$(find "$OUT/download" -name robot.urdf | head -1)")"

# Evidence labels: once evidence/EVAL_PLAN.md exists, the public text (README, submission text,
# video script) must label every evidence claim for its kind.
if [ -f evidence/EVAL_PLAN.md ] && [ -f evidence_lint.py ]; then
  python3 -I evidence_lint.py
fi

echo "check.sh: all checks passed"

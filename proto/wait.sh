#!/bin/bash
# Usage: proto/wait.sh <taskId>  -> polls until done, prints final JSON. Key from .env.local, never printed.
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env.local; set +a
for i in $(seq 1 90); do
  out=$(printf '%s' "$AHOLO_API_KEY" | python3 proto/lux3d.py task "$1" 2>&1)
  st=$(printf '%s' "$out" | python3 -c 'import sys,json; t=sys.stdin.read().split("\n",1)[1]; print((json.loads(t).get("d") or {}).get("status"))' 2>/dev/null)
  if [ "$st" = 3 ] || [ "$st" = 4 ] || [ "$st" = 6 ]; then echo "after ~$((i*10))s"; printf '%s\n' "$out"; exit 0; fi
  sleep 10
done
echo timeout; printf '%s\n' "$out"

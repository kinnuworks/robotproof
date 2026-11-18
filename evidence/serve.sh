#!/bin/bash
# Serves the app with the 27 committed test objects at /eval-objects/NN/, for the evidence reruns:
#   ./evidence/serve.sh            (leave it running; it prints the local URL)
#   python evidence/score.py http://localhost:5199 evidence/results.csv
#   python evidence/teach.py http://localhost:5199 evidence/teach.csv
set -euo pipefail
cd "$(dirname "$0")/.."
ln -sfn ../../evidence/data/objects app/public/eval-objects
trap 'rm -f app/public/eval-objects' EXIT
cd app
[ -d node_modules ] || npm ci
npx vite --port 5199 --strictPort

#!/bin/bash
# Turns the latest demo-path recording from ./check.sh (a real headless run) into docs/robotproof.gif
# for the README's first screen: the person's drag (2x), the robot's three tries (3x) ending STUMPED,
# then "teach it" (3x) ending LEARNED. Times are for the e2e.py run (drag ~3-17 s, robot ~18-41 s,
# teach ~41 s to the end).
set -euo pipefail
cd "$(dirname "$0")/.."
src=$(ls -t proto/out/check/video/*.webm | head -1)
mkdir -p docs
ffmpeg -y -loglevel error -i "$src" -filter_complex "\
[0:v]trim=3:17,setpts=(PTS-STARTPTS)/2[a];\
[0:v]trim=18:41,setpts=(PTS-STARTPTS)/3[b];\
[0:v]trim=41,setpts=(PTS-STARTPTS)/3[c];\
[a][b][c]concat=n=3:v=1,fps=10,scale=640:-1:flags=lanczos,split[x][y];\
[x]palettegen=max_colors=96[p];[y][p]paletteuse=dither=bayer:bayer_scale=4" docs/robotproof.gif
ls -la docs/robotproof.gif

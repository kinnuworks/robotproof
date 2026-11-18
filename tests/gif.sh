#!/bin/bash
# Turns the latest demo-path recording from ./check.sh (a real headless run) into docs/robotproof.gif
# for the README's first screen: the person's drag at real speed, then the robot's three tries at 3x
# speed up to the STUMPED verdict. Times are for the e2e.py run (drag ~7-15 s, robot ~23-72 s).
set -euo pipefail
cd "$(dirname "$0")/.."
src=$(ls -t proto/out/check/video/*.webm | head -1)
mkdir -p docs
ffmpeg -y -loglevel error -i "$src" -filter_complex "\
[0:v]trim=7:15,setpts=PTS-STARTPTS[a];\
[0:v]trim=23:72,setpts=(PTS-STARTPTS)/3[b];\
[a][b]concat=n=2:v=1,fps=10,scale=640:-1:flags=lanczos,split[x][y];\
[x]palettegen=max_colors=96[p];[y][p]paletteuse=dither=bayer:bayer_scale=4" docs/robotproof.gif
ls -la docs/robotproof.gif

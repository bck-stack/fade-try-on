#!/bin/sh
# Convert the Playwright WebM recording to an H.264 MP4 that Devpost/YouTube accept.
# Needs ffmpeg (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt install ffmpeg).
#
#   sh scripts/webm-to-mp4.sh [in.webm] [out.mp4]
set -eu
IN="${1:-out/fade-try-on-demo.webm}"
OUT="${2:-${IN%.webm}.mp4}"
# The recording is 390x844 (CSS pixels); scale 2x to 780x1688 so text stays sharp
# enough on YouTube. +faststart so it streams before it has fully downloaded.
ffmpeg -y -i "$IN" -vf "scale=iw*2:ih*2:flags=lanczos,fps=30" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an "$OUT"
echo "Wrote $OUT"

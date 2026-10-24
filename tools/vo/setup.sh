#!/bin/sh
# One-time setup for OFFLINE voice-over rendering (developer machines only — the game itself never calls a TTS
# service: it plays the mp3 files in public/vo). Creates tools/vo/.venv with Microsoft Edge's neural TTS client.
#   sh tools/vo/setup.sh && export EDGE_TTS=tools/vo/.venv/bin/edge-tts
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install -q 'edge-tts==7.3.1'
.venv/bin/edge-tts --version
command -v ffmpeg >/dev/null || echo "also install ffmpeg (brew install ffmpeg): the generators trim and loudness-normalise every take"

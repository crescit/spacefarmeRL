#!/usr/bin/env bash
set -euo pipefail

forbidden='(^|/)(node_modules|saves|\.env($|\.)|__pycache__)(/|$)|\.(gba|gbc|nes|sfc|smc|sav|7z)$|(^|/)roms?$'
tracked_bad="$(git ls-files | grep -E -i "$forbidden" || true)"
if [[ -n "$tracked_bad" ]]; then
  echo "public-check: forbidden tracked paths:" >&2
  echo "$tracked_bad" >&2
  exit 1
fi

history_bad="$(git rev-list --objects HEAD | grep -E -i ' (.*\/)?([^ ]*\.(gba|gbc|nes|sfc|smc|sav|7z)|roms?)$' || true)"
if [[ -n "$history_bad" ]]; then
  echo "public-check: forbidden objects in HEAD history:" >&2
  echo "$history_bad" >&2
  exit 1
fi

if git grep -n -I -E '(BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})' -- ':!package-lock.json'; then
  echo "public-check: possible credential found" >&2
  exit 1
fi

echo "public-check: tracked files, HEAD history, and credential patterns look clean"

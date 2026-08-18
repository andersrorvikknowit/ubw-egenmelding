#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: open-unit4-chrome.sh [--profile-dir DIR] [--port PORT] [URL]

Opens Google Chrome with a dedicated Unit4/UBW user data directory.
If the profile directory does not exist, it is created.
When no URL argument or UNIT4_URL override is provided, it opens:
  https://ubw.unit4cloud.com/se_kno_prod_web/

Environment:
  UNIT4_URL                 URL override when no URL argument is provided.
  UNIT4_CHROME_PROFILE_DIR  Profile directory override.
  UNIT4_CHROME_DEBUG_PORT   Remote debugging port override.
USAGE
}

default_url="https://ubw.unit4cloud.com/se_kno_prod_web/"
profile_dir="${UNIT4_CHROME_PROFILE_DIR:-${CODEX_HOME:-$HOME/.codex}/browser-profiles/unit4-ubw}"
debug_port="${UNIT4_CHROME_DEBUG_PORT:-9224}"
url="${UNIT4_URL:-$default_url}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile-dir)
      [[ $# -ge 2 ]] || { echo "Missing value for --profile-dir" >&2; exit 2; }
      profile_dir="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || { echo "Missing value for --port" >&2; exit 2; }
      debug_port="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

mkdir -p "$profile_dir"

chrome_args=(
  "--user-data-dir=$profile_dir"
  "--remote-debugging-port=$debug_port"
  "--no-first-run"
  "--new-window"
)

if [[ -n "$url" ]]; then
  chrome_args+=("$url")
fi

case "$(uname -s)" in
  Darwin)
    if [[ -d "/Applications/Google Chrome.app" ]]; then
      open -na "Google Chrome" --args "${chrome_args[@]}"
    elif [[ -d "/Applications/Google Chrome Canary.app" ]]; then
      open -na "Google Chrome Canary" --args "${chrome_args[@]}"
    else
      echo "Google Chrome was not found in /Applications." >&2
      exit 1
    fi
    ;;
  Linux)
    chrome_bin=""
    for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
      if command -v "$candidate" >/dev/null 2>&1; then
        chrome_bin="$candidate"
        break
      fi
    done
    if [[ -z "$chrome_bin" ]]; then
      echo "Google Chrome/Chromium was not found on PATH." >&2
      exit 1
    fi
    "$chrome_bin" "${chrome_args[@]}" >/dev/null 2>&1 &
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

cat <<EOF
Opened Chrome for Unit4/UBW.
URL: $url
Profile: $profile_dir
Remote debugging: http://127.0.0.1:$debug_port
EOF

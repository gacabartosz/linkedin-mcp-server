#!/bin/bash
# comment-engine-watchdog.sh
# Pilnuje, że SILNIK KOMENTARZY nie tylko żyje (proces), ale realnie SKANUJE i odświeża drzewko.
# Lekcja z incydentu 2026-06-23: proces żył 7 dni i robił "0/0/0" — liveness to za mało.
# Health (funkcjonalny) bierzemy z dashboardu: /api/comment-engine/health → color green|yellow|red.
# Gdy RED → twardy restart daemona (kickstart -k) + odświeżenie cookie LinkedIn.

LABEL="com.gaca.linkedin-playwright-comments"
COOKIE_LABEL="com.gaca.linkedin-cookie-refresh"
UID_NUM="$(id -u)"
PLIST="/Users/gaca/Library/LaunchAgents/${LABEL}.plist"
LOG="/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp/comment-watchdog.log"
ts() { date "+%Y-%m-%dT%H:%M:%S"; }

HEALTH="$(curl -s -m 8 http://localhost:6767/api/comment-engine/health)"
COLOR="$(printf '%s' "$HEALTH" | grep -o '"color":"[a-z]*"' | head -1 | cut -d'"' -f4)"

# 1) Czy usługa jest w ogóle załadowana? Jak nie — bootstrap.
if ! launchctl list | grep -q "$LABEL"; then
  echo "$(ts) service NOT loaded — bootstrap" >> "$LOG"
  launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>>"$LOG"
  exit 0
fi

# 2) Health RED → twardy restart (czyści ew. zawis Chrome/cyklu) + cookie refresh.
if [ "$COLOR" = "red" ]; then
  # GRACE: nie restartuj świeżo wystartowanego daemona — daj mu czas na initDelay (3-10 min) + 1. cykl.
  PID="$(launchctl list | awk -v l="$LABEL" '$3==l{print $1}')"
  if [ -n "$PID" ] && [ "$PID" != "-" ]; then
    UPSEC="$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')"
    if [ -n "$UPSEC" ] && [ "$UPSEC" -lt 900 ]; then
      echo "$(ts) health=RED ale daemon młody (${UPSEC}s < 900) — grace, nie restartuję" >> "$LOG"
      exit 0
    fi
  fi
  echo "$(ts) health=RED — kickstart -k. payload=$HEALTH" >> "$LOG"
  launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>>"$LOG"
  launchctl kickstart -k "gui/${UID_NUM}/${COOKIE_LABEL}" 2>>"$LOG" || true
elif [ -z "$COLOR" ]; then
  echo "$(ts) health=UNREACHABLE (dashboard down?) payload=$HEALTH" >> "$LOG"
else
  echo "$(ts) health=$COLOR ok" >> "$LOG"
fi

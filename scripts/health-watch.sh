#!/bin/sh
# health-watch.sh — D4 operational health monitoring for linkedin-mcp on VPS.
#
# Install via cron on the VPS:
#   */5 * * * * /opt/linkedin-mcp/scripts/health-watch.sh >> /var/log/linkedin-mcp-health.log 2>&1
#
# Sends Telegram alerts via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env (read from /etc/linkedin-mcp/.env).
# Idempotent: safe to run every 5 min. Only alerts on threshold breach.

set -e

# Load secrets if present
if [ -f /etc/linkedin-mcp/.env ]; then
  set -a; . /etc/linkedin-mcp/.env; set +a
fi

DATA_DIR="${LINKEDIN_DATA_DIR:-/data/linkedin-mcp}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups/linkedin-mcp}"
DASHBOARD_HOST="${DASHBOARD_HOST:-https://admin.bartoszgaca.pl}"
ALERT_STATE_DIR="/var/lib/linkedin-mcp-health"
mkdir -p "$ALERT_STATE_DIR"

alert() {
  local key="$1"
  local msg="$2"
  local state_file="$ALERT_STATE_DIR/$key"
  # Suppress duplicate alerts within 1h
  if [ -f "$state_file" ] && [ "$(find "$state_file" -mmin -60 2>/dev/null)" ]; then
    return
  fi
  touch "$state_file"
  echo "[$(date +%FT%T)] ALERT [$key]: $msg"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=[linkedin-mcp] $msg" >/dev/null 2>&1 || true
  fi
}

clear_alert() {
  rm -f "$ALERT_STATE_DIR/$1"
}

# 1. Container restart loop — count restarts in last 5 min
restart_count=$(docker events --since 5m --until 0s --filter type=container --filter event=restart 2>/dev/null | grep -c "linkedin-mcp" || echo 0)
if [ "$restart_count" -ge 3 ]; then
  alert "restart-loop" "Container restart loop: $restart_count restarts in 5 min"
else
  clear_alert "restart-loop"
fi

# 2. Disk usage on /data/
disk_pct=$(df -P "$DATA_DIR" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}' || echo 0)
if [ "${disk_pct:-0}" -ge 80 ]; then
  alert "disk-full" "Disk on $DATA_DIR at ${disk_pct}%"
else
  clear_alert "disk-full"
fi

# 3. DB size growth — flag if any DB grew > 50MB in last hour
for db in scheduler analytics engage prospects content; do
  cur="$DATA_DIR/${db}.db"
  prev_size_file="$ALERT_STATE_DIR/${db}.db.size"
  [ ! -f "$cur" ] && continue
  cur_size=$(stat -c %s "$cur" 2>/dev/null || stat -f %z "$cur" 2>/dev/null || echo 0)
  if [ -f "$prev_size_file" ]; then
    prev_size=$(cat "$prev_size_file")
    diff=$((cur_size - prev_size))
    # 50 MB = 52428800 bytes
    if [ "$diff" -ge 52428800 ]; then
      alert "db-growth-$db" "$db.db grew ${diff} bytes (>50MB) since last check"
    fi
  fi
  echo "$cur_size" > "$prev_size_file"
done

# 4. LinkedIn 429 streak (last 1h logs)
streak=$(docker logs --since 1h linkedin-mcp-auto-engage 2>/dev/null | grep -c "429" || echo 0)
streak_publish=$(docker logs --since 1h linkedin-mcp-auto-publish 2>/dev/null | grep -c "429" || echo 0)
total_429=$((streak + streak_publish))
if [ "$total_429" -ge 3 ]; then
  alert "li-429-streak" "LinkedIn 429 streak: $total_429 in last 1h. Pause daemons, refresh li_at?"
else
  clear_alert "li-429-streak"
fi

# 5. Daily backup created
today=$(date +%F)
if [ ! -d "$BACKUP_DIR" ] || ! ls "$BACKUP_DIR"/*-${today}.db >/dev/null 2>&1; then
  hour=$(date +%H)
  if [ "$hour" -ge 2 ]; then
    alert "no-backup-today" "No backup found for $today in $BACKUP_DIR (cron should have run at 06:25)"
  fi
else
  clear_alert "no-backup-today"
fi

# 6. OAuth token expiry
auth_file="$DATA_DIR/auth.json"
if [ -f "$auth_file" ]; then
  expires_at=$(grep -o '"expires_at"[[:space:]]*:[[:space:]]*"[^"]*"' "$auth_file" | sed 's/.*: *"\([^"]*\)".*/\1/' | head -1)
  if [ -n "$expires_at" ]; then
    expires_epoch=$(date -d "$expires_at" +%s 2>/dev/null || echo 0)
    now_epoch=$(date +%s)
    days_left=$(( (expires_epoch - now_epoch) / 86400 ))
    if [ "$days_left" -lt 7 ] && [ "$days_left" -ge 0 ]; then
      alert "oauth-expiry" "OAuth token expires in $days_left days. Refresh via $DASHBOARD_HOST/oauth/start"
    elif [ "$days_left" -lt 0 ]; then
      alert "oauth-expired" "OAuth token EXPIRED $((-days_left)) days ago. Refresh via $DASHBOARD_HOST/oauth/start"
    else
      clear_alert "oauth-expiry"
      clear_alert "oauth-expired"
    fi
  fi
fi

# 7. Dashboard health endpoint
if [ -n "$DASHBOARD_BASIC_AUTH" ]; then
  if ! curl -fsS -m 10 -u "$DASHBOARD_BASIC_AUTH" "$DASHBOARD_HOST/api/health" >/dev/null 2>&1; then
    alert "dashboard-down" "Dashboard /api/health probe failed at $DASHBOARD_HOST"
  else
    clear_alert "dashboard-down"
  fi
fi

echo "[$(date +%FT%T)] health-watch ok"

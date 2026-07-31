#!/usr/bin/env bash
# RELCON EC2 host health report. Run this on the EC2 host, not inside Docker.
# Configuration: /etc/relcon-server-report.env (REPORT_TO=recipient@example.com)

set -u

CONFIG_FILE="/etc/relcon-server-report.env"
[[ -r "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

REPORT_TO="${REPORT_TO:-}"
REPORT_FROM="${REPORT_FROM:-RELCON EC2 Monitor <$(hostname -f 2>/dev/null || hostname)>}"
if [[ -z "$REPORT_TO" ]]; then
  echo "REPORT_TO is not configured in $CONFIG_FILE" >&2
  exit 1
fi

section() { printf '\n\n========== %s ==========' "$1"; }
run() { "$@" 2>&1 || true; }
metadata() {
  local path="$1" token
  token="$(curl -fsS --connect-timeout 2 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token 2>/dev/null || true)"
  [[ -n "$token" ]] && curl -fsS --connect-timeout 2 -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$path" 2>/dev/null || true
}

INSTANCE_ID="$(metadata instance-id)"
PUBLIC_IP="$(metadata public-ipv4)"
INSTANCE_NAME="$(metadata tags/instance/Name)"
[[ -n "$INSTANCE_NAME" ]] || INSTANCE_NAME="$(hostname)"
[[ -n "$PUBLIC_IP" ]] || PUBLIC_IP="Not assigned / unavailable"

REPORT="$(
  printf 'RELCON EC2 SERVER HEALTH REPORT\n'
  printf 'Date & Time: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf 'EC2 Instance Name: %s\nInstance ID: %s\nPublic IP: %s\n' "$INSTANCE_NAME" "${INSTANCE_ID:-Unavailable}" "$PUBLIC_IP"
  section 'SERVER UPTIME'; uptime
  section 'CPU USAGE (%)';
  CPU_LINE_1="$(LC_ALL=C top -bn1 | awk -F',' '/Cpu\(s\)/ {gsub(/.*: /, "", $1); print $1; exit}')"
  printf 'CPU used: %s\n' "${CPU_LINE_1:-Unavailable}"
  run nproc | awk '{print "CPU cores: " $1}'
  section 'RAM TOTAL / USED / FREE'; free -h
  section 'SWAP USAGE'; free -h | awk 'NR==1 || /^Swap:/'
  section 'DISK USAGE'; df -hT -x tmpfs -x devtmpfs
  section 'TOP 10 MEMORY CONSUMING PROCESSES'; ps -eo pid,user,comm,%mem,%cpu --sort=-%mem | head -n 11
  section 'TOP 10 CPU CONSUMING PROCESSES'; ps -eo pid,user,comm,%cpu,%mem --sort=-%cpu | head -n 11
  section 'LOAD AVERAGE'; cat /proc/loadavg
  section 'RUNNING DOCKER CONTAINERS';
  if command -v docker >/dev/null 2>&1; then
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
    printf '\nDocker resource snapshot:\n'; docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}'
  else echo 'Docker is not installed.'; fi
  section 'FAILED SERVICES'; systemctl --failed --no-pager
  section 'RECENT SYSTEM CRASHES / KERNEL ERRORS';
  run journalctl -p err..alert --since '24 hours ago' --no-pager | tail -n 80
  section 'RECENT OOM EVENTS';
  run journalctl -k --since '24 hours ago' --no-pager | grep -Ei 'out of memory|oom-killer|killed process' | tail -n 80
  section 'RECENT DISK ERRORS';
  run journalctl -k --since '24 hours ago' --no-pager | grep -Ei 'I/O error|buffer I/O|disk error|filesystem error|ext4-fs error|xfs.*error' | tail -n 80
  section 'NETWORK CONNECTION SUMMARY';
  run ss -s
  printf '\nListening ports:\n'; run ss -lntup | head -n 80
  section 'END OF REPORT'; printf '\n'
)"

if ! command -v msmtp >/dev/null 2>&1; then
  echo "msmtp is not installed. Install it with: sudo apt-get install -y msmtp msmtp-mta" >&2
  exit 1
fi

printf 'To: %s\nFrom: %s\nSubject: [RELCON EC2] Health report - %s\nContent-Type: text/plain; charset=UTF-8\n\n%s' \
  "$REPORT_TO" "$REPORT_FROM" "$INSTANCE_NAME" "$REPORT" | msmtp -t

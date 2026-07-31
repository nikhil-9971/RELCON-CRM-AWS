#!/usr/bin/env bash
# Run once on the EC2 host after copying this repository there.
set -euo pipefail

SCRIPT_SOURCE="${1:-$(cd "$(dirname "$0")" && pwd)/ec2-server-report.sh}"
sudo apt-get update
sudo apt-get install -y msmtp msmtp-mta
sudo install -m 0755 "$SCRIPT_SOURCE" /usr/local/sbin/relcon-server-report

if [[ ! -f /etc/relcon-server-report.env ]]; then
  sudo tee /etc/relcon-server-report.env >/dev/null <<'EOF'
# Recipient of EC2 health reports.
REPORT_TO=nikhil.trivedi@relconsystems.com
REPORT_FROM=RELCON EC2 Monitor <server-monitor@relconsystems.com>
EOF
  sudo chmod 600 /etc/relcon-server-report.env
  echo "Created /etc/relcon-server-report.env. Set the recipient if required."
fi

echo "Configure SMTP in /etc/msmtprc, then test: sudo /usr/local/sbin/relcon-server-report"
echo "Example cron (daily at 08:00 IST): 0 8 * * * /usr/local/sbin/relcon-server-report"

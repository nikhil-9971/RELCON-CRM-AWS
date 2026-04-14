#!/bin/bash
# ============================================
# RELCON CRM - EC2 Ubuntu Setup Script
# Sirf EK baar run karo naye server pe
# ============================================

set -e  # Error pe ruk jao

echo "🚀 EC2 Server setup shuru ho raha hai..."

# ─── System update ───
sudo apt-get update -y
sudo apt-get upgrade -y

# ─── Docker install ───
echo "🐳 Docker install ho raha hai..."
sudo apt-get install -y \
    ca-certificates curl gnupg lsb-release

sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

# ─── Docker Compose v2 ───
echo "📦 Docker Compose install ho raha hai..."
sudo apt-get install -y docker-compose-plugin

# ─── Current user ko docker group me daalo (sudo mat lagao) ───
sudo usermod -aG docker $USER

# ─── Docker auto-start on reboot ───
sudo systemctl enable docker
sudo systemctl start docker

# ─── App folder banao ───
mkdir -p ~/relcon-crm
echo "📁 App folder ready: ~/relcon-crm"

# ─── Firewall rules ───
echo "🔒 UFW firewall configure ho raha hai..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS (baad ke liye)
sudo ufw --force enable

echo ""
echo "✅ Setup complete!"
echo ""
echo "⚠️  IMPORTANT: Abhi logout karo aur dobara login karo"
echo "   taaki docker group changes apply hon"
echo ""
echo "   Verify karo: docker run hello-world"

# RELCON CRM — CI/CD Deployment Guide

## Flow Overview

```
GitHub Push (main)
      ↓
GitHub Actions
  ├── npm install + lint + test
  ├── Docker image build
  └── Push → Docker Hub
      ↓
EC2 Ubuntu
  └── docker compose up (auto deploy)
```

---

## Step 1: GitHub Secrets Set Karo

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name       | Value kya daalna hai                          |
|-------------------|-----------------------------------------------|
| `DOCKER_USERNAME` | Tumhara Docker Hub username                   |
| `DOCKER_PASSWORD` | Docker Hub password ya Access Token           |
| `EC2_HOST`        | EC2 Public IP (e.g. `13.232.xx.xx`)           |
| `EC2_USER`        | `ubuntu` (default Ubuntu EC2 user)            |
| `EC2_SSH_KEY`     | EC2 ka **private key** (.pem file ka content) |
| `MONGO_URI`       | MongoDB Atlas connection string               |
| `SESSION_SECRET`  | Koi bhi random string (JWT/session ke liye)   |

### EC2_SSH_KEY kaise copy karein:
```bash
cat your-key.pem
# Poora output copy karo (-----BEGIN RSA PRIVATE KEY----- se lekar end tak)
```

---

## Step 2: EC2 Server Setup (Sirf Ek Baar)

```bash
# 1. EC2 me SSH karo
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# 2. Script upload karo (local machine se)
scp -i your-key.pem ec2-setup.sh ubuntu@<EC2_PUBLIC_IP>:~/

# 3. Script run karo
chmod +x ~/ec2-setup.sh
~/ec2-setup.sh

# 4. Logout aur dobara login karo (docker group apply hone ke liye)
exit
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# 5. Verify karo
docker run hello-world
```

---

## Step 3: EC2 Security Group (AWS Console me)

AWS Console → EC2 → Security Groups → Inbound Rules me ye add karo:

| Port | Protocol | Source    | Purpose       |
|------|----------|-----------|---------------|
| 22   | TCP      | Your IP   | SSH           |
| 80   | TCP      | 0.0.0.0/0 | HTTP          |
| 443  | TCP      | 0.0.0.0/0 | HTTPS (baad)  |

---

## Step 4: Deploy!

```bash
git add .
git commit -m "feat: add CI/CD pipeline"
git push origin main
```

GitHub Actions automatically:
1. Code check karega
2. Docker image build karega
3. Docker Hub pe push karega
4. EC2 pe SSH se deploy karega

**Actions tab me progress dekho:** `github.com/nikhil-9971/RELCON-CRM/actions`

---

## Server pe Manually Check Karo

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# Running containers
docker ps

# App logs
docker logs relcon-crm-app -f

# Restart karna ho toh
cd ~/relcon-crm
docker compose restart
```

---

## Project Structure

```
RELCON-CRM/
├── .github/
│   └── workflows/
│       └── deploy.yml        ← CI/CD pipeline (3 jobs)
├── backend/
│   ├── Dockerfile            ← Node.js backend image
│   ├── package.json
│   └── server.js             ← Entry point
├── frontend/
│   ├── Dockerfile            ← nginx frontend image
│   ├── nginx.conf
│   ├── entrypoint.sh
│   ├── html/                 ← HTML files
│   └── assets/               ← CSS, JS, images
├── docker-compose.yml        ← EC2 pe run karne ke liye
├── ec2-setup.sh              ← One-time server setup
└── DEPLOYMENT.md
```

---

## Troubleshooting

**Container start nahi ho raha?**
```bash
docker logs relcon-crm-app
```

**MongoDB connect nahi ho raha?**
- Atlas me Network Access → `0.0.0.0/0` whitelist karo
- MONGODB_URI GitHub secret me sahi hai?

**Port 80 accessible nahi?**
- EC2 Security Group me port 80 open hai?
- `sudo ufw status` check karo

**GitHub Actions fail ho raha?**
- Secrets sahi set hain? (spelling check karo)
- EC2_SSH_KEY me poori key hai (header + footer)?

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
      ↓
Host Nginx (port 80/443, SSL) → localhost:8080 (frontend container)
```

---

## ⚠️ Server Change / Migration Checklist

**Jab bhi naya EC2 instance banao ya IP change ho, ye 5 steps zaroor karo — isse page load na hone wali dikkat dobara nahi aayegi:**

1. **Elastic IP allocate + associate karo** naye instance ke saath (taaki IP dobara na badle restart pe)
2. **GoDaddy DNS me A record update karo** — `@` record ki value naya Elastic IP daalo (TTL 600s hai to ~10 min me propagate ho jayega)
3. **Security Group me ye ports open karo**: `22` (SSH), `80` (HTTP), `443` (HTTPS) — sirf ye teen chahiye, `8080`/`3001` public expose karne ki zaroorat nahi
4. **Host-level nginx + SSL setup karo** — niche "Host Nginx Reverse Proxy Setup" section follow karo
5. **`.env` file naye server pe daalo** aur `docker compose up -d` chalao

---

## Step 1: GitHub Secrets Set Karo

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name       | Value kya daalna hai                          |
|-------------------|-----------------------------------------------|
| `DOCKER_USERNAME` | Tumhara Docker Hub username                   |
| `DOCKER_PASSWORD` | Docker Hub password ya Access Token           |
| `EC2_HOST`        | EC2 Public IP / Elastic IP                    |
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

## Step 2: EC2 Server Setup (Sirf Ek Baar / Naye Server Pe)

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
| 443  | TCP      | 0.0.0.0/0 | HTTPS         |

> `8080` aur `3001` yahan add karne ki zaroorat **nahi** hai — ye sirf host ke andar `127.0.0.1` se hi access hone chahiye, host nginx unhe internally forward karega.

---

## Step 4: Host Nginx Reverse Proxy Setup (Domain + SSL ke liye)

Docker compose `frontend` container host port `8080` par nginx serve karta hai, `backend` container `3001` par. Domain (`nikhildevops.co.in`) ko port 80/443 par kaam karne ke liye ek **host-level nginx** chahiye jo sab kuch `localhost:8080` tak forward kare (frontend container ka apna nginx already `/api`, `/ws` waghera internally route kar leta hai).

```bash
# 1. Nginx install karo
sudo apt update && sudo apt install -y nginx

# 2. Config file banao
sudo nano /etc/nginx/sites-available/nikhildevops.co.in
```

Config content:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name nikhildevops.co.in www.nikhildevops.co.in;

    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Nano me: `Ctrl+O` → `Enter` (save) → `Ctrl+X` (exit).

```bash
# 3. Enable karo, default site hatao, test karo
sudo ln -s /etc/nginx/sites-available/nikhildevops.co.in /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 4. Test — http://nikhildevops.co.in khulna chahiye ab

# 5. SSL certificate lagao (HTTPS zaroori hai kyunki Google OAuth redirect https:// use karta hai)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d nikhildevops.co.in -d www.nikhildevops.co.in
```

Certbot automatically config me `listen 443 ssl` block add kar dega aur cert auto-renew set kar dega.

---

## Step 5: Deploy!

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
docker logs relcon_backend -f
docker logs relcon_frontend -f

# Restart karna ho toh
cd ~/relcon-crm
docker compose restart

# Nginx status / reload
sudo systemctl status nginx
sudo systemctl reload nginx
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
docker logs relcon_backend
docker logs relcon_frontend
```

**MongoDB connect nahi ho raha?**
- Atlas me Network Access → `0.0.0.0/0` whitelist karo
- `MONGO_URI` GitHub secret / `.env` me sahi hai?

**Domain (nikhildevops.co.in) load nahi ho raha?**
- DNS A record (`@`) naye Elastic IP ki taraf point kar raha hai? (`nslookup nikhildevops.co.in`)
- Security Group me `80`/`443` open hai?
- Host nginx chal raha hai? → `sudo ss -tulnp | grep -E ':80|:443'` me koi listener dikhna chahiye
- `sudo nginx -t` se config error to nahi

**Sirf IP:8080 pe hi load ho raha hai, domain pe nahi?**
- Iska matlab host nginx setup nahi hai ya down hai — "Step 4: Host Nginx Reverse Proxy Setup" dobara follow karo

**GitHub Actions fail ho raha?**
- Secrets sahi set hain? (spelling check karo)
- EC2_SSH_KEY me poori key hai (header + footer)?

**Credentials leak ho gaye (galti se `.env` kahin paste ho gaya)?**
- Turant MongoDB Atlas password, Google OAuth client secret, SMTP app password, aur API keys rotate/regenerate karo
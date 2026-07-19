# RELCON CRM

A full-stack CRM system built for Relcon Systems — manages leads, meetings, and material/document workflows with automated email notifications and Google Meet integration.

![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?logo=docker&logoColor=white)
![Nginx](https://img.shields.io/badge/Nginx-Reverse%20Proxy-009639?logo=nginx&logoColor=white)
![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)

---

## ✨ Features

- 🔐 Google OAuth login for meeting scheduling
- 📅 Google Meet integration for internal & external meetings
- 📦 Automated material/document upload via scheduled CRON jobs
- 📧 Email notifications (SMTP) for status updates and delivery confirmations
- 🔌 Real-time updates via WebSocket
- 🌐 External guest meeting pages with Google verification

---

## 🏗️ Tech Stack

| Layer      | Technology                          |
|------------|--------------------------------------|
| Frontend   | HTML/CSS/JS served via Nginx         |
| Backend    | Node.js + Express + WebSocket        |
| Database   | MongoDB Atlas                        |
| Auth       | Google OAuth 2.0                     |
| Email      | Nodemailer (SMTP)                    |
| Deployment | Docker, Docker Compose, GitHub Actions, AWS EC2 |
| Proxy/SSL  | Nginx + Let's Encrypt (Certbot)      |

---

## 📁 Project Structure

```
RELCON-CRM/
├── .github/
│   └── workflows/
│       └── deploy.yml        # CI/CD pipeline
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js             # Entry point
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── entrypoint.sh
│   ├── html/
│   └── assets/
├── docker-compose.yml
├── ec2-setup.sh
├── DEPLOYMENT.md             # Full deployment & server-migration guide
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- MongoDB Atlas connection string
- Google Cloud OAuth credentials
- SMTP credentials (Gmail App Password or similar)

### Environment Variables
Create a `.env` file in the project root (**never commit this file**):

```env
DOCKER_USERNAME=
MONGO_URI=
SESSION_SECRET=
GROQ_API_KEY=
FRONTEND_URL=
PUBLIC_URL=
EC2_HOST=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
TASK_SMTP_HOST=
TASK_SMTP_PORT=
TASK_SMTP_USER=
TASK_SMTP_PASS=
TASK_MAIL_FROM=
MAIL_FROM=
MAIL_TO=
BASE_URL=
APP_USER=
APP_PASS=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_EXTERNAL_REDIRECT_URI=
```

### Run locally

```bash
git clone https://github.com/nikhil-9971/RELCON-CRM.git
cd RELCON-CRM
docker compose up -d --build
```

- Frontend → `http://localhost:8080`
- Backend API → `http://localhost:3001/api`

---

## ☁️ Deployment

This project auto-deploys to AWS EC2 via GitHub Actions on every push to `main`:

```
GitHub Push → Lint/Test → Docker Build → Docker Hub → EC2 (docker compose up)
```

Full setup, Nginx reverse-proxy configuration, SSL, and the server-migration checklist are documented in **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

---

## 🔧 Useful Commands

```bash
# View running containers
docker ps

# Tail logs
docker logs relcon_backend -f
docker logs relcon_frontend -f

# Restart services
docker compose restart

# Check Nginx status
sudo systemctl status nginx
```

---

## 🛡️ Security Notes

- `.env` is git-ignored — never commit secrets to the repo
- Only ports `22`, `80`, and `443` are exposed publicly; app ports are kept behind the host Nginx reverse proxy
- SSL is handled via Let's Encrypt / Certbot with auto-renewal

---

## 📄 License

Internal project — © Advit Shoftware. All rights reserved.

# Production Deployment (Single VPS + Docker Compose)

## Prerequisites
- Docker Engine + Docker Compose plugin
- Domain A record pointing to your VPS public IP
- Firewall open for `22`, `80`, `443` only

## 1) Prepare environment
1. Copy `deploy/.env.prod.template` to `deploy/.env.prod`.
2. Fill every `CHANGE_ME` value with real production secrets.
3. Set `DOMAIN`, `FRONTEND_URL`, and `INQUIRY_DOMAIN` to your real domains.
4. Make sure DNS A records for both `DOMAIN` and `INQUIRY_DOMAIN` point to the VPS.

## 2) Build and deploy
```bash
sh deploy/scripts/deploy.sh deploy/.env.prod
```

This script:
- Fetches latest code from `origin/main` and fast-forwards the working tree
- Initializes and updates Git submodules
- Builds images
- Starts Postgres
- Runs `prisma migrate deploy`
- Starts full stack (`nginx`, `frontend`, `backend`, `inquiry`, `postgres`)

## 3) Issue TLS certificate (Let's Encrypt)
```bash
sh deploy/scripts/issue-cert.sh <your-domain> <your-email>
```

Example:
```bash
sh deploy/scripts/issue-cert.sh erp.example.com admin@example.com
```

If `INQUIRY_DOMAIN` is set in the env file, the certificate script includes it in the same Let's Encrypt certificate.

## 4) Renewal
Manual renewal:
```bash
sh deploy/scripts/renew-cert.sh
```

Recommended cron entry (host):
```cron
0 3 * * * cd /opt/sabalanerp && /bin/sh deploy/scripts/renew-cert.sh >> /var/log/sabalanerp-certbot.log 2>&1
```

## 5) Verification
- `https://<domain>/` loads frontend
- `https://<inquiry-domain>/` loads the public price inquiry app
- `https://<domain>/api/health` returns healthy status
- `https://<domain>/api/ready` returns ready state
- Socket connection works through `wss://<domain>/socket.io/`

## Rollback
1. Keep prior release image tags.
2. Update `docker-compose.prod.yml` to previous tags (or previous commit).
3. Run:
```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml up -d
```

DB rollback policy: forward-fix by default. Only run down-migrations if explicitly prepared and tested.

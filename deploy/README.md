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
- Starts Postgres and the private ClamAV service
- Runs `prisma migrate deploy`
- Starts full stack (`nginx`, `frontend`, `backend`, `inquiry`, `postgres`, `clamav`)
- Verifies that the backend can stream and scan a clean HR document

ClamAV definitions are persisted in a Docker volume and refreshed automatically. No ClamAV package or public port is required on the Ubuntu host. On a new server, the first deployment can take several minutes while ClamAV initializes. If antivirus verification fails, inspect the private service with:

```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml logs clamav backend
```

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

## Reset Sales Contracts For Go-Live

After test contracts are no longer needed, reset only the sales-contract workspace data while keeping users, CRM customers/projects, product catalogs, permissions, templates, and accounting setup.

Always run the dry-run first:
```bash
sh deploy/scripts/reset-sales-contracts.sh --env-file deploy/.env.prod
```

Apply the reset after reviewing the counts:
```bash
sh deploy/scripts/reset-sales-contracts.sh --env-file deploy/.env.prod --apply --clear-pdfs --clear-accounting-pdfs
```

The apply step creates a `pg_dump` backup under `backups/` before deleting data. The next generated sales contract number starts again from `CONTRACT_PUBLIC_NUMBER_FLOOR`, default `100001`.

## Reset CRM Customers For Go-Live

After test customers are no longer needed, reset active CRM customers while keeping users, products, permissions, departments, templates, and system setup. This also clears any remaining sales contracts and customer-linked accounting rows because sales contracts require a CRM customer.

Always run the dry-run first:
```bash
sh deploy/scripts/reset-crm-customers.sh --env-file deploy/.env.prod
```

Apply the reset after reviewing the counts:
```bash
sh deploy/scripts/reset-crm-customers.sh --env-file deploy/.env.prod --apply --clear-contract-pdfs --clear-accounting-pdfs
```

The apply step creates a `pg_dump` backup under `backups/` before deleting data.

## Rollback
1. Keep prior release image tags.
2. Update `docker-compose.prod.yml` to previous tags (or previous commit).
3. Run:
```bash
docker compose --env-file deploy/.env.prod -f docker-compose.prod.yml up -d
```

DB rollback policy: forward-fix by default. Only run down-migrations if explicitly prepared and tested.

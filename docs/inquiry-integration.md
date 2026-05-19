# Sabalan Inquiry Integration

The price inquiry app is integrated as an isolated public application, not as code inside the ERP frontend or backend.

## Source

- Upstream repository: `https://github.com/Mahaan-Amr/sabalaninquirycodex.git`
- Local path: `apps/sabalan-inquiry`
- Integration method: Git submodule

Clone or deploy with submodules enabled:

```bash
git submodule update --init --recursive
```

## Runtime Shape

- ERP frontend remains on `DOMAIN`, for example `erp.example.com`.
- Inquiry app runs as the `inquiry` Docker service on port `3001` inside the Docker network.
- Nginx publishes it on `INQUIRY_DOMAIN`, for example `inquiry.example.com`.
- Inquiry data is stored separately in the `inquiry_data` Docker volume using SQLite at `/data/inquiry.db`.
- Inquiry admin auth is separate from ERP auth.

## Required Production Env

Add these values to `deploy/.env.prod`:

```env
INQUIRY_DOMAIN=inquiry.example.com
INQUIRY_DATABASE_URL=file:/data/inquiry.db
INQUIRY_ADMIN_EMAIL=admin@sabalan.local
INQUIRY_ADMIN_PASSWORD=replace-with-a-strong-password
INQUIRY_SESSION_SECRET=replace-with-a-long-random-secret-min-32-chars
```

Both `DOMAIN` and `INQUIRY_DOMAIN` must point to the VPS before issuing the certificate.

## Deploy

```bash
sh deploy/scripts/deploy.sh deploy/.env.prod
sh deploy/scripts/issue-cert.sh erp.example.com admin@example.com deploy/.env.prod
```

`issue-cert.sh` reads `INQUIRY_DOMAIN` from the env file and requests one certificate covering both domains.

## Why This Stays Separate

The inquiry app uses Next 16, React 19, Prisma 6, SQLite, and its own admin session. The ERP frontend currently uses Next 14 and React 18, while the ERP backend uses PostgreSQL and Prisma 5. Keeping inquiry as a separate service avoids dependency conflicts and reduces the chance of breaking the ERP while still serving both apps from the same production stack.

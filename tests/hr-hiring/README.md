# HR hiring browser workflow

This suite runs the real Next.js frontend and Express/Prisma backend against an
isolated PostgreSQL database. It covers the applicant `/apply` entry and the HR
hiring workspace without contacting the production SMS provider.

## Local run

```powershell
npm run test:hr-hiring:e2e
```

On Windows, the runner starts the bundled PostgreSQL binary on port `55434`.
When `DATABASE_URL` is set, it must point to a loopback database whose name
contains `e2e` or `test`. Docker users may instead run:

```powershell
npm run test:hr-hiring:e2e:docker
npm run test:hr-hiring:e2e:down
```

The controllable SMS route is registered only when `NODE_ENV=test`,
`HR_HIRING_E2E=true`, and `HR_HIRING_SMS_ADAPTER=memory`; production startup
cannot expose it.

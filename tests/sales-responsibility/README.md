# Cross-department Sales responsibility acceptance

Uses only the existing `sabalanerp-local` API, frontend and PostgreSQL database. The fixture creates independent users named Ali Behpour and Amin Ostovar in temporary Management and Sales departments. It never imports production data or changes existing users/contracts. Fixture records and sessions are removed in `finally`; browser screenshots remain in `tmp/qa/cross-department-seller/` and must not be committed.

After building the source and updating the existing local services:

```sh
npm run docker:local:ps
LOCAL_QA_DATABASE_URL='postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10' backend/node_modules/.bin/tsx --test tests/sales-responsibility/crossDepartmentSeller.integration.test.ts
```

Add `LOCAL_QA_BROWSER=1` to include browser acceptance using the installed Chrome, desktop/mobile screenshots, assignment through the real form without a reason, and opening Amin's editor. API acceptance exercises edit-lease acquisition, save and reload rather than inferring edit authority from a visible button.

Coverage includes cross-department assignment by a system administrator, unchanged user/contract departments, current-owner list/detail/product/payment/delivery/report access, unrelated-contract denial, department reporting boundaries, readable eligibility failures, historical realized-credit preservation, optional assignment reason, required legacy-credit reason, no duplicate audit on a no-op retry, view-only authority, revocation on reassignment, and inactive-contract protection. Existing workspace, feature, financial-correction, lifecycle and edit-lease checks remain authoritative.

Pure policy tests: `backend/node_modules/.bin/tsx --test backend/src/services/__tests__/salesContractAccess.test.ts`.

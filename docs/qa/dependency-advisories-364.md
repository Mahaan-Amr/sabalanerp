# Production dependency advisory disposition (#364)

Date: 2026-09-05
Baseline: `ae96cf14` (`origin/main`)

## Runtime reachability and disposition

| Package | Runtime reachability | Disposition |
| --- | --- | --- |
| root `xlsx` 0.18.5 | No root-owned runtime import exists. Spreadsheet scripts and services resolve the backend dependency. | Removed the unused duplicate dependency. |
| backend `axios` 1.13.5 | Reachable only through the SMS provider adapter, with application-owned provider URLs and payloads. The advisory set nevertheless includes request construction, redirect, proxy, upload, and recursion weaknesses. | Upgraded to 1.20.0. |
| backend `morgan` 1.10.1 | Reachable for every HTTP request through the `combined` access log. The `:remote-user` log-forging advisory is therefore treated as reachable even though Sabalan does not currently populate that field. | Upgraded to 1.12.0. |
| backend `puppeteer` 22.15.0 | Reachable from Accounting, Contract, BI, Sales-report, and Guard PDF generation. Its old Chromium/browser-management dependency graph was production reachable. | Upgraded to 25.10.0 after moving the backend image to Node 22. |
| backend `sanitize-html` 2.17.0 | Reachable when contract HTML is sanitized before rendering. The application allowlist excludes SVG and form controls, reducing exposure to the reported bypasses, but the dependency still processes persisted/user-authored HTML. | Upgraded to 2.17.7, after the 2.17.5 URI-scheme and 2.17.6/2.17.7 mutation-XSS fixes. This patched release requires Node 22.12, so both backend Docker stages now use Node 22. |
| backend `xlsx` 0.18.5 | Reachable in the catalog-sync and legacy product upload/export paths, BI and Sales exports, and the Security personnel export. The legacy upload is bounded to 10 MiB and 5,000 product rows, but the parser advisories remain reachable for a malicious authorized upload. | Replaced the abandoned npm-registry build with the official SheetJS 0.20.3 tarball. The lockfile records its integrity. `npm run test:catalog-spreadsheet` asserts the safe version and exercises the production catalog import/export service seams while preserving product codes as text. |
| frontend `axios` 1.13.5 | Reachable for authenticated and public browser API traffic. Browser use avoids Node-only proxy paths, but request construction and form recursion are reachable. | Upgraded to 1.20.0. |
| frontend `js-cookie` 3.0.5 | No source import exists. | Removed `js-cookie` and its unused type package instead of retaining a cookie-mutation surface. |
| frontend `next` 14.2.35 | Fully reachable: the application is a self-hosted App Router application and uses fixed, environment-owned rewrites to the backend. Server Action, RSC, cache, rewrite, image, and request-processing advisories were evaluated as runtime relevant even when a specific feature is not currently configured. | Upgraded to the patched 15.5 line (resolved to 15.5.25) without taking the React/Node migration required by Next 16. |
| frontend `postcss` 8.5.6 and Next's private 8.4.31 | The direct copy is build-time only; Next's private copy is reachable during application builds. No endpoint accepts untrusted CSS, but source-map file disclosure remains relevant to a compromised build input. | Upgraded the direct dependency to 8.5.28 and used an npm override so Next resolves the same patched copy. |

The fresh audit also reported vulnerable transitive versions of `body-parser`, `qs`, `engine.io`, `socket.io-parser`, `ws`, `jws`, `lodash`, `nanoid`, `path-to-regexp`, `brace-expansion`, `browserslist`, `glob`, `minimatch`, `picomatch`, `postcss-selector-parser`, and `yaml`. They were runtime-reachable only through their listed parent applications (Express request parsing, Socket.IO transport, JWT handling, Next build/server processing, Puppeteer tooling, and YAML/config parsing), except build-only packages where no production import exists. Normal lockfile updates removed all but `qs` and Next's pinned PostCSS. The explicit `qs` 6.16.0 and PostCSS `$postcss` overrides close those two constrained paths without `npm audit fix --force`.

### Baseline advisory inventory

The following inventory maps every GHSA returned for the three production lockfiles at the baseline. `npm audit` counts vulnerable package nodes, so a single counted node can contain several GHSA records. Parent-only rows (`via:` in the audit JSON) inherit the reachability of the named child.

| Runtime / package | Baseline GHSA records | Reachability |
| --- | --- | --- |
| root/backend `xlsx` | GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9 | Runtime-reachable through the upload/export paths listed above; fixed by the vendor 0.20.3 build. |
| backend/frontend `axios` | GHSA-3p68-rc4w-qgx5, GHSA-w9j2-pvgh-6h63, GHSA-pmwg-cvhr-8vh7, GHSA-3w6x-2g7m-8v23, GHSA-xhjh-pmcv-23jw, GHSA-445q-vr5w-6q77, GHSA-m7pr-hjqh-92cm, GHSA-5c9x-8gcm-mpgx, GHSA-vf2m-468p-8v99, GHSA-pf86-5x62-jrwf, GHSA-6chq-wfr3-2hj9, GHSA-xx6v-rp6x-q39c, GHSA-q8qp-cvcw-x6jj, GHSA-fvcv-3m26-pcqx, GHSA-62hf-57xw-28j9, GHSA-hfxv-24rg-xrqf, GHSA-777c-7fjr-54vf, GHSA-p92q-9vqr-4j8v, GHSA-j5f8-grm9-p9fc, GHSA-3g43-6gmg-66jw, GHSA-35jp-ww65-95wh, GHSA-898c-q2cr-xwhg, GHSA-mmx7-hfxf-jppx, GHSA-pmv8-rq9r-6j72, GHSA-mwf2-3pr3-8698, GHSA-7q8q-rj6j-mhjq, GHSA-jqh4-m9w3-8hp9, GHSA-42h9-826w-cgv3 | Backend Node adapter is runtime-reachable through SMS; frontend browser adapter is runtime-reachable through API traffic. Application-owned URLs reduce SSRF/proxy exposure but do not remove request-construction, upload, response, and recursion exposure. |
| backend/frontend `follow-redirects`, `form-data` | GHSA-r4q5-vmmm-2653, GHSA-hmw2-7cc7-3qxx | Axios transport children; reachable in the backend adapter, while browser bundling normally avoids their Node-only paths. |
| backend `morgan` | GHSA-4vj7-5mj6-jm8m | Runtime-reachable on every HTTP request; fixed by 1.12.0. |
| backend `sanitize-html` | GHSA-vccv-cmxp-4j9h, GHSA-g8qq-57p8-ggw5, GHSA-jxwj-j7wr-gfrw | Runtime-reachable for persisted/user-authored contract HTML; fixed by 2.17.7. |
| backend `body-parser`, `qs`, `path-to-regexp` | GHSA-v422-hmwv-36x6; GHSA-w7fw-mjwx-w883, GHSA-6rw7-vpxm-498p, GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g; GHSA-37ch-88jc-xwx2 | Runtime-reachable through Express request parsing and routing. Normal upgrades plus the `qs` override remove the vulnerable nodes. |
| backend `engine.io`, `socket.io-parser`, `socket.io-adapter`, `ws` | GHSA-r635-g3xr-vw7x, GHSA-gr94-w7qr-f4j3; GHSA-677m-j7p3-52f9, GHSA-2m8v-j782-fhvr; GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p | Runtime-reachable through the authenticated Socket.IO server. Parent-only adapter rows inherit the `ws` disposition. |
| backend `jws` | GHSA-869p-cjfg-cm3x | Runtime-reachable through JWT signing/verification; removed by the lockfile refresh. |
| backend Puppeteer toolchain (`puppeteer`, `puppeteer-core`, `@puppeteer/browsers`, `extract-zip`, `basic-ftp`, `ip-address`) | GHSA-jmr9-qjv8-65gv; GHSA-5rq4-664w-9x2c, GHSA-6v7q-wjvx-w8wg, GHSA-rp42-5vxx-qpwr, GHSA-rpmf-866q-6p89; GHSA-v2v4-37r5-5v8g, GHSA-mwp4-54f8-5fhr | PDF rendering is runtime-reachable, but browser download/extraction/FTP helpers are not invoked in production because the image uses system Chromium and skips browser download. Upgrading Puppeteer removes every vulnerable child. |
| backend Puppeteer/config children (`js-yaml`, `lodash`, `nanoid`, `postcss`) | GHSA-mh29-5h37-fv8m, GHSA-h67p-54hq-rp68, GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj; GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg; GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8, GHSA-xwg4-73v4-xw9w; GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 | Installed through the old production Puppeteer/tooling graph but no direct application runtime import exists; removed by the controlled graph refresh. |
| frontend `js-cookie` | GHSA-qjx8-664m-686j | No source import; dependency removed. |
| frontend `next` | GHSA-9g9p-9gw9-jx7f, GHSA-h25m-26qc-wcjf, GHSA-ggv3-7p47-pfv8, GHSA-3x4c-7xq6-9pq8, GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-3g8h-86w9-wvmq, GHSA-ffhc-5mcf-pf4q, GHSA-vfv6-92ff-j949, GHSA-gx5p-jg67-6x7h, GHSA-h64f-5h5j-jqjh, GHSA-c4j6-fc7j-m34r, GHSA-wfc6-r584-vfw7, GHSA-36qx-fr4f-26g5, GHSA-m99w-x7hq-7vfj, GHSA-89xv-2m56-2m9x, GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q, GHSA-4c39-4ccg-62r3, GHSA-p9j2-gv94-2wf4, GHSA-955p-x3mx-jcvp | Self-hosted App Router runtime is reachable. Fixed by 15.5.25; fixed rewrites and current feature configuration reduce, but do not eliminate, individual exploit preconditions. |
| frontend `postcss` | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 | Build-time reachable through Next and direct CSS processing; fixed by the 8.5.28 override. |
| frontend Socket.IO children (`engine.io-client`, `socket.io-parser`, `ws`) | GHSA-677m-j7p3-52f9, GHSA-2m8v-j782-fhvr, GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p | Runtime-reachable through the browser realtime client; fixed by normal lockfile refresh. |
| frontend build graph (`brace-expansion`, `browserslist`, `glob`, `minimatch`, `nanoid`, `picomatch`, `postcss-selector-parser`, `yaml`) | GHSA-f886-m6hf-6m8v, GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895; GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g; GHSA-5j98-mcp5-4vw2; GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74; GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8, GHSA-xwg4-73v4-xw9w; GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj; GHSA-w9m9-85wc-3x92; GHSA-48c2-rrv3-qjmp | Build/tooling reachable only; no production source import or untrusted build input path exists. Normal lockfile refresh removes the vulnerable nodes. |

## Verification and residual risk

The final production audits are:

- root: 0 vulnerabilities;
- backend: 0 vulnerabilities;
- frontend: 0 vulnerabilities.

Commands: `npm audit --omit=dev` in the root and `npm audit --omit=dev --registry=https://registry.yarnpkg.com` in `backend` and `frontend` after the default npm audit endpoint reset those two requests. Audit results are registry- and time-dependent; a zero result is evidence for this lockfile on 2026-09-05, not a permanent guarantee.

Regression evidence after the upgrades:

- `npm --prefix backend run build`, `npm --prefix frontend run build`, `npm run architecture:check`, `npm run design-system:check`, `npm run test:design-system-foundation` (25/25), and `npm run test:design-system-adoption` (14/14) passed.
- `npm run test:catalog-spreadsheet` passed the SheetJS version plus catalog import/export compatibility contract.
- `npm run test:partner-customer-pdf` launched installed Chrome through Puppeteer 25, exercised the production Partner customer-output renderer, and returned a branded PDF payload.
- `npm --prefix packages/partner-sales-contracts test` passed 51/51 tests; `npm --prefix packages/contract-product-graph test` passed its complete unit/technical suite.
- `node scripts/run-partner-sales-tests.mjs all` passed all 65 real-schema/downstream integration cases and all 3 foundation cases. The browser stage was also run with the installed Chrome executable; no deployment, activation, or real SMS path was invoked.
- `node --test docs/qa/partner-sales/release/release-package.test.mjs` passed 8/8 release-package checks.

The remaining operational risks are controlled rather than hidden:

- SheetJS is fetched from the vendor's HTTPS CDN because the npm-registry line is not maintained. Reproducibility depends on the exact lockfile URL and integrity hash, and the catalog compatibility test protects the exercised import/export contract.
- Next 15 is a deliberate compatibility ceiling for the current frontend Node 20 / React 18 runtime. Its next major upgrade requires a separately tested React/runtime migration rather than a forced audit rewrite. The backend moved to Node 22 because the patched sanitizer and current Puppeteer require it.
- This change updates dependencies and evidence only. It does not deploy, activate Partner, or send real SMS.

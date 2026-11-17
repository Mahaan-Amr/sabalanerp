# Protected Accounting browser rehearsal for #459

Run this scenario on the authorized isolated Linux QA host, inside the protected QA network namespace, after the operator has qualified the mounted release images and opened grouped allocation through the real protected controller. Follow [the protected rehearsal host runbook](../operations/protected-rehearsal-linux-host.md) for target, network and TLS setup and [the allocation activation plan](../operations/customer-allocation-activation-plan.md) for admission. Record the served frontend and backend image identities, the release commit and the activation receipt with the test result.

Run Playwright with an installed Chromium and a trusted QA certificate. The test fixes the application origin to `https://erp.qa.test` and requires that the name resolve to loopback. Trust the QA CA through the host Chromium trust store and, if required for forwarding the intercepted request, through `NODE_EXTRA_CA_CERTS` set before launching Node. Keep the private network boundary in place.

Provision a dedicated synthetic Accounting login with treasury edit authority and a fresh synthetic customer within the private QA database. The customer's displayed company name must match the supplied marker exactly. In its accounting profile, post one standalone debt of **30 rials**, one standalone credit of **10 rials**, and one confirmed cash receipt with **20 rials** of unapplied balance. Use distinct descriptions for the debt and independent credit. The account must have no contracts, prior allocations, refunds or pending allocation requests. The Tehran date on the run must fall in an open financial period with an effective customer posting rule that the Accounting form can select by default. No other operator or process should use the fixture during this test.

Provide the following variables in the private shell. Load the password from the operator's private credential store or input without shell echo.

| Variable | Required value |
| --- | --- |
| `SABALAN_ALLOCATION_QA_RUN` | `1` |
| `SABALAN_ALLOCATION_QA_ORIGIN` | `https://erp.qa.test` |
| `SABALAN_ALLOCATION_QA_USERNAME` | Dedicated fixture login with a `qa-459-` prefix and lowercase ASCII letters, digits or hyphens after it |
| `SABALAN_ALLOCATION_QA_PASSWORD` | Password for the fixture login |
| `SABALAN_ALLOCATION_QA_MARKER` | Exact company display name with a `QA-459-` prefix and lowercase ASCII letters, digits or hyphens after it |
| `SABALAN_ALLOCATION_QA_PROFILE_ID` | Accounting profile ID for that synthetic customer |
| `SABALAN_ALLOCATION_QA_CUSTOMER_ID` | CRM customer ID for that same synthetic customer |

From the checkout containing the scenario and its locked Playwright dependencies, run:

```sh
npx --no-install playwright test --config=playwright.customer-allocation-qa.config.ts
```

The test signs in through the real browser and checks the fixture identity and balances before allowing Accounting writes. It cancels the first confirmed reservation after simulating loss before the treasury request is sent. For the second command it forwards the original request once, observes the actual committed result, then drops the browser response. After reload, the browser confirms the exact original command through the real status endpoint and refreshes the customer balances. It then reverses the independent credit share through Accounting, leaving the receipt share intact and restoring 10 rials each of debt and credit.

The canceled reservation, committed group and credit reversal are durable QA records. Provide a fresh synthetic fixture each time. If execution stops after a confirmation, inspect the recorded application outcome and preserved intent before any further work on that fixture. Playwright omits traces, screenshots and video for this run.

This is the candidate-browser slice. Retained-browser transition, concurrency and invalid-input coverage, and cross-release reporting remain separate evidence for #459.

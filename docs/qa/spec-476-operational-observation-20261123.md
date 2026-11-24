# Operational observations for #476

These read-only observations preceded the merged Sepidar and Accounting candidate. They measure the serving environment and do not qualify a candidate for promotion.

| Observation | UTC | Value |
| --- | --- | --- |
| Production checkout | 2026-11-23 19:24:24 | `3b748867a1740f49967563960575a827833fed85` |
| Available bytes on the production application filesystem | 2026-11-23 19:24:24 | 10,864,041,984 |
| Available bytes on the independent checkpoint filesystem | 2026-11-23 19:24:23 | 21,451,841,536 |
| Independent archive from the November 23 release | Read back for size and sidecar during this observation | 1,856,177,458 bytes. Sidecar records local, remote and local restore verification. Independent restore verification is false. |

The byte counts are filesystem availability observations. Required build space, restore reserve, reference-aware retention eligibility, and a signed capacity decision still belong to the protected preflight. The archive was checked for size and existing sidecar flags during this observation. The release report holds the earlier full digest readback.

The production audit census ran in a read-only PostgreSQL transaction at 19:25:25 UTC. The two largest observed relations were `effective_authorization_audit` at 219,217,920 bytes and `accounting_audit_logs` at 188,211,200 bytes, including indexes. The statistics reset timestamp was null. This sample alone provides neither a sustained growth rate nor a matched quiet and peak workload. The serving version predates the capacity sampler. See [#498 measurement procedure](runtime-capacity-498.md) for the remaining pool and worker evidence.

The configured Accounting workstation was registered in the serving backend. Physical mode was disabled. The latest completed signed health challenge recorded for that station was 2026-11-16 07:17:09 UTC. The latest consumed enrollment capture tied to an enrollment was 2026-11-22 06:04:15 UTC. This is a configuration and historical-result check. The station was not exercised in this observation. [Earlier signed health result](biometric-accounting-production-status-2026-11-16.md).

[Issue #448](https://github.com/Mahaan-Amr/sabalanerp/issues/448) still needs a privately restored, identity-bound production copy and authenticated request records for the exact candidate. The measurement validator passed its seven contract tests in this checkout. The validator tests do not contain candidate request measurements.

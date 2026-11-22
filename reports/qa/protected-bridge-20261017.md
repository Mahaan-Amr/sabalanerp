# Actual protected bridge transaction acceptance

Frozen source: `8fcb6422`; compiled bridge SHA-256
`3315487f688f587d1bcd8ef577a9d9953c1483d4068119909f436786585e8e15`.
The full backend build passed on that source. Unit acceptance, architecture
checks, and independent Standards/Spec source reviews passed. The actual native
fixture passed one integration, zero failures/skips, in 105.652 seconds:
[measured result](protected-bridge-20261017-1ee7ebeb57c86a57.json) and
[fixture intent](protected-bridge-1ee7ebeb57c86a57-intent.json).

Inside the existing sabalanerp-local project, a private helper retained real
inherited FD9 ownership, used a matching private maintenance marker and a
synthetic owned deployment/checkpoint row, and invoked the compiled bridge
against the exact 425-migration production schema baseline. The synthetic
metadata tests authority plumbing; it is not an independently verified backup
or production deployment approval.

The bridge rejected changed SQL, the wrong lease, missing native ownership,
unverified metadata and expired leases. A genuine PostgreSQL DDL event trigger
expired the lease after CREATE TABLE inside the real transaction: all DDL and
history rolled back. Actual FK parent contention rejected within the bounded
lock budget (native helper startup/closure included: 1.406 and 1.470 seconds).
Both reviewed files then committed their schema and native Prisma history
atomically. Duplicate invocations verified durable schema receipts and did not
reapply SQL. Altered column type and disabled FK enforcement on both referencing
and referenced tables were refused. Restoring the exact structure allowed a
no-op retry. Native Prisma recognized all 427 migrations; nine real HR vehicle
operation tests passed.

Native pg_dump/psql then restored the temporary database into another isolated
database on the SAME PostgreSQL service, without a second daemon. The internal
RI trigger names actually changed. Both owned receipts validated on the restored
schema without reapplication; migration names/checksums were identical. Every
native helper closed its temporary client, and zero worker sessions remained.
Both temporary databases were dropped without FORCE. Canonical local service
IDs/images/start times were unchanged. Private source/journal artifacts remain.

Independent review found two receipt defects before acceptance: internal FK
enforcement was missing, then generated RI names made logical restore unstable.
The final receipt includes stable constraint/relation/function/enforcement
semantics and multiplicity on both sides, with no generated names. The native
[negative run](protected-bridge-disabled-fk-red-20261017.tap) against earlier
compiled SHA `a9177d49733d5f0d0388be2c1d086728aa4223829e8f7242142822b0f60c45a1`
failed exactly at the disabled-FK regression (54.597 seconds). Its
[intent/database identity](protected-bridge-e7551295e9c300a7-intent.json) and
private failed database were retained; it was not reported as PASS.

At this frozen identity the bridge had no production caller. Subsequent CLI and
runner integration requires its own exact-source acceptance. This is protected
migration plumbing and synthetic schema/HR evidence, not production data,
financial/old-runtime compatibility, coherent independent recovery coverage or
an online/public mutation path. No production application or schema was changed.

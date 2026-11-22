# Kernel admission retained through actual HTTP completion

Issue #405 remains open. This private primitive is not a production fence or an
online activation entry point. Runtime operation journals, orphan/PostgreSQL
completion proof and worker/control/Inquiry integration remain required.

`KernelWriteAdmission` validates a preprovisioned frozen Linux gate inode, device,
owner and safe parent. A request cannot choose the identity, helper command or
promotion role. `/usr/bin/flock --shared --nonblock 3` inherits Node's open file
description. When that direct helper exits, Node still holds the shared kernel
lock until actual work completion. Admission verifies `/proc/self/fdinfo` and
rechecks owner and inode after acquisition. Replacement or uncertain release
poisons admission and retirement; no expiry, reset, forced close or takeover is
provided. A helper deadline never stands in for its reaping.

The HTTP lifecycle accepts an optional private ownership adapter. It retains
that ownership across async route completion, early responses, disconnects,
pending admission and response-event audit reservations. Async durable-completion
callbacks must finish before the request retires. A disconnected request awaiting
admission cannot later dispatch its domain handler. The running singleton keeps
its existing behavior until the complete owned controller is integrated.

Nine real Linux cases passed in **595.62 ms**, zero skips, inside a private `/tmp`
fixture in the existing `sabalanerp-local` backend. They verify independent
processes sharing the gate, a competing exclusive boundary, owner revocation,
drain timeout without unlocking, symlink/replaced-inode rejection, early response,
disconnect, response-event work and delayed durable completion. Ordered response
close events distinguish completion from merely waiting on a timing guess.
There are no fixture database clients, domain writes or extra Docker services.
The canonical backend image and exact start time were unchanged before/after.

```text
node scripts/run-kernel-write-admission-local.mjs
node backend/node_modules/tsx/dist/cli.mjs --test backend/src/services/__tests__/httpRequestLifecycle.test.ts backend/src/services/__tests__/runtimeStartup.test.ts
npm --prefix backend run build
npm run architecture:check
```

All eight existing HTTP/startup regressions, backend compilation and architecture
checks passed. Independent Standards and Spec reviewers found no actionable
defect in the scoped primitive and explicitly did not certify production fencing.

Compiled fixture identity:

- kernel gate: `f055d4acb091be6bb65c5db5a23dca085c930bb75d4d09d94e637e9bea95f78c`
- HTTP lifecycle: `3106e1c7cc8ce185f75a71ce7650bf7df1eb907bc6831a57da0e1212a920c5ff`
- native fixture: `e46ad007604b5769375bb32156bc1de73ecd24df0a758c4f748516d3fdeeca75`

Kernel locks alone cannot certify database completion after a runtime crash:
an already-sent PostgreSQL commit can finish after its client process exits.
The owned controller must inspect durable pending operations and exact runtime
database sessions before accepting a recovery boundary. No production/index
integration bypasses that requirement.

# Closed production base derived-copy retirement — 2026-10-18

The scoped cleanup completed and reclaimed an observed net **1,530,531,840 bytes** (available space 4,773,343,232 → 6,303,875,072). It removed the exact stopped diagnostic container without force and the four verified derived `pgdata`/`restore-input.tar` copies belonging to the explicitly closed failed and successful physical-restore operations.

The original independently decrypted base, encrypted remote base, all proof files, protected legacy image archive and imported PostgreSQL image remain retained. The controller verified native closure and archived its own intent. This does not authorize pruning other checkpoints or images.

**The broader result remains unsuccessful:** SSH exit 1 and `foreignIdentitiesUnchanged:false`. Foreign inventory changed 18 → 17 when container `3c4c8b14f552b874d0c93d7c9d69c5a6179ebf28a79b1e434c304e34c8bce849` disappeared between observations. All 17 survivors retained their identities, images and start times. No causation or whole-host acceptance is inferred. No new healthy application recovery point or public online admission was published.

## Preconditions and negative evidence

Spec and Standards reviews approved the bounded sources before execution. A private mount namespace with recursively private propagation prevents a later host bind mount from entering the cleanup view. The descriptor-relative walker checks type, identity, link count and mount boundaries before removal; it has no unsupported-platform fallback.

The first native fixture, `derived-base-mount-qa-3fc164567332402b88bedaf70a876416`, proved same-device bind refusal but then failed on unavailable Python `rmtree(dir_fd=...)` support before deleting its fake trees. Its failure and actual closure are preserved. The corrected native fixture, `derived-base-mount-qa-4861e9d243ea43ffb2bf44a19dd5516b`, passed the same-device bind refusal/sentinel checks and exact fake-copy retirement with native exit 0.

The first real wrapper attempt, `retire-derived-base-2e2b006af8dc426ba4332263adc908f8`, failed to parse the embedded remote program before any remote statement executed. A generic placeholder replacement had altered an error-label substring. The corrected wrapper replaces only the first placeholder and compiles the embedded program before networking. The actual scoped cleanup is `retire-derived-base-f7a32ceaa5ab48ab9cd83f2771f67583`.

## Evidence

- [Actual scoped cleanup and broader false result](retire-derived-base-f7a32ceaa5ab48ab9cd83f2771f67583.json).
- [Actual intent and source identities](retire-derived-base-f7a32ceaa5ab48ab9cd83f2771f67583-intent.json).
- [Corrected native mount fixture](derived-base-mount-qa-4861e9d243ea43ffb2bf44a19dd5516b.json).
- [Failed native fixture](derived-base-mount-qa-3fc164567332402b88bedaf70a876416.json).
- [Pre-execution parse failure](retire-derived-base-2e2b006af8dc426ba4332263adc908f8.json).
- [Frozen executed sources and exact raw-byte bundle](closed-base-derived-retirement-sources-20261018/exact-source-bytes.json).

Readable source copies may undergo Git line-ending normalization; the exact-byte bundle preserves the executed bytes and SHA-256 identities. These are private one-use evidence sources, not deployment authority.

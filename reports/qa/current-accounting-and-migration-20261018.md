# Current financial behavior and migration primitives

The existing local `sabalanerp-local` PostgreSQL service ran isolated, serial
fresh-schema tests using all **434** current migration directories. No second
Compose stack was created. Temporary database cleanup refuses outstanding SQL
connections and prepared transactions; it does not terminate them.

- Customer financial integration: **18/18**, zero skips, 572,386 ms.
- Online migration primitive integration: **2/2**, zero skips, 47,785 ms.

[Evidence](current-accounting-and-migration-20261018.json) includes complete TAP,
the source commit, migration checksums and relevant financial source checksums.
The unrelated working changes were confined to private legacy file adoption.

These results verify current financial behavior and concurrent mirror-column
migration primitives. They do not prove production's populated 425-migration
database upgrades safely to 434, nor compatibility with its actual old Prisma
client or financial semantics. In particular, current credit allocations may
have a null treasury transaction, whereas the old client declares that field
mandatory. The seven accounting migrations remain outside online admission.
A reader-compatible predecessor and controlled activation require separate
proof before overlapping those versions or selecting a rollback image.

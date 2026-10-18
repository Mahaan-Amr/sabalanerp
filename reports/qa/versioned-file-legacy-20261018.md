# Private legacy file baseline acceptance

The private `VersionedFilePublication.adoptLegacy` interface copies an existing
bounded inventory into independent immutable objects without rewriting live
inodes. It requires the actual exclusive root gate. Its caller must first retire
all legacy writers and prove native fleet closure; this interface does not fence
unregistered actors or publish a coherent application recovery point.

The final Linux fixture passed **7/7**, with no skips, on source SHA-256
`38062816e753ea9161dfdddec1da79341c043ff5223164f820be308463c78d04`:
[native evidence](versioned-file-legacy-1436513b140f09ba007a0297b2074d29.json).
It exercises the actual exclusive gate, unchanged live inodes, retained bytes
after ordinary replacement/deletion, alias and hardlink refusal, bounded empty
directory refusal, concurrent unregistered mutation, lost gate ownership and
actual disposable owner process death after its first durable head.

Any post-intent uncertainty preserves the baseline intent and blocks capture and
re-adoption. Existing unknown contents are never cleared. Capacity includes
filesystem block rounding, metadata, inodes and a 1 GiB reserve before intent.
Non-root empty legacy directories are refused rather than silently escaping
future directory reservation accounting. A controller must explicitly prepare
such an inventory; adoption never deletes existing directories.

The exact pre-fix source failed the new empty-directory assertion, while five
other cases passed: [specific RED evidence](versioned-legacy-empty-directory-red-20261018.json).
The earlier core publication **10/10** and stream **11/11** runs belong to the
earlier source identity, not a complete rerun of this final module. The final
change is confined to adoption; an AST-based comparison records exact source
bytes and equality outside that method:
[source comparison](versioned-file-legacy-module-equivalence-20261018.json).
Backend TypeScript validation passed. Independent standards and specification
reviews accepted this private slice and its evidence limits.

No ordinary route, production root, privacy erasure path or public online
admission is enabled. Whole-inventory adoption time and the ten-minute affected
workflow budget remain unproven.

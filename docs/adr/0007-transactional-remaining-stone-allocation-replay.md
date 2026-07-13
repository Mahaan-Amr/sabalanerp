# Transactional remaining-stone allocation replay

Contract product rows use stable row identities, and remaining-stone children reference their source row by that identity rather than by array position or catalog identity. Every source or child allocation mutation regenerates the source inventory and replays child allocations deterministically in their original order as one atomic change, preserving valid work while rejecting the entire mutation with explicit conflicts when replay is impossible.

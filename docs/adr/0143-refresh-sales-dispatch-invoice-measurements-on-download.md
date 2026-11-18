# Refresh sales dispatch invoice measurements on download

Standard PDF downloads and prints of previously issued sales dispatch invoices use the corrected layout with the same invoice identity and frozen issuance evidence. This is a presentation correction under ADR-0138: retain the original artifact and hash for audit, preserve invalid or void status, and keep substantive corrections on the existing replacement workflow.

Product rows display the loaded quantities. For a fixed-length longitudinal row with a known count, area equals piece length × width × loaded count. The total loaded linear metres already include the count, so multiplying total loaded metres by width gives the same area. When count is unknown, its cell shows a dash and area uses total loaded metres × width. Piece count comes from sealed Logistics evidence or, for older fixed-length counted rows, an exact whole-piece conversion. A length that represents the whole contract is omitted.

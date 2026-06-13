# Contract Tools Compatibility Rename

Contract pricing uses ابزار as the business term, while the existing database table, API route, and persisted contract fields still use sub-service names. We will rename user-facing inventory and contract language to ابزار, keep the legacy `sub_services` storage and `/api/sub-services` route for compatibility, and avoid a schema migration until contract creation is stable under the corrected vocabulary.

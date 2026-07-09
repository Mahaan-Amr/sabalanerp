# Loading drivers enter a shared pool before Logistics selection

Logistics no longer creates a system driver request for a specific draft بارگیری. حراست coordinates with Logistics outside the system, sends queued drivers into a shared وارد محوطه بارگیری pool, and Logistics selects one or more of those available drivers for a draft; selected drivers are reserved for that draft, and بارگیری quantities are recorded per selected driver so final evidence preserves which vehicle carried which allocation.

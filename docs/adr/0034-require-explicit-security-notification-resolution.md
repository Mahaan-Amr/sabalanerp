# Separate security-notification read state from security decisions

Opening a new-browser or similar account-security notification marks it read and navigates to the highlighted session in the Self-Service Personal Area. Read-all includes these alerts. Reading removes the unread indicator and reduces the bell count while preserving the durable notification history; it neither acknowledges the activity as the User's nor revokes access.

Explicit security actions remain separate: the User may acknowledge the activity as theirs or report that it was not theirs, in which case the identified session is revoked and password change is strongly offered. These actions remain available when opening a read notification. Read and unread labels must not imply that a security decision has been recorded.

This supersedes the previous rule that kept security alerts unread until explicit resolution. That rule made read-all silently leave alerts pending and coupled inbox attention with security decisions. The accepted trade-off is consistent inbox behavior while retaining deliberate security actions and their audit history.

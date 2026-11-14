# #439 local host recovery and bounded owner probe — 2026-11-13

This is read-only/no-data QA host evidence after the simultaneous-daemon stall recorded in `protected-rehearsal-438-local-backup-owner-20261113.md`. It does not admit #432 or establish an independent backup failure domain. No production host, W: content, checkpoint, key, QA service, network, database, or Docker setting was changed.

## Recovered state

At approximately 13:49–13:51 Tehran time, Windows reported 3.75 GiB free physical RAM of 31.75 GiB and `vmmem` used 8.27 GiB working set (9.75 GiB private). `wsl --list --running` showed `docker-desktop`, `sabalanerp-qa-debian`, and `sabalanerp-qa-backup`. The two QA distros share one WSL VM: `free -m` in each showed 15,863 MiB total, about 9,002 MiB available, and only 8 MiB of 4,096 MiB swap used. `/proc/pressure/memory` had zero 10/60/300-second averages, and `dmesg` showed no OOM/killed-process match. These observations do not identify the cause of the earlier stall; they only show no current measured memory pressure or OOM evidence.

Bounded WSL commands completed in 0.5–0.8 seconds. The app native daemon was PID 12 with Engine ID `33f03eef-8f8d-45a2-af36-b98958ddacde`; the backup native daemon was PID 706 with Engine ID `3fcbe8f4-f5a8-46e8-9cdd-883a19b8d986`. Both were Docker 29.2.1 at `/var/lib/docker`, with separate distro sockets and the manual `--bridge=none --iptables=false` flags. Docker Desktop's separate Engine ID was `587ad864-09c8-4149-ae53-89bb9d93ddfc` (29.9.2). The backup SSH listener remained on `127.0.0.1:2229`. No daemon restart or WSL termination was needed.

Before the stability check, `docker-compose.exe -f docker-compose.local.yml ps` showed all six `sabalanerp-local` services healthy, including ClamAV. The pinned container ID prefixes were backend `00ac2640632a`, ClamAV `b89c4299ea7d`, frontend `19aebf5decc2`, Inquiry `b67c817a4eee`, PostgreSQL `3ba7c705a08e`, and Redis `06c2b7237917`.

## Five-minute no-data stability check

From 13:51:34 to 13:56:38 Tehran time, 14 rounds completed in 303.8 seconds. Every round checked the six Desktop IDs and health both before and after, ran app and backup `/bin/true`, and invoked the exact forced-command SSH owner path as `sabalan-backup-ops@127.0.0.1:2229 preflight 0` from the app distro with the QA operations key and pinned known-hosts file. Each WSL true command had an 8-second hard timeout, each SSH preflight a 12-second timeout (plus SSH connect timeout 4 seconds), and each Compose status an 8-second timeout. A failed command, changed ID/health, noncanonical receipt, or removed resource would have stopped the loop.

All 14 preflight receipts returned `ok: true`, project `sabalanerp-backup`, empty removed container/image sets, and `availableBytes: 1024757047296`. All Desktop checks retained the six IDs above in `running` and `healthy` state. App `/bin/true` ranged from 0.471 to 1.258 seconds; backup `/bin/true` ranged from 0.497 to **5.092 seconds**; remote preflight ranged from 0.449 to 0.974 seconds. The 5.092-second backup launch in the last round shows residual latency even though it stayed within the bound. No QA containers or network were created.

## Qualification decision

The host and local owner path recovered and sustained this limited no-data interval. The earlier >35-second preflight/WSL/Desktop stall remains unexplained; no OOM evidence or current pressure proves a resource cause, and the last-round WSL latency warrants caution. If another stall occurs, capture bounded per-distro process, pressure, daemon and SSH observations first; stop only the affected QA distro/daemon after confirming no QA operation is active, and reverify the six Desktop IDs and health. A global WSL shutdown or Desktop reset is not indicated by this evidence.

**#432 remains NO-GO.** Both QA distros share this physical PC, WSL kernel, and IP, so the local backup owner cannot prove off-computer independent remote custody. The reviewed QA controller/target, immutable six-image set, source and key custody, fresh capacity certificate, restore, candidate and rollback still require their separate gates and reviewer approval.

## Disposable app-network probe

After another `docker-compose.exe -f docker-compose.local.yml ps` verified all six original Desktop IDs healthy, the app daemon alone created two empty, labeled user-defined bridge networks: `sabalan-qa-netprobe-internal-20261113` (`--internal`, ID `bdd0ca8f5c73…`, subnet `172.17.0.0/16`) and `sabalan-qa-netprobe-egress-20261113` (non-internal, ID `73fdcff2a1f0…`, subnet `172.18.0.0/16`). `docker network inspect` showed `Internal: true` and `Internal: false` respectively, empty `Containers`, and no ingress/public ports. The matching bridge links existed with `NO-CARRIER` because no containers joined them.

The app daemon still runs with `--bridge=none --iptables=false`. A read-only `iptables -t nat -S` in the app distro showed **no MASQUERADE/SNAT rule for `172.18.0.0/16`**, despite a separate existing `172.17.0.0/16` MASQUERADE rule. The host had its normal default route via WSL `eth0`; that does not prove a future container's private `172.18` source can reach an external ClamAV update server. With no container or packet test authorized for this probe, actual ClamAV egress and internal-network isolation remain unproved. Network creation alone therefore does not qualify the proposed six-service topology. A separately reviewed, scoped networking change and an actual traffic/isolation test are required before QA service creation; this probe made no daemon or global networking change.

Both disposable networks were removed by their exact names. App `docker network ls` returned only `host` and `none` afterward. Desktop, backup, and app Engine IDs remained `587ad864-09c8-4149-ae53-89bb9d93ddfc`, `3fcbe8f4-f5a8-46e8-9cdd-883a19b8d986`, and `33f03eef-8f8d-45a2-af36-b98958ddacde`. A final Desktop Compose status retained the same six IDs, all healthy. No QA container, data, volume, image, or public port was created.

## Proposed iptables-enabled app-daemon restart: stopped at prerequisite

A later narrow request proposed stopping only the app `dockerd` and restarting it with `--iptables=true` to see whether a new empty QA egress bridge receives daemon-owned NAT. Before any Docker mutation, four read-only prerequisite commands were started for Desktop Compose status, app PID/birth/network namespace, backup PID/network namespace, and Docker Desktop network namespace. **All four produced no output after their ten-second command windows.** Each exact probe process was interrupted with Ctrl-C and exited 1 without output. No app daemon PID/birth or namespace relationship was established in this attempt, and the required fresh Desktop six-service verification did not complete.

The restart was **not attempted**. No iptables, daemon, network, container, or Desktop state was changed by this attempt. The simultaneous read-only calls coincided with a fresh host stall, so the earlier five-minute serial success does not establish that a daemon restart or shared-network iptables mutation can be bounded safely. Recover and observe the three daemons and six Desktop services again with serialized, hard-timed reads before considering a separately reviewed networking change. #432 remains NO-GO.

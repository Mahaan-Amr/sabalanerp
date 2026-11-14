# #439 private network namespace: reviewed no-data probe

This is an **operator runbook**, not permission to import images, restore data, or run #432. It applies only to the D:-backed `sabalanerp-qa` WSL distro and its native Engine. Have an independent reviewer approve the actual package versions, daemon unit, backup endpoint and command transcript before the first mutation. Run each numbered phase to completion; any missing command, changed identity, unexpected output, timeout or partial cleanup is **NO-GO**. Never run `iptables`, `ip route`, `ip link`, `docker network create`, or a Docker daemon with `--iptables=true` in the WSL initial namespace. No host-side forwarding or slirp hostfwd is allowed.

## 0. Immutable inputs and before evidence

Record the exact QA distro identity, Engine version/ID/data root, `/etc/docker/daemon.json` and systemd unit bytes, the proposed `slirp4netns` package version and SHA-256, QA backup hostname/SSH port/known host key and source custody. `slirp4netns` is currently absent. Capture **all before evidence below before installing it or changing a unit**. Then install only the reviewed, version-pinned Debian package inside the QA distro and verify `slirp4netns --version`, `--netns-type=path`, `--configure`, and `--disable-host-loopback` in its installed help. Do not use an unpinned `apt install` or fetch an image. Require `ip`, `iptables-save`, `ip6tables-save`, `ss`, `dig`, `curl`, `ssh`, `sftp`, `python3`, `sha256sum`, `timeout`, and `node`; stop if any is absent. The initial resolver must not point to a loopback address: slirp's DNS forwarder can otherwise expose an initial-namespace loopback resolver despite `--disable-host-loopback` ([slirp4netns manual](https://github.com/rootless-containers/slirp4netns/blob/master/slirp4netns.1.md)).

Create a root-only evidence directory on the QA distro, outside Git (`install -d -m 0700 /srv/sabalanerp-qa/reports/netns-probe-<UTC timestamp>`). Set `E` to its absolute path, then use **the same** `E` for before and after. Capture full command output, stderr, exit status and UTC time in the operator transcript. All commands in this phase are read-only. From a root shell in the QA distro's initial namespace:

```sh
readlink /proc/self/ns/net > "$E/initial-netns.before"
iptables-save > "$E/initial-iptables-v4.before"
ip6tables-save > "$E/initial-iptables-v6.before"
ip -4 route show table all > "$E/initial-routes-v4.before"
ip -6 route show table all > "$E/initial-routes-v6.before"
ip -d -o link show > "$E/initial-links.before"
ip netns list
systemctl status docker.service docker.socket --no-pager
test ! -e /run/netns/sabalanerp-qa
if test -S /run/docker.sock; then ss -xlpn | grep -F /run/docker.sock; fi
if test -e /run/docker.pid; then cat /run/docker.pid; fi
```

If a namespace of that name exists, stop. Do not reuse or delete it in this run. Capture the Desktop namespace from `wsl -d docker-desktop -u root --exec readlink /proc/self/ns/net`, and capture its Docker Engine ID and six `sabalanerp-local` container IDs, immutable image IDs, start times and state via **the Desktop context**. Save those outputs byte-for-byte as `desktop-netns.before`, `desktop-docker-id.before`, `desktop-service-census.before`, and `local-service-census.before`. Confirm `docker compose -f docker-compose.local.yml ps` targets `sabalanerp-local` and all six expected services before any Docker action. The Desktop context, socket and service census must be independently reviewed; a QA socket must never be used for these captures. Capture both #436 checkpoint identities read-only in the operator transcript; this probe cannot touch them.

### Stop only an existing QA native daemon

The QA daemon may still be running in the initial namespace with `--iptables=false`. **After** all before captures, if `/run/docker.sock` or `/run/docker.pid` exists, identify its owning PID using `ss -xlpn`, the PID file, `/proc/<pid>/exe`, `/proc/<pid>/cmdline` and `/proc/<pid>/ns/net`. Require one `/usr/bin/dockerd` native QA process, `/var/lib/docker` data root, the pinned QA Engine ID distinct from Desktop's ID, and initial netns identity. Require `docker -H unix:///run/docker.sock ps -aq` empty, no QA Compose project, no running Docker operation or client, and no image import/restore/release in progress. Check the QA systemd unit and process tree for the last condition; if uncertain, stop the procedure, not the daemon. Record the process birth ticks and unit state. Do not stop a daemon that has any container, unknown owner, or active operation.

If that exact daemon is owned by `docker.service`, run `systemctl stop docker.socket docker.service` **inside the QA distro only**, then require its PID, socket and PID file to disappear within 30 seconds. If it was started manually, send `TERM` only to the pinned PID, wait at most 30 seconds, and require the same disappearance; never use a broad `pkill`, `killall`, `KILL`, WSL shutdown or Docker Desktop stop. If no daemon/socket exists, record that fact. In both cases record the prior QA unit/socket enablement state, then run `systemctl mask docker.service docker.socket` inside the QA distro to prevent initial-namespace socket activation. Confirm no `dockerd`, socket or PID file remains before creating the namespace. A stale socket/PID file is a refusal, not permission to remove it.

## 1. Create the one QA namespace and uplink

Keep ordinary host PID and mount namespaces. In the QA distro only, after the before snapshot and review:

```sh
ip netns add sabalanerp-qa
ip netns exec sabalanerp-qa ip link set lo up
stat -Lc 'net:[%i]' /run/netns/sabalanerp-qa
ip netns exec sabalanerp-qa readlink /proc/self/ns/net
```

The two output inodes must match each other and differ from `initial-netns.before`. Abort if either check fails. Start `slirp4netns --configure --disable-host-loopback --netns-type=path /run/netns/sabalanerp-qa tap0` under a QA-only systemd unit whose `ExecStart` is that exact command, `Restart=no`, and whose `ExecStop`/lifecycle cannot recreate the namespace. Record the reviewed unit bytes before starting. Do not use `--api-socket` or add a hostfwd. Require `tap0` at `10.0.2.100/24`, default route via `10.0.2.2`, and a running slirp PID; stop otherwise. Create `/etc/netns/sabalanerp-qa/resolv.conf` as a root-owned regular file containing only `nameserver 10.0.2.3`; `ip netns exec` supplies this mount view without changing the initial resolver. Confirm `ip netns exec sabalanerp-qa cat /etc/resolv.conf` reads exactly that value. Stop if the initial resolver or initial route/link/rules changed.

The QA-only slirp unit has this complete content (replace `/usr/bin/slirp4netns` only if the reviewed package installs a different measured path):

```ini
[Unit]
Description=Sabalan QA private slirp uplink
ConditionPathExists=/run/netns/sabalanerp-qa

[Service]
Type=simple
ExecStart=/usr/bin/slirp4netns --configure --disable-host-loopback --netns-type=path /run/netns/sabalanerp-qa tap0
Restart=no
```

Install it as `/etc/systemd/system/sabalanerp-qa-slirp.service`, mode 0644, run `systemctl daemon-reload`, and `systemctl start sabalanerp-qa-slirp.service` only after confirming the namespace inode again. Leave it disabled. `systemctl is-active` and the TAP address/route checks must all pass.

## 2. Restart the native QA Engine inside the namespace

Only after step 1 passes and the QA distro's ordinary `docker.service` and `docker.socket` are masked, install a reviewed QA-only systemd unit with `Requires=`/`After=` on the slirp unit and `ExecStart=/usr/sbin/ip netns exec sabalanerp-qa /usr/bin/dockerd --host=unix:///run/docker.sock --data-root=/var/lib/docker --exec-root=/run/docker --pidfile=/run/docker.pid --bridge=none --iptables=true`. Use the measured `dockerd` binary path and ensure the pinned `/etc/docker/daemon.json` contains no conflicting flags, TCP listener, registry mirror, or Desktop endpoint. This unit must not start automatically until namespace and slirp identity are checked; keep it disabled after this one probe. Start it once and record the unit, PID, birth ticks and command line. Require the daemon's `/proc/<pid>/ns/net`, `stat -Lc 'net:[%i]' /run/netns/sabalanerp-qa` and controller shell namespace to match, while `/proc/1/ns/net` stays at the initial inode. Require `docker -H unix:///run/docker.sock info` to show the previously pinned native Engine ID and `/var/lib/docker` root, and no QA containers or images imported by this procedure. Any mismatch stops before the bridge probe. Repeat the protected controller's PID/config/FD9/pidfd host-owner checks before later rehearsal; this network probe alone cannot satisfy them.

The QA-only daemon unit has this complete content, subject only to replacing the two binary paths with reviewed measured paths:

```ini
[Unit]
Description=Sabalan QA Docker Engine in private network namespace
Requires=sabalanerp-qa-slirp.service
After=sabalanerp-qa-slirp.service
ConditionPathExists=/run/netns/sabalanerp-qa

[Service]
Type=notify
ExecStart=/usr/sbin/ip netns exec sabalanerp-qa /usr/bin/dockerd --host=unix:///run/docker.sock --data-root=/var/lib/docker --exec-root=/run/docker --pidfile=/run/docker.pid --bridge=none --iptables=true
Restart=no
TimeoutStartSec=60
```

After confirming the ordinary daemon/socket remain inactive and masked, install this file as `/etc/systemd/system/sabalanerp-qa-docker.service`, mode 0644; run `systemctl daemon-reload`; recheck the namespace and slirp PID; then `systemctl start sabalanerp-qa-docker.service`. If any ordinary daemon process or socket survives masking, stop before starting this unit. Leave it disabled. Do not change Docker Desktop's context, settings, or services.

## 3. Temporary private-bridge probe, with no image

Run every command below through `ip netns exec sabalanerp-qa`, using `docker -H unix:///run/docker.sock` only. First verify `172.29.239.0/24` does not overlap any current QA route, Docker subnet, backup route or slirp subnet. Create a Docker bridge network `qa439-probe` with `--driver bridge --subnet 172.29.239.0/24 --gateway 172.29.239.1 -o com.docker.network.bridge.name=br-qa439`. It is a temporary network, **not** a Compose service or image. Its bridge and Docker NAT/filter rules must appear only in `sabalanerp-qa`.

Create a second ephemeral named namespace `sabalanerp-qa-probe` with `ip netns add` **from the QA distro's initial mount namespace**. `ip netns exec` creates a temporary mount namespace, so a named namespace added inside it would disappear from the operator's view. Creating the empty probe name in the initial mount namespace adds no route, link, bridge or rule to the initial network namespace. Verify its distinct inode and empty interface/route census immediately. In the QA network namespace, create `veth-qa439`/`vpeer-qa439`, attach the first end to `br-qa439`, move the peer to the persistent `sabalanerp-qa-probe` name, set it to `172.29.239.10/24`, bring up its loopback and peer, and route default via `172.29.239.1`. Add a root-only `/etc/netns/sabalanerp-qa-probe/resolv.conf` with `nameserver 10.0.2.3`. Confirm the probe's sole non-loopback interface is that peer and its sole default route is the Docker bridge. If Docker's bridge policy blocks this manually attached probe, record failure and stop; do not weaken Docker's rules.

The concrete creation sequence, after the overlap check, is:

```sh
ip netns exec sabalanerp-qa docker -H unix:///run/docker.sock network create \
  --driver bridge --subnet 172.29.239.0/24 --gateway 172.29.239.1 \
  -o com.docker.network.bridge.name=br-qa439 qa439-probe
ip netns add sabalanerp-qa-probe
stat -Lc 'net:[%i]' /run/netns/sabalanerp-qa-probe
ip netns exec sabalanerp-qa-probe ip -d -o link show
ip netns exec sabalanerp-qa-probe ip -4 route show table all
ip netns exec sabalanerp-qa ip link add veth-qa439 type veth peer name vpeer-qa439
ip netns exec sabalanerp-qa ip link set veth-qa439 master br-qa439
ip netns exec sabalanerp-qa ip link set veth-qa439 up
ip netns exec sabalanerp-qa ip link set vpeer-qa439 netns sabalanerp-qa-probe
ip netns exec sabalanerp-qa-probe ip link set lo up
ip netns exec sabalanerp-qa-probe ip addr add 172.29.239.10/24 dev vpeer-qa439
ip netns exec sabalanerp-qa-probe ip link set vpeer-qa439 up
ip netns exec sabalanerp-qa-probe ip route add default via 172.29.239.1
install -d -m 0700 /etc/netns/sabalanerp-qa-probe
printf 'nameserver 10.0.2.3\n' > /etc/netns/sabalanerp-qa-probe/resolv.conf
chmod 0600 /etc/netns/sabalanerp-qa-probe/resolv.conf
ip netns exec sabalanerp-qa-probe ip -4 route show table all
ip netns exec sabalanerp-qa-probe ip -d -o link show
```

Run each line separately with `set -e` semantics: stop at the first failure and inspect exact ownership before cleanup. Do not paste the whole block blindly. The persistent probe name must remain visible from the initial mount namespace, but all veth and route setup must occur through the QA or probe network namespace. The bridge and network names are reserved for this one probe and must not pre-exist.

From `ip netns exec sabalanerp-qa-probe`, with proxy environment variables cleared and a 10-second deadline per command, prove:

1. `dig +time=3 +tries=1 TXT <reviewed live publisher name>` returns an authoritative, nonempty TXT answer through `10.0.2.3`. Record the domain and answer digest, not application secrets. `curl --noproxy '*' --proto '=https' --tlsv1.2 --max-time 10 --fail --silent --show-error https://<reviewed ClamAV source>/` completes certificate and hostname verification. A proxy, hosts-file substitution or disabled TLS verification fails the gate.
2. A temporary `python3 -m http.server 19394 --bind 127.0.0.1` listener in the **initial** QA distro namespace is reachable there. A bounded TCP attempt from both QA and probe namespaces to `10.0.2.2:19394` must fail. Confirm the listener remains reachable in the initial namespace after the negative attempts. Stop the listener in `finally`/operator cleanup. This proves `--disable-host-loopback` against an actually listening port, not a closed port.
3. The independent QA backup hostname resolves to the reviewed off-computer address and SSH host key matches the private QA known-hosts file. `sftp` in batch mode performs a read-only `pwd` against that endpoint using its QA-only key, strict host-key checking and a bounded timeout. A production backup hostname, production key, write, upload, directory creation or checkpoint transfer is forbidden.
4. A QA-only listener bound to `127.0.0.1:19395` **inside** `sabalanerp-qa` is reachable from that namespace but not from the initial namespace, probe peer address, WSL host address or Desktop. `ss -lnt` in both namespaces must show no wildcard listener for the QA port. This is the loopback ingress test; no host-side forwarding is added.

For the DNS/HTTPS step, run `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy ip netns exec sabalanerp-qa-probe` before each `dig`/`curl`, and save the actual exit status. For the backup step, run `printf 'pwd\n' | timeout 10 ip netns exec sabalanerp-qa-probe sftp -b - -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<QA root-only known-hosts path> -o ConnectTimeout=5 -i <QA-only key> <QA-only user>@<reviewed backup host>`. The placeholders are reviewed private inputs, never inferred from production files. For each HTTP listener use `python3 -m http.server <port> --bind 127.0.0.1` in a separate terminal, record its PID, and stop exactly that PID after the test. Use `curl --noproxy '*' --max-time 3` for positive requests and `timeout 3 bash -c 'exec 3<>/dev/tcp/<numeric address>/<port>'` for negative TCP attempts; prove each negative result is a refusal or timeout and each positive control still works. Do not infer isolation from a closed port.

Record each command, status, namespace inode and bounded output. A failed or ambiguous network test is NO-GO, including DNS through a loopback host resolver. Tear down the probe namespace, veth and `qa439-probe` network only after recording their exact identities; do not use `docker system prune`, `docker network prune`, or a broad namespace cleanup. Confirm no probe bridge/interface/rules remain in QA. Leave the named QA namespace and its stopped daemon/slirp units for reviewed follow-up, or reverse only the exact newly created QA objects after review. Do not remove an unknown pre-existing object.

## 4. After evidence and admission

Repeat the six initial-namespace read-only captures from step 0 into the same filenames with `.after`; recapture Desktop namespace, Engine ID and both service censuses through the **same Desktop context**. Save `stat -Lc 'net:[%i]' /run/netns/sabalanerp-qa` as `qa-netns.after` and the native daemon's `/proc/<pid>/ns/net` readlink as `qa-daemon-netns.after`. Run `node deploy/scripts/verify-qa-netns-evidence.mjs "$E"` on the evidence directory. It rejects missing/empty files, changed shared snapshots, a QA daemon in the initial namespace, and a daemon outside the named QA namespace. This comparison is a necessary check, not independent proof of capture provenance. The reviewer must also compare the #436 checkpoint identities, package/unit hashes, commands and all probe results. If the daemon was stopped during cleanup, capture its namespace evidence **before** stopping and attest its PID/birth and stop time.

Any initial/desktop difference, backup failure, public or initial ingress, DNS/HTTPS failure, or missing cleanup leaves #439 and #432 **NO-GO**. No production access, image import, QA Compose service, data restore, key copy or controller invocation follows automatically from this probe.

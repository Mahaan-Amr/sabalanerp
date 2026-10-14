#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
# Run on the independent host with a reviewed, root-owned operations bundle.
[ "$(id -u)" -eq 0 ] && [ "$#" -eq 2 ] || exit 64
for tool in node docker flock ssh-keygen sshd sudo visudo useradd getent install; do
  command -v "$tool" >/dev/null 2>&1 || { echo 'BACKUP_HOST_REQUIRED_COMMAND_MISSING' >&2; exit 1; }
done
bundle="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
[ "$bundle" = /opt/sabalanerp-recovery ] || { echo 'BACKUP_BUNDLE_LOCATION_INVALID' >&2; exit 1; }
[ "$(stat -c %u "$bundle")" -eq 0 ] || exit 1
node -e 'if(Number(process.versions.node.split(".")[0])<18||typeof require("node:fs").promises.statfs!=="function")process.exit(1)'
if find "$bundle" -xdev \( -type l -o ! -user root -o -perm /022 \) -print | grep -q .; then
  echo 'BACKUP_BUNDLE_OWNERSHIP_INVALID' >&2
  exit 1
fi
read_key() {
  ssh-keygen -l -f "$1" >/dev/null
  [ "$(awk 'NF {n++} END {print n+0}' "$1")" -eq 1 ] || exit 1
  awk '$1 == "ssh-ed25519" && $2 ~ /^[A-Za-z0-9+\/=]+$/ {print $1 " " $2}' "$1"
}
transfer_key="$(read_key "$1")"
operations_key="$(read_key "$2")"
[ -n "$transfer_key" ] && [ -n "$operations_key" ] && [ "$transfer_key" != "$operations_key" ] || exit 1
for account in sabalan-backup sabalan-backup-ops; do
  if ! getent passwd "$account" >/dev/null; then
    useradd --system --user-group --create-home --home-dir "/var/lib/$account" --shell /bin/sh "$account"
  fi
  [ "$(getent passwd "$account" | cut -d: -f6)" = "/var/lib/$account" ] || exit 1
  [ "$(id -u "$account")" -gt 0 ] && [ "$(id -gn "$account")" = "$account" ] || exit 1
  [ "$(id -Gn "$account")" = "$account" ] || { echo 'BACKUP_ACCOUNT_PRIVILEGE_INVALID' >&2; exit 1; }
done
install -d -o root -g root -m 0755 /srv/sabalanerp-recovery /etc/ssh/authorized_keys
install -d -o sabalan-backup -g sabalan-backup -m 0700 /srv/sabalanerp-recovery/checkpoints
install -d -o root -g root -m 0700 /var/log/sabalanerp-backup
install -o root -g root -m 0755 "$bundle/deploy/scripts/backup-preflight-client.sh" /usr/local/bin/sabalan-backup-preflight-client
install -o root -g root -m 0755 "$bundle/deploy/scripts/backup-preflight-root.sh" /usr/local/sbin/sabalan-backup-preflight
printf 'restrict %s\n' "$transfer_key" > /etc/ssh/authorized_keys/sabalan-backup
printf 'restrict %s\n' "$operations_key" > /etc/ssh/authorized_keys/sabalan-backup-ops
chmod 0644 /etc/ssh/authorized_keys/sabalan-backup /etc/ssh/authorized_keys/sabalan-backup-ops
printf 'sabalan-backup-ops ALL=(root) NOPASSWD: /usr/local/sbin/sabalan-backup-preflight\n' > /etc/sudoers.d/sabalan-backup-preflight
chmod 0440 /etc/sudoers.d/sabalan-backup-preflight
visudo -cf /etc/sudoers.d/sabalan-backup-preflight >/dev/null
configuration=/etc/ssh/sshd_config.d/90-sabalan-backup.conf
previous="$(mktemp)"
had_previous=0
if [ -f "$configuration" ]; then cp "$configuration" "$previous"; had_previous=1; fi
cat > "$configuration" <<'CONFIG'
Match User sabalan-backup
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    ChrootDirectory /srv/sabalanerp-recovery
    ForceCommand internal-sftp -d /checkpoints
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    PermitTTY no
Match User sabalan-backup-ops
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    ForceCommand /usr/local/bin/sabalan-backup-preflight-client
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    PermitTTY no
Match all
CONFIG
if ! sshd -t; then
  if [ "$had_previous" -eq 1 ]; then cp "$previous" "$configuration"; else rm "$configuration"; fi
  rm "$previous"
  exit 1
fi
rm "$previous"
systemctl reload ssh
echo 'Backup transfer and operations accounts provisioned; independent authentication and forced-command tests are still required.'

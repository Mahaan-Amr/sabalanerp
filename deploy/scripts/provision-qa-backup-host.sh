#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
# Run only on the reviewed backup host, from its separate root-owned QA bundle.
[ "$(id -u)" -eq 0 ] && [ "$#" -eq 2 ] || exit 64
for tool in node docker flock ssh-keygen sshd sudo visudo useradd getent install; do
  command -v "$tool" >/dev/null 2>&1 || { echo 'QA_BACKUP_HOST_REQUIRED_COMMAND_MISSING' >&2; exit 1; }
done
bundle="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
[ "$bundle" = /opt/sabalanerp-qa-recovery ] || { echo 'QA_BACKUP_BUNDLE_LOCATION_INVALID' >&2; exit 1; }
[ "$(stat -c %u "$bundle")" -eq 0 ] || exit 1
node -e 'if(Number(process.versions.node.split(".")[0])<18||typeof require("node:fs").promises.statfs!=="function")process.exit(1)'
if find "$bundle" -xdev \( -type l -o ! -user root -o -perm /022 \) -print | grep -q .; then
  echo 'QA_BACKUP_BUNDLE_OWNERSHIP_INVALID' >&2
  exit 1
fi
for source in \
  "$bundle/deploy/scripts/storage-preflight.mjs" \
  "$bundle/deploy/scripts/backup-checkpoint-retention.cjs" \
  "$bundle/deploy/scripts/qa-backup-preflight-client.sh" \
  "$bundle/deploy/scripts/qa-backup-preflight-root.sh" \
  "$bundle/deploy/scripts/qa-backup-retention-root.sh"; do
  [ -f "$source" ] && [ ! -L "$source" ] || { echo 'QA_BACKUP_OWNER_MISSING' >&2; exit 1; }
done
read_key() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u "$1")" -eq 0 ] && \
    [ "$(stat -c %h "$1")" -eq 1 ] && \
    [ -z "$(find "$1" -prune -perm /022 -print)" ] || exit 1
  ssh-keygen -l -f "$1" >/dev/null
  [ "$(awk 'NF {n++} END {print n+0}' "$1")" -eq 1 ] || exit 1
  awk '$1 == "ssh-ed25519" && $2 ~ /^[A-Za-z0-9+\/=]+$/ {print $1 " " $2}' "$1"
}
transfer_key="$(read_key "$1")"
operations_key="$(read_key "$2")"
[ -n "$transfer_key" ] && [ -n "$operations_key" ] && [ "$transfer_key" != "$operations_key" ] || exit 1
# Never reuse an existing SSH identity from another backup account.
for existing in /etc/ssh/authorized_keys/*; do
  case "$existing" in
    /etc/ssh/authorized_keys/sabalan-qa-backup|/etc/ssh/authorized_keys/sabalan-qa-backup-ops) continue ;;
  esac
  [ -f "$existing" ] || continue
  if grep -Fq "$transfer_key" "$existing" || grep -Fq "$operations_key" "$existing"; then
    echo 'QA_BACKUP_KEY_REUSED' >&2
    exit 1
  fi
done
for account in sabalan-qa-backup sabalan-qa-backup-ops; do
  if ! getent passwd "$account" >/dev/null; then
    useradd --system --user-group --create-home --home-dir "/var/lib/$account" --shell /bin/sh "$account"
  fi
  [ "$(getent passwd "$account" | cut -d: -f6)" = "/var/lib/$account" ] || exit 1
  [ "$(id -u "$account")" -gt 0 ] && [ "$(id -gn "$account")" = "$account" ] || exit 1
  [ "$(id -Gn "$account")" = "$account" ] || { echo 'QA_BACKUP_ACCOUNT_PRIVILEGE_INVALID' >&2; exit 1; }
done
[ ! -L /srv/sabalanerp-qa-recovery ] && [ ! -L /srv/sabalanerp-qa-recovery/checkpoints ] || exit 1
[ ! -L /etc/ssh/authorized_keys ] && [ ! -L /etc/ssh/sshd_config.d ] || exit 1
for target in \
  /etc/ssh/authorized_keys/sabalan-qa-backup \
  /etc/ssh/authorized_keys/sabalan-qa-backup-ops \
  /etc/sudoers.d/sabalan-qa-backup-preflight \
  /etc/ssh/sshd_config.d/91-sabalan-qa-backup.conf; do
  [ ! -L "$target" ] || exit 1
  if [ -e "$target" ]; then
    [ -f "$target" ] && [ "$(stat -c %u "$target")" -eq 0 ] && \
      [ "$(stat -c %h "$target")" -eq 1 ] || exit 1
  fi
done
install -d -o root -g root -m 0755 /srv/sabalanerp-qa-recovery
install -d -o sabalan-qa-backup -g sabalan-qa-backup -m 0700 /srv/sabalanerp-qa-recovery/checkpoints
install -d -o root -g root -m 0700 /var/log/sabalanerp-qa-backup
if [ ! -d /etc/ssh/authorized_keys ]; then
  install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
fi
[ "$(stat -c %u /etc/ssh/authorized_keys)" -eq 0 ] && \
  [ -z "$(find /etc/ssh/authorized_keys -maxdepth 0 -perm /022 -print)" ] || exit 1
install -o root -g root -m 0755 "$bundle/deploy/scripts/qa-backup-preflight-client.sh" /usr/local/bin/sabalan-qa-backup-preflight-client
install -o root -g root -m 0755 "$bundle/deploy/scripts/qa-backup-preflight-root.sh" /usr/local/sbin/sabalan-qa-backup-preflight
install -o root -g root -m 0755 "$bundle/deploy/scripts/qa-backup-retention-root.sh" /usr/local/sbin/sabalan-qa-backup-retention
printf 'restrict %s\n' "$transfer_key" > /etc/ssh/authorized_keys/sabalan-qa-backup
printf 'restrict %s\n' "$operations_key" > /etc/ssh/authorized_keys/sabalan-qa-backup-ops
chmod 0644 /etc/ssh/authorized_keys/sabalan-qa-backup /etc/ssh/authorized_keys/sabalan-qa-backup-ops
printf 'sabalan-qa-backup-ops ALL=(root) NOPASSWD: /usr/local/sbin/sabalan-qa-backup-preflight, /usr/local/sbin/sabalan-qa-backup-retention\n' > /etc/sudoers.d/sabalan-qa-backup-preflight
chmod 0440 /etc/sudoers.d/sabalan-qa-backup-preflight
visudo -cf /etc/sudoers.d/sabalan-qa-backup-preflight >/dev/null
configuration=/etc/ssh/sshd_config.d/91-sabalan-qa-backup.conf
previous="$(mktemp)"
had_previous=0
if [ -f "$configuration" ]; then cp "$configuration" "$previous"; had_previous=1; fi
cat > "$configuration" <<'CONFIG'
Match User sabalan-qa-backup
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    ChrootDirectory /srv/sabalanerp-qa-recovery
    ForceCommand internal-sftp -d /checkpoints
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    PermitTTY no
Match User sabalan-qa-backup-ops
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    ForceCommand /usr/local/bin/sabalan-qa-backup-preflight-client
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
echo 'QA backup transfer and operations accounts provisioned; independent authentication and forced-command tests are still required.'

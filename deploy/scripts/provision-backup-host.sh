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
# Fixed public verification authority only. Existing mismatched trust is never overwritten.
node - "$bundle" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const wanted='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48';
const source=path.join(process.argv[2],'deploy/trust/online-qualification-public-key.pem'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(file,mode)=>{if(fs.realpathSync(file)!==file)throw Error('BACKUP_TRUST_ALIAS');const stat=fs.lstatSync(file);if(!stat.isFile()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o022)!==0||(mode!==undefined&&(stat.mode&0o777)!==mode))throw Error('BACKUP_TRUST_CUSTODY');const raw=fs.readFileSync(file);if(sha(raw)!==wanted)throw Error('BACKUP_TRUST_HASH');return raw;};
const raw=check(source);for(const dir of ['/etc/sabalan','/etc/sabalan/online']){if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o022)!==0||fs.realpathSync(dir)!==dir)throw Error('BACKUP_TRUST_DIRECTORY');}
const file='/etc/sabalan/online/qualification-public-key.pem';if(fs.existsSync(file))check(file,0o444);else{const fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fchmodSync(fd,0o444);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}check(file,0o444);}
NODE
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
install -o root -g root -m 0755 "$bundle/deploy/scripts/backup-retention-root.sh" /usr/local/sbin/sabalan-backup-retention
printf 'restrict %s\n' "$transfer_key" > /etc/ssh/authorized_keys/sabalan-backup
printf 'restrict %s\n' "$operations_key" > /etc/ssh/authorized_keys/sabalan-backup-ops
chmod 0644 /etc/ssh/authorized_keys/sabalan-backup /etc/ssh/authorized_keys/sabalan-backup-ops
printf 'sabalan-backup-ops ALL=(root) NOPASSWD: /usr/local/sbin/sabalan-backup-preflight, /usr/local/sbin/sabalan-backup-retention\n' > /etc/sudoers.d/sabalan-backup-preflight
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

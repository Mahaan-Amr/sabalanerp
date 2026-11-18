#!/bin/sh
set -eu
root=/opt/recovery-postgres-root
bindir=$(pg_config --bindir)
librarydir=$(pg_config --pkglibdir)
sharedir=$(pg_config --sharedir)
test "$bindir" = /usr/local/bin
mkdir -p "$root$bindir" "$root$(dirname "$librarydir")" "$root$(dirname "$sharedir")" "$root/etc" "$root/run" "$root/data" "$root/tmp"
cp "$bindir/postgres" "$root$bindir/"
cp -a "$librarydir" "$root$(dirname "$librarydir")/"
cp -a "$sharedir" "$root$(dirname "$sharedir")/"
for optional in /usr/share/zoneinfo /usr/share/locale /usr/lib/locale; do
  if [ -d "$optional" ]; then mkdir -p "$root$(dirname "$optional")"; cp -a "$optional" "$root$(dirname "$optional")/"; fi
done
for binary in "$bindir/postgres" "$librarydir"/*.so; do
  ldd "$binary" | awk '/=> \/|^[[:space:]]*\// { for (i = 1; i <= NF; i++) if ($i ~ /^\//) print $i }'
done | sort -u | while IFS= read -r library; do
  mkdir -p "$root$(dirname "$library")"
  cp -L "$library" "$root$library"
done
printf 'postgres:x:65532:65532:Recovery PostgreSQL:/data:/nonexistent\n' > "$root/etc/passwd"
printf 'postgres:x:65532:\n' > "$root/etc/group"
chown postgres:postgres "$root/data"
su-exec postgres "$bindir/initdb" -D "$root/data" --username=recovery_owner \
  --auth-local=trust --auth-host=reject --encoding=UTF8
printf '{"imageId":"%s"}\n' "$RECOVERY_POSTGRES_IMAGE_ID" > "$root/identity.json"
chown -R root:root "$root"
chmod 0755 "$root" "$root/run" "$root/tmp"
# A shell, procfs, devices, host sockets and production files never enter the template.
test ! -e "$root/bin/sh"
test ! -e "$root/proc"
test ! -e "$root/etc/shadow"

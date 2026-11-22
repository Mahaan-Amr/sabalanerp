#!/bin/sh
set -eu
umask 077
data=/var/lib/postgresql/data
[ -z "$(ls -A "$data")" ]
tar -xf /restore-input.tar -C "$data"
pg_verifybackup "$data"
if [ -f "$data/postgresql.auto.conf" ]; then mv "$data/postgresql.auto.conf" "$data/source-postgresql.auto.conf.retained"; fi
: > "$data/postgresql.auto.conf"
for signal in standby.signal recovery.signal; do
  if [ -f "$data/$signal" ]; then mv "$data/$signal" "$data/source-$signal.retained"; fi
done
# Foreground PostgreSQL remains an actual descendant of the inner native owner.
# The host controller later requests ordinary pg_ctl fast shutdown and verifies
# both daemon exit and inner/outer native completion before releasing ownership.
exec postgres -D "$data" \
  -c config_file=/restore.conf -c hba_file=/restore.hba -c ident_file=/restore.ident \
  -c listen_addresses='' -c unix_socket_directories=/qa-pg-socket -c unix_socket_permissions=0770 \
  -c archive_mode=off -c archive_command='' -c restore_command='' -c recovery_end_command='' \
  -c archive_cleanup_command='' -c primary_conninfo='' -c primary_slot_name='' \
  -c shared_preload_libraries='' -c local_preload_libraries='' -c session_preload_libraries='' \
  -c ssl=off -c external_pid_file='' -c logging_collector=off -c autovacuum=off \
  -c shared_buffers=32MB -c max_connections=100 -c max_worker_processes=8 \
  -c max_wal_senders=10 -c max_prepared_transactions=0 -c max_locks_per_transaction=64 \
  -c wal_level=replica -c fsync=on -c max_wal_size=64MB -c min_wal_size=32MB \
  -c statement_timeout=10000 -c lock_timeout=250

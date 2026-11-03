#!/bin/sh
set -eu
umask 077
# Check the actual mounts before creating any lock or output.
[ ! -L /inputs ] && [ ! -L /work/.deploy-state ] || exit 64
[ "$(realpath /inputs)" = /inputs ] && [ "$(realpath /work/.deploy-state)" = /work/.deploy-state ] || exit 64
[ "$(stat -c '%d:%i %u:%g %a %F' /inputs)" = "${TEST_INPUT_ID} 0:0 700 directory" ] || exit 64
[ "$(stat -c '%d:%i %u:%g %a %F' /work/.deploy-state)" = "${TEST_OUTPUT_ID} 0:0 700 directory" ] || exit 64
[ "$(id -u)" = 0 ] || exit 64
[ "$(realpath /work/.deploy-state)" = /work/.deploy-state ] || exit 64
[ ! -e /work/.deploy-state/deployment.lock ] && [ ! -L /work/.deploy-state/deployment.lock ] || exit 64
( set -C; : > /work/.deploy-state/deployment.lock )
chmod 0600 /work/.deploy-state/deployment.lock
exec 9>>/work/.deploy-state/deployment.lock
flock -n 9 || exit 75
exec node /inputs/producer-driver.mjs /inputs/test-host-input.json

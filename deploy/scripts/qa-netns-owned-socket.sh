# Sourced by the #439 launcher. Capture only a socket observed while the
# recorded daemon PID is alive; cleanup never adopts a previously found socket.
qa_owned_socket_capture() {
  local socket=$1 expected_gid=$2 metadata
  [[ -S $socket && ! -L $socket ]] || return 1
  metadata=$(stat -c '%F:%u:%g:%a:%h:%d:%i' -- "$socket") || return 1
  [[ $metadata == socket:0:$expected_gid:660:1:* ]] || return 1
  QA_OWNED_SOCKET_IDENTITY=$metadata
}

qa_owned_socket_cleanup() {
  local socket=$1 expected_identity=$2 listeners
  [[ -n $expected_identity ]] || return 1
  [[ -e $socket || -L $socket ]] || return 0 # dockerd already unlinked it
  [[ -S $socket && ! -L $socket ]] || return 1
  [[ $(stat -c '%F:%u:%g:%a:%h:%d:%i' -- "$socket") == "$expected_identity" ]] || return 1
  # The initial and QA views must both have no listener. Do not infer this
  # from connection refusal alone; a stale pathname has no kernel listener.
  listeners=$(ss -H -xl) || return 1
  grep -F -- "$socket" <<< "$listeners" >/dev/null && return 1
  if [[ -e /run/netns/sabalanerp-qa ]]; then
    listeners=$(ip netns exec sabalanerp-qa ss -H -xl) || return 1
    grep -F -- "$socket" <<< "$listeners" >/dev/null && return 1
  fi
  rm -- "$socket"
}

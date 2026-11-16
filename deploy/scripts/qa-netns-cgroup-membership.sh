# Sourced by the #439 launcher and its child. Bash mapfile reads
# /proc/self/cgroup in this shell; external cmp/cat would read their own.
qa_cgroup_capture_membership() {
  local source=$1 destination=$2
  local -a lines=()
  mapfile -t lines < "$source" || return 1
  [[ ${#lines[@]} == 1 && ${lines[0]} == 0::/* ]] || return 1
  printf '%s\n' "${lines[0]}" > "$destination"
}

qa_cgroup_membership_matches() {
  local source=$1 baseline=$2 evidence=$3 actual_hash expected_hash
  local -a actual=() expected=()
  mapfile -t actual < "$source" || return 1
  mapfile -t expected < "$baseline" || return 1
  actual_hash=$(printf '%s\n' "${actual[@]}" | sha256sum | cut -d' ' -f1) || return 1
  expected_hash=$(printf '%s\n' "${expected[@]}" | sha256sum | cut -d' ' -f1) || return 1
  {
    printf 'actual_sha256=%s expected_sha256=%s\n' "$actual_hash" "$expected_hash"
    printf 'actual_lines=%s expected_lines=%s\n' "${#actual[@]}" "${#expected[@]}"
    printf 'match=%s\n' "$([[ ${#actual[@]} == 1 && ${#expected[@]} == 1 && ${actual[0]} == 0::/* && ${actual[0]} == "${expected[0]}" ]] && printf yes || printf no)"
  } > "$evidence"
  [[ ${#actual[@]} == 1 && ${#expected[@]} == 1 && ${actual[0]} == 0::/* && ${actual[0]} == "${expected[0]}" ]]
}

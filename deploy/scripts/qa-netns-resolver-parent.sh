# Sourced by the #439 launcher. The caller sets a fixed /etc/netns path.
qa_resolver_parent_prepare() {
  local dir=$1 mode
  QA_RESOLVER_PARENT_OWNED=0
  QA_RESOLVER_PARENT_IDENTITY=
  if [[ -e $dir || -L $dir ]]; then
    [[ -d $dir && ! -L $dir && $(stat -c '%u' -- "$dir") == 0 ]] || return 1
    mode=$(stat -c '%a' -- "$dir") || return 1
    (( (8#$mode & 8#022) == 0 )) || return 1
    return 0
  fi
  mkdir -m 0700 -- "$dir" || return 1
  QA_RESOLVER_PARENT_IDENTITY=$(stat -c '%d:%i' -- "$dir") || return 1
  QA_RESOLVER_PARENT_OWNED=1
}

qa_resolver_parent_cleanup() {
  local dir=$1
  [[ ${QA_RESOLVER_PARENT_OWNED:-0} == 1 ]] || return 0
  [[ -d $dir && ! -L $dir && $(stat -c '%d:%i' -- "$dir") == "$QA_RESOLVER_PARENT_IDENTITY" ]] || return 1
  rmdir -- "$dir" # Only this run's original, now-empty parent may be removed.
}

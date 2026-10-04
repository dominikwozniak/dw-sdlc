#!/bin/bash
# Refuses the commands that destroy work the reflog cannot bring back: git rewriting history or the
# working tree, `rm` aimed at the root, the home or the current directory — bare, as `/*`, `~/*`, `./*`
# or a bare `*` — `find -delete`, `shred`.
# Two parts. The regex arms match a command boundary — line start, or right after ; & | — through
# the wrappers lib.sh knows (`sudo`, `rtk …`, `VAR=x`), so prose inside quotes never matches. Two verbs
# are parsed word by word instead, because their policy is not a pattern. Every `git push`: a bare
# `--force`, `-f` or `+refspec` and a `--mirror` are always refused; `--force-with-lease` and
# `--force-if-includes` pass to a branch outside `guardrails.protectedBranches` — with `--all`, every
# local branch counts — and nothing passes when `guardrails.forcePush` is `deny`; a plain push to a
# protected branch is refused too, because those branches take pull requests. Both
# read the config of the repository the payload's cwd is in. Every `git restore` of the whole tree:
# `--staged` alone is the one form that touches nothing the index cannot give back.
#
# Guardrail against agent accidents, not a security boundary. Runs always-on from bash-guard.sh, or
# alone on the JSON payload; `--bash-command <cwd>` is the dispatcher's fast path.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0

# A `.` argument meaning "the whole working tree", quoted or bare, with or without a trailing slash,
# and ending on the closing quote whose opener the boundary absorbed. End-anchored on purpose: a bare
# `\.` also matched the leading dot of `.ai/` or `.claude/`, so restoring one tracked file there read
# as wiping the tree. A closing parenthesis ends it too, so a subshell form is the same command.
DOT_ARG="[\"']?\./?[\"']?[[:space:]]*[\"']?[[:space:]]*(\$|[;&|)])"
END='([^A-Za-z0-9_-]|$)'
# An rm target inside quotes: `/` and `.` mean the same quoted or not, so either quote may wrap them.
# The home directory is `~` only bare — quoted, the shell passes a literal `~` — and `$HOME` bare or
# in double quotes; single quotes keep it literal.
Q="[\"']?"

PATTERNS=(
  "$GUARD_GIT"' push( [^;&|]*)?( --delete'"$END"'| :[^[:space:]])'        # remote branch deletion, either spelling
  "$GUARD_GIT"' reset( [^;&|]*)? --hard'                                  # discards index and working tree
  "$GUARD_GIT"' clean( +-[A-Za-z-]+)* +(-[A-Za-z]*[dfxX]|--force)'        # deletes untracked files, any flag order
  "$GUARD_GIT"' branch( [^;&|]*)?( -f'"$END"'| --force'"$END"')'          # force-repoints a branch; -D stays allowed
  "$GUARD_GIT"' checkout( [^;&|]*)? (-- +)?'"$DOT_ARG"                    # discards every working-tree change, from HEAD or any tree-ish
  "$GUARD_GIT"' checkout( [^;&|]*)?( -f'"$END"'| --force'"$END"')'        # switches over local changes and discards them
  "$GUARD_GIT"' switch( [^;&|]*)?( -f'"$END"'| --force'"$END"'| --discard-changes'"$END"')' # the same, spelled switch
  "$GUARD_GIT"' stash clear'"$END"                                        # wipes every stash, unrecoverable
  "rm( [^;&|]*)? ${Q}/\\*?${Q} *(\$|[;&|)])"                              # rm aimed at / or /*
  "rm( [^;&|]*)? (~(/\\*?)?|\"?(\\\$HOME|\\\$\\{HOME\\})\"?(/\\*?)?\"?) *(\$|[;&|)])" # rm aimed at the home directory: ~, ~/ or ~/*
  "rm( [^;&|]*)? ${Q}\\.\\.?${Q}(/\\*?)?${Q} *(\$|[;&|)])"                # rm aimed at . or .., bare, with / or with /*
  "rm( [^;&|]*)? ${Q}\\*${Q}( [^;&|]*)? *(\$|[;&|)])"                     # rm with a bare * argument: every entry of the cwd
  'find( [^;&|]*)? -delete([[:space:])]|$)'                               # bulk delete via find
  'shred'"$END"                                                           # irrecoverable file destruction
)

# Matched against the masked scan, reported as the command: the user has to see what they typed.
SCAN=$(guard_mask_quoted_separators "$GUARD_COMMAND")
for pattern in "${PATTERNS[@]}"; do
  if printf '%s\n' "$SCAN" | grep -qE "${GUARD_BOUNDARY}${pattern}"; then
    guard_block "'$GUARD_COMMAND' matches the dangerous pattern '$pattern'."
  fi
done

# --- the parsed verbs: push and restore -----------------------------------------------------------

# check_push <segment> — one command segment that starts, after the wrappers, with `git … push`.
check_push() {
  guard_parse_push "$1" || return 0
  ((GUARD_PUSH_DELETE)) && guard_block "'$GUARD_COMMAND' deletes a remote branch."
  ((GUARD_PUSH_MIRROR)) && guard_block "'$GUARD_COMMAND' is a mirror push: it force-updates and deletes every remote ref until the remote matches this repository."
  ((GUARD_PUSH_BARE)) && guard_block "'$GUARD_COMMAND' force-pushes without a lease. Use --force-with-lease (and --force-if-includes) so the push only replaces what you last fetched."

  local targets target
  if ((GUARD_PUSH_LEASE)); then
    guard_config_load "$GUARD_CWD" || return 0
    [[ "$(guard_config_get '.guardrails.forcePush')" == "deny" ]] &&
      guard_block "'$GUARD_COMMAND' is a force push, and this repository refuses every force push (guardrails.forcePush: deny)."
    # The target branches: the destination side of each refspec, or the current branch of the located
    # repository when none is given. Unreadable is refused — name the branch instead.
    targets=$(guard_push_targets) ||
      guard_block "'$GUARD_COMMAND' is a lease push whose target branch cannot be read from '$GUARD_PUSH_LOC'. Name it: git push --force-with-lease origin <branch>."
    while IFS= read -r target; do
      guard_protected "$target" && guard_block "'$GUARD_COMMAND' force-pushes to '$target', a protected branch (guardrails.protectedBranches)."
    done <<<"$targets"
    return 0
  fi

  # A plain push: refused only when a target is protected. A dry run writes nothing, `--tags` alone
  # writes no branch, and an unreadable target passes here — the push itself fails on a detached
  # HEAD, and nothing is destroyed. The config is read only once there is a target to judge.
  ((GUARD_PUSH_DRY)) && return 0
  ((GUARD_PUSH_TAGS)) && [[ -z "$GUARD_PUSH_REFSPECS" ]] && ! ((GUARD_PUSH_ALL)) && return 0
  targets=$(guard_push_targets) || return 0
  guard_config_load "$GUARD_CWD" || return 0
  while IFS= read -r target; do
    guard_protected "$target" && guard_block "'$GUARD_COMMAND' pushes to '$target', a protected branch (guardrails.protectedBranches). Open a pull request instead."
  done <<<"$targets"
  return 0
}

# check_restore <segment> — `git restore` aimed at the whole tree. `--staged` alone rewrites the index,
# which `git add` gives back; every form that reaches the working tree — `--worktree`, `-W`, or neither
# flag, from HEAD or from a `--source` — discards changes nothing brings back. One path is the agent's call.
check_restore() {
  guard_git_verb "$1" || return 0
  [[ "$GUARD_GIT_VERB" == "restore" ]] || return 0
  local i=$WORD_INDEX n=${#WORDS[@]} word staged=0 worktree=0 dot=0 paths=0
  while ((i < n)); do
    word="${WORDS[$i]}"
    if ((paths)); then
      [[ "$word" == "." || "$word" == "./" ]] && dot=1
    else
      case "$word" in
        --) paths=1 ;;
        --staged) staged=1 ;;
        --worktree) worktree=1 ;;
        --source | --conflict) i=$((i + 1)) ;;
        --*) ;;
        -*)
          [[ "$word" == *S* ]] && staged=1
          [[ "$word" == *W* ]] && worktree=1
          [[ "$word" == *s* ]] && i=$((i + 1)) # -s <tree>, alone or clustered, takes the next word
          ;;
        . | ./) dot=1 ;;
      esac
    fi
    i=$((i + 1))
  done
  ((dot)) || return 0
  ((worktree || !staged)) &&
    guard_block "'$GUARD_COMMAND' restores the whole working tree, which discards every uncommitted change. Restore one path, or pass --staged alone to touch the index only."
  return 0
}

while IFS= read -r segment; do
  if printf '%s\n' "$segment" | grep -qE "^[[:space:]]*${GUARD_WRAPPER}[\"']?${GUARD_GIT} "; then
    check_push "$segment"
    check_restore "$segment"
  fi
done < <(guard_segments "$SCAN")

exit 0

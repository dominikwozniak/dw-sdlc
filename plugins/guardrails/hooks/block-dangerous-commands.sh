#!/bin/bash
# Refuses the commands that destroy work the reflog cannot bring back, and the remote writes that
# replace or delete what others build on. Every command is judged where the shell runs one: a line
# start, indented or not, after a separator, a subshell or a substitution, and behind the words that
# run the command after them — `sudo`, `xargs`, `timeout`, `find -exec`, `bash -c`, a heredoc a shell
# reads, the full list in lib-words.sh.
#
# git and gh are read as words, each verb with its own options, so spacing, quoting, a cluster such as
# `-fb` and an option's value such as `--sort -refname` read once:
#   reset --hard; clean -f/-d/-x/-X/--force unless a dry run; branch -D/-f/--force/-M/-C; checkout -f
#   or of the whole tree; switch -f/--discard-changes; restore of the whole tree unless --staged
#   alone; stash drop/clear; worktree remove -f; reflog expire/delete; gc --prune=now|all; prune;
#   update-ref -d.
#   push: a bare --force, -f or +refspec and a --mirror are always refused; --force-with-lease and
#   --force-if-includes pass to a branch outside guardrails.protectedBranches, each behind a
#   permission prompt when guardrails.forcePush is `ask`, and nothing passes when it is `deny`; a
#   plain push to a protected branch is refused, and so is a remote branch deletion: --delete, -d, a
#   `:branch` refspec, or a --prune that reaches past the refspecs named. --all and a wildcard
#   refspec count every local branch.
#   commit: on a protected branch, when guardrails.commitOnProtected is `deny`; a `switch` or
#   `checkout` earlier in the same command moves the branch.
#   gh: `repo delete`, `pr merge|close --delete-branch`, and `api` deleting a ref or a repository or
#   force-updating a ref, REST or GraphQL.
# A git command is judged where it runs: the payload's cwd, moved by a literal `cd` earlier in the
# command (one inside a subshell ends with it) or by `git -C`, for its branch and its config alike. A
# path computed at runtime cannot be followed and leaves the cwd.
# rm, find and shred are read as text, where a target is: `rm` at the root, the home, the working
# directory by any of its names, `..` upward or the repository's `.git`; `find -delete`; `shred`.
#
# Guardrail against agent accidents, not a security boundary: a command assembled at runtime, an
# alias, a script on disk or a remote shell is not read. Runs always-on from bash-guard.sh, or alone
# on the JSON payload; `--bash-command <cwd>` is the dispatcher's fast path.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0

# --- rm, find and shred, read in place ------------------------------------------------------------

END='([^A-Za-z0-9_-]|$)'
# A target may be any operand, so the arm ends at whitespace, a separator, a closing parenthesis or
# backtick. `/` and `.` mean the same quoted or not, so either quote may wrap them. The home directory
# is `~` only bare — quoted, the shell passes a literal `~` — and `$HOME` bare or in double quotes;
# single quotes keep it literal. A quote after it closes a wrapper's, as in `bash -c 'rm -rf ~'`,
# where the inner shell expands the `~`.
Q=$GUARD_OPEN_QUOTE
RM="rm([[:space:]]+[^;&|]*)?[[:space:]]+"
TEND="${Q}([[:space:]]|\$|[;&|)\`])"
WORKDIR='(\$PWD|\$\{PWD\}|\$\(pwd\)|`pwd`|\$\(git[[:space:]]+rev-parse[[:space:]]+--show-toplevel\))'

PATTERNS=(
  "${RM}${Q}/+\\*?${TEND}"
  "${RM}(~/*\\*?|\"?(\\\$HOME|\\\$\\{HOME\\})\"?/*\\*?\"?)${TEND}"
  "${RM}${Q}\\.\\.?(/\\.\\.?)*/*\\*?${TEND}"
  "${RM}\"?${WORKDIR}\"?/*\\*?\"?${TEND}"
  "${RM}${Q}(\\./)?\\.git/?${TEND}"
  "${RM}${Q}\\*${TEND}"
  "find([[:space:]][^;&|]*)?[[:space:]]-delete${TEND}"
  "shred${END}"
)
REASONS=(
  "deletes from the root of the filesystem"
  "deletes the home directory"
  "deletes the working directory or a directory above it"
  "deletes the working directory"
  "deletes the repository's history"
  "deletes every entry of the working directory"
  "bulk-deletes through find"
  "destroys files beyond recovery"
)

# Matched against the masked scan, reported as the command: the user has to see what they typed.
SCAN=$(guard_mask_quoted_separators "$GUARD_COMMAND")
for i in "${!PATTERNS[@]}"; do
  if printf '%s\n' "$SCAN" | grep -qE "${GUARD_BOUNDARY}${PATTERNS[i]}"; then
    guard_block "'$GUARD_COMMAND' ${REASONS[i]}."
  fi
done

# --- git, read as words ---------------------------------------------------------------------------

# check_push <segment> — one command segment that starts, after the wrappers, with `git … push`.
check_push() {
  guard_parse_push "$1" || return 0
  ((GUARD_PUSH_DELETE)) && guard_block "'$GUARD_COMMAND' deletes a remote branch."
  ((GUARD_PUSH_MIRROR)) && guard_block "'$GUARD_COMMAND' is a mirror push: it force-updates and deletes every remote ref until the remote matches this repository."
  ((GUARD_PUSH_BARE)) && guard_block "'$GUARD_COMMAND' force-pushes without a lease. Use --force-with-lease (and --force-if-includes) so the push only replaces what you last fetched."

  local targets target
  if ((GUARD_PUSH_LEASE)); then
    guard_config_load "$GUARD_PUSH_LOC" || return 0
    [[ "$(guard_config_get '.guardrails.forcePush')" == "deny" ]] &&
      guard_block "'$GUARD_COMMAND' is a force push, and this repository refuses every force push (guardrails.forcePush: deny)."
    # The target branches: the destination side of each refspec, or the current branch of the located
    # repository when none is given. Unreadable is refused — name the branch instead.
    targets=$(guard_push_targets) ||
      guard_block "'$GUARD_COMMAND' is a lease push whose target branch cannot be read from '$GUARD_PUSH_LOC'. Name it: git push --force-with-lease origin <branch>."
    while IFS= read -r target; do
      guard_protected "$target" && guard_block "'$GUARD_COMMAND' force-pushes to '$target', a protected branch (guardrails.protectedBranches)."
    done <<<"$targets"
    if [[ "$(guard_config_get '.guardrails.forcePush')" == "ask" && -z "$ASK" ]]; then
      ASK="A lease push to ${targets//$'\n'/, } rewrites that remote branch; this repository asks before each one (guardrails.forcePush: ask)."
    fi
    return 0
  fi

  # A plain push: refused only when a target is protected. A dry run writes nothing, `--tags` alone
  # writes no branch, and an unreadable target passes here — the push itself fails on a detached
  # HEAD, and nothing is destroyed. The config is read only once there is a target to judge.
  ((GUARD_PUSH_DRY)) && return 0
  ((GUARD_PUSH_TAGS)) && [[ -z "$GUARD_PUSH_REFSPECS" ]] && ! ((GUARD_PUSH_ALL)) && return 0
  targets=$(guard_push_targets) || return 0
  guard_config_load "$GUARD_PUSH_LOC" || return 0
  while IFS= read -r target; do
    guard_protected "$target" && guard_block "'$GUARD_COMMAND' pushes to '$target', a protected branch (guardrails.protectedBranches). Open a pull request instead."
  done <<<"$targets"
  return 0
}

# check_restore — `git restore` aimed at the whole tree. `--staged` alone rewrites the index, which
# `git add` gives back; every form that reaches the working tree — `--worktree`, `-W`, or neither
# flag, from HEAD or from a `--source` — discards changes nothing brings back. One path is the agent's call.
check_restore() {
  guard_opts "s" "--source --conflict --pathspec-from-file"
  guard_whole_tree || return 0
  if guard_opt --worktree -W || ! guard_opt --staged -S; then
    guard_block "'$GUARD_COMMAND' restores the whole working tree, which discards every uncommitted change. Restore one path, or pass --staged alone to touch the index only."
  fi
  return 0
}

# The branch each location switched to earlier in this command, one `<dir>\t<branch>` per line, the
# last line for a location the one that holds; `-` is a detached HEAD.
SWITCHED=""

# note_switch — records where a `git switch` or `git checkout` leaves its location: the branch it
# creates, the branch it names, or `-` for --detach. A checkout's operand counts only when it is the
# one operand and names a local branch, since `git checkout main -- a.txt` copies a path and stays put.
note_switch() {
  local i=$WORD_INDEX n=${#WORDS[@]} word target="" operand="" operands=0
  while ((i < n)); do
    word=${WORDS[i]}
    case "$word" in
      --)
        ((i + 1 < n)) && operands=2
        break
        ;;
      -c | -C | -b | -B | --create | --force-create | --orphan)
        i=$((i + 1))
        target=${WORDS[i]:-}
        ;;
      --create=* | --force-create=* | --orphan=*) target=${word#*=} ;;
      -d | --detach) target="-" ;;
      -[cCbB]?*) target=${word:2} ;;
      -*) ;;
      *)
        [[ -z "$operand" ]] && operand=$word
        operands=$((operands + 1))
        ;;
    esac
    i=$((i + 1))
  done
  if [[ -z "$target" && -n "$operand" && "$operand" != "-" ]]; then
    if [[ "$GUARD_GIT_VERB" == switch ]] || { ((operands == 1)) &&
      git -C "$GUARD_PUSH_LOC" show-ref --verify -q "refs/heads/$operand" 2>/dev/null; }; then
      target=$operand
    fi
  fi
  [[ -n "$target" ]] && SWITCHED+="$GUARD_PUSH_LOC"$'\t'"$target"$'\n'
  return 0
}

# check_commit — a commit on a protected branch, where guardrails.commitOnProtected is `deny`. The
# branch is the one a switch earlier in this command left the location on, else the one it stands
# on; a detached HEAD and a dry run pass.
check_commit() {
  local line branch=""
  guard_opts "mFCcSt" "--message --file --reuse-message --reedit-message --fixup --squash --author --date --template --trailer --cleanup"
  guard_opt --dry-run && return 0
  guard_config_load "$GUARD_PUSH_LOC" || return 0
  [[ "$(guard_config_get '.guardrails.commitOnProtected')" == "deny" ]] || return 0
  while IFS= read -r line; do
    [[ "${line%%$'\t'*}" == "$GUARD_PUSH_LOC" ]] && branch=${line#*$'\t'}
  done <<<"$SWITCHED"
  [[ "$branch" == "-" ]] && return 0
  [[ -n "$branch" ]] || branch=$(guard_current_branch "$GUARD_PUSH_LOC") || return 0
  guard_protected "$branch" &&
    guard_block "'$GUARD_COMMAND' commits on '$branch', a protected branch, and this repository takes no commit there (guardrails.commitOnProtected: deny). Create a branch first: git switch -c <name>."
  return 0
}

# check_git <segment> — a git command, its verb in GUARD_GIT_VERB and its words in WORDS.
check_git() {
  local why="" sub="${WORDS[WORD_INDEX]:-}" word
  case "$GUARD_GIT_VERB" in
    push) check_push "$1" ;;
    restore) check_restore ;;
    commit) check_commit ;;
    reset)
      guard_opts "" "--pathspec-from-file"
      guard_opt --hard && why="discards the index and every uncommitted change"
      ;;
    clean)
      guard_opts "e" "--exclude"
      if ! guard_opt -n --dry-run && guard_opt -f -d -x -X --force; then
        why="deletes untracked files"
      fi
      ;;
    branch)
      guard_opts "u" "--sort --format --contains --no-contains --merged --no-merged --points-at --set-upstream-to"
      guard_opt -D -f --force -M -C && why="force-deletes, force-moves or force-repoints a branch; git keeps an unmerged one from a plain -d"
      ;;
    checkout)
      note_switch
      guard_opts "bB" "--orphan --conflict --pathspec-from-file"
      guard_opt -f --force && why="switches over local changes and discards them"
      guard_whole_tree && why="discards every working-tree change"
      ;;
    switch)
      note_switch
      guard_opts "cC" "--create --force-create --orphan --conflict"
      guard_opt -f --force --discard-changes && why="switches over local changes and discards them"
      ;;
    stash)
      case "$sub" in
        drop | clear) why="drops a stash, which lives only in the stash reflog" ;;
      esac
      ;;
    worktree)
      if [[ "$sub" == remove ]]; then
        guard_opts "" "" $((WORD_INDEX + 1))
        guard_opt -f --force && why="deletes the worktree's modified and untracked files, which a plain remove keeps"
      fi
      ;;
    reflog)
      case "$sub" in
        expire | delete) why="drops reflog entries, the only record of commits no branch holds" ;;
      esac
      ;;
    gc)
      for word in "${WORDS[@]:WORD_INDEX}"; do
        case "$word" in
          --prune=now | --prune=all) why="deletes every unreachable commit at once, the reflog's safety window included" ;;
        esac
      done
      ;;
    prune)
      guard_opts "" "--expire"
      guard_opt -n --dry-run || why="deletes every unreachable commit"
      ;;
    update-ref)
      guard_opts "m" ""
      guard_opt -d && why="deletes a ref, which drops its reflog with it"
      ;;
  esac
  [[ -n "$why" ]] && guard_block "'$GUARD_COMMAND' $why."
  return 0
}

# --- gh, read as words ----------------------------------------------------------------------------

# check_gh — a gh command in WORDS.
check_gh() {
  case "${WORDS[1]:-}" in
    repo)
      [[ "${WORDS[2]:-}" == delete ]] && guard_block "'$GUARD_COMMAND' deletes a GitHub repository."
      ;;
    pr)
      case "${WORDS[2]:-}" in
        merge) guard_opts "btFAR" "--body --body-file --subject --author-email --match-head-commit --repo" 3 ;;
        close) guard_opts "cR" "--comment --repo" 3 ;;
        *) return 0 ;;
      esac
      # Drop this rule to let a merge delete its branch.
      guard_opt -d --delete-branch && [[ " ${WORDS[*]} " != *" --delete-branch=false "* ]] &&
        guard_block "'$GUARD_COMMAND' deletes the pull request's branch on GitHub and here. A merged branch on GitHub goes with the repository's delete_branch_on_merge setting; a local one is the user's to delete."
      ;;
    api) check_gh_api ;;
  esac
  return 0
}

# check_gh_api — `gh api`: the method (`-X`, `--method`, any case, anywhere), the fields (`-f`, `-F`,
# `--raw-field`, `--field`) and the endpoint, the first operand without the API host.
check_gh_api() {
  local i=2 n=${#WORDS[@]} word method="" endpoint="" fields=""
  while ((i < n)); do
    word=${WORDS[i]}
    case "$word" in
      -X | --method)
        i=$((i + 1))
        method=${WORDS[i]:-}
        ;;
      -X?*) method=${word#-X} ;;
      --method=*) method=${word#*=} ;;
      -f | -F | --raw-field | --field)
        i=$((i + 1))
        fields+=" ${WORDS[i]:-}"
        ;;
      -[fF]?*) fields+=" ${word:2}" ;;
      --raw-field=* | --field=*) fields+=" ${word#*=}" ;;
      -H | --header | -q | --jq | -t | --template | -p | --preview | --input | --hostname | --cache) i=$((i + 1)) ;;
      -*) ;;
      *) [[ -z "$endpoint" ]] && endpoint=$word ;;
    esac
    i=$((i + 1))
  done
  method=$(printf '%s' "$method" | tr '[:lower:]' '[:upper:]')
  endpoint=${endpoint#https://api.github.com}
  endpoint=${endpoint#/}
  case "$method" in
    DELETE)
      [[ "$endpoint" == *git/refs/* ]] && guard_block "'$GUARD_COMMAND' deletes a branch or tag on GitHub."
      [[ "$endpoint" == repos/*/* && "$endpoint" != repos/*/*/* ]] && guard_block "'$GUARD_COMMAND' deletes a GitHub repository."
      ;;
    PATCH | POST)
      [[ "$endpoint" == *git/refs/* && "$fields" == *force=true* ]] && guard_block "'$GUARD_COMMAND' force-updates a ref on GitHub."
      ;;
  esac
  if [[ "$endpoint" == graphql ]]; then
    [[ "$fields" == *deleteRef* ]] && guard_block "'$GUARD_COMMAND' deletes a ref on GitHub through GraphQL."
    [[ "$fields" == *updateRef* && "$fields" == *force* ]] && guard_block "'$GUARD_COMMAND' force-updates a ref on GitHub through GraphQL."
  fi
  return 0
}

# An ask is held until every segment is judged: a refusal further on still wins.
ASK=""
while IFS= read -r segment; do
  guard_scope_step "$segment" || continue
  case "${WORDS[0]:-}" in
    git) guard_git_verb_words && check_git "$segment" ;;
    gh) check_gh ;;
  esac
done < <(guard_scopes "$SCAN")
[[ -n "$ASK" ]] && guard_ask "$ASK"

exit 0

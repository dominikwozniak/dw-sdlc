#!/bin/bash
# Refuses what destroys work the reflog cannot bring back, and the remote writes others build on:
# git and gh read as words, rm, find and shred read in place, each rule in README.md#guards. Not a
# security boundary: a command assembled at runtime, an alias or a script on disk is not read.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0

# --- rm, find and shred, read in place ------------------------------------------------------------

END='([^A-Za-z0-9_-]|$)'
# A target may be any operand, so an arm ends at whitespace, a separator, `)` or a backtick. `/` and
# `.` read the same in either quote, `~` only bare, `$HOME` bare or in double quotes. A quote after a
# target closes a launcher's, as in `bash -c 'rm -rf ~'`, where the inner shell expands the `~`.
Q=$GUARD_OPEN_QUOTE
RM="rm([[:space:]]+[^;&|]*)?[[:space:]]+"
TEND="${Q}([[:space:]]|\$|[;&|)\`])"
# `${HOME:?}` and `${PWD:?msg}` fail when unset, the spelling shellcheck SC2115 asks for: still the path.
UNSET_FAILS='(:?\?[^}]*)?'
WORKDIR="(\\\$PWD|\\\$\\{PWD${UNSET_FAILS}\\}|\\\$\\(pwd\\)|\`pwd\`|\\\$\\(git[[:space:]]+rev-parse[[:space:]]+--show-toplevel\\))"

# Wherever the command runs: the root, the home, a directory above, the working directory by name,
# a repository's `.git` at any path.
PATTERNS=(
  "${RM}${Q}/+\\*?${TEND}"
  "${RM}(~/*\\*?|\"?(\\\$HOME|\\\$\\{HOME${UNSET_FAILS}\\})\"?/*\\*?\"?)${TEND}"
  "${RM}${Q}\\.\\.(/\\.\\.?)*/*\\*?${TEND}"
  "${RM}\"?${WORKDIR}\"?(/+(\\.\\.?|\\.git))*/*\\*?\"?${TEND}"
  "${RM}${Q}([^[:space:];&|]*/)?\\.git(/(\\*|objects|refs|logs)(/\\*)?)?/?${TEND}"
  "find([[:space:]][^;&|]*)?[[:space:]]-delete${TEND}"
  "shred${END}"
)
REASONS=(
  "deletes from the root of the filesystem"
  "deletes the home directory"
  "deletes a directory above the working directory"
  "deletes the working directory or a directory above it"
  "deletes a repository's history"
  "bulk-deletes through find"
  "destroys files beyond recovery"
)
# Where the command runs: `.`, `./*` or a bare `*`. A `cd` into a directory below the payload's cwd
# earlier in the command moves them there, so `cd dist && rm -rf *` cleans dist.
HERE_PATTERNS=(
  "${RM}${Q}\\.(/\\.)*/*\\*?${TEND}"
  "${RM}${Q}\\*${TEND}"
)
HERE_REASONS=(
  "deletes the working directory"
  "deletes every entry of the working directory"
)

# Matched against the masked scan, reported as the command: the user has to see what they typed.
SCAN=$(guard_mask_quoted_separators "$GUARD_COMMAND")
# Every pattern holds one of these words, so a text without one costs no grep.
case "$SCAN" in
  *rm* | *find* | *shred*)
    for i in "${!PATTERNS[@]}"; do
      if printf '%s\n' "$SCAN" | grep -qE "${GUARD_BOUNDARY}${PATTERNS[i]}"; then
        guard_block "'$GUARD_COMMAND' ${REASONS[i]}."
      fi
    done
    ;;
esac

# check_rm_here <segment> — an rm segment against HERE_PATTERNS, unless the shell stands below the
# payload's cwd by then.
check_rm_here() {
  local here top i
  here=$(cd "$GUARD_SHELL_DIR" 2>/dev/null && pwd -P) || here=""
  top=$(cd "$GUARD_CWD" 2>/dev/null && pwd -P) || top=""
  [[ -n "$here" && -n "$top" && "$here" == "$top"/* ]] && return 0
  for i in "${!HERE_PATTERNS[@]}"; do
    if printf '%s\n' "$1" | grep -qE "${GUARD_BOUNDARY}${HERE_PATTERNS[i]}"; then
      guard_block "'$GUARD_COMMAND' ${HERE_REASONS[i]}."
    fi
  done
  return 0
}

# --- git, read as words ---------------------------------------------------------------------------

# check_push <segment> — one command segment that starts, after the launchers, with `git … push`.
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

# check_commit <flag>... — a verb that commits, on a protected branch under commitOnProtected `deny`;
# guard_opts has read its options, and any <flag> makes it commit nothing. The branch is HEAD's once
# the switches earlier in this command ran; a detached HEAD passes.
check_commit() {
  local branch
  guard_opt "$@" && return 0
  guard_config_load "$GUARD_PUSH_LOC" || return 0
  [[ "$(guard_config_get '.guardrails.commitOnProtected')" == "deny" ]] || return 0
  branch=$(guard_head_branch "$GUARD_PUSH_LOC") || return 0
  guard_protected "$branch" &&
    guard_block "'$GUARD_COMMAND' commits on '$branch', a protected branch, and this repository takes no commit there (guardrails.commitOnProtected: deny). Create a branch first: git switch -c <name>."
  return 0
}

PLAIN='^[A-Za-z0-9._/+@-]+$'

# The whole command is one command: no separator, pipe, background `&`, subshell, substitution or
# backtick, a redirect's `&` aside. Only then are the repository and the branches a forced delete is
# checked against the ones git gets.
guard_alone() {
  [[ "$(guard_pipelines "$SCAN")" != *$'\n'* && "$SCAN" != *[\|\(\)\`]* ]]
}

# check_branch_delete <segment> — a forced `git branch` delete, guard_opts having read it. It passes
# when each branch it names is landed (guard_landed), and only as a command of its own with each
# branch and the path written out, `[rtk] git [-C <path>] branch …`: README.md#guards says why.
check_branch_delete() {
  local word branch base i=0 skip=0 branches=()
  guard_opt -r --remotes && guard_block "'$GUARD_COMMAND' force-deletes remote-tracking branches."
  guard_read_words "$1"
  [[ "${WORDS[0]:-}" == rtk ]] && i=1
  [[ "${WORDS[i]:-}" == git ]] && i=$((i + 1))
  [[ "${WORDS[i]:-}" == -C && "${WORDS[i + 1]:-}" =~ $PLAIN ]] && i=$((i + 2))
  if ! guard_alone || [[ "${WORDS[i]:-}" != branch ]]; then
    guard_block "'$GUARD_COMMAND' force-deletes a branch as part of a longer command. A forced delete passes as a command of its own: git [-C <path>] branch -D <branch>..., each branch written out."
  fi
  # A redirect and its target are skipped, unless a branch has that name: quoted, it is one.
  for word in ${OPT_OPERANDS[@]+"${OPT_OPERANDS[@]}"}; do
    if ((skip)) || [[ "$word" =~ $GUARD_REDIRECT ]]; then
      git -C "$GUARD_PUSH_LOC" show-ref --verify -q "refs/heads/$word" 2>/dev/null &&
        guard_block "'$GUARD_COMMAND' force-deletes '$word', which reads as a redirect and names a branch too; a branch of that name is the user's to delete."
      if ((skip)); then
        skip=0
      else
        [[ "$word" =~ $GUARD_REDIRECT_ALONE ]] && skip=1
      fi
    elif [[ "$word" =~ $PLAIN ]]; then
      branches+=("$word")
    else
      guard_block "'$GUARD_COMMAND' force-deletes a branch it does not write out: '$word'. A forced delete passes when it names each branch and the work of each is on the base branch."
    fi
  done
  ((${#branches[@]})) || guard_block "'$GUARD_COMMAND' force-deletes no branch it names."
  guard_config_load "$GUARD_PUSH_LOC"
  if ! guard_base_ref "$GUARD_PUSH_LOC"; then
    [[ -n "$GUARD_BASE_REF" ]] &&
      guard_block "'$GUARD_COMMAND' force-deletes a branch, and its base branch ${GUARD_BASE_REF#refs/remotes/} is not here to check it against. Run git fetch origin, or fix baseBranch in .ai/agentic.config.json."
    guard_block "'$GUARD_COMMAND' force-deletes a branch, and no base branch is known to check it against: origin/HEAD names no branch of origin. Run git remote set-head origin --auto, or set baseBranch in .ai/agentic.config.json."
  fi
  base=$GUARD_BASE_REF
  for branch in "${branches[@]}"; do
    guard_landed "$GUARD_PUSH_LOC" "$base" "$branch" ||
      guard_block "'$GUARD_COMMAND' force-deletes '$branch', and the guard finds its work on no commit of ${base#refs/remotes/} since it forked: it is not merged, changed after its merge, or merged after the last fetch. Run git fetch origin, then delete it again; a branch with unmerged work is the user's to delete."
  done
  return 0
}

# check_git <segment> — a git command, its verb in GUARD_GIT_VERB and its words in WORDS.
check_git() {
  local why="" sub="${WORDS[WORD_INDEX]:-}" word
  case "$GUARD_GIT_VERB" in
    push) check_push "$1" ;;
    restore) check_restore ;;
    commit)
      guard_opts "mFCcSt" "--message --file --reuse-message --reedit-message --fixup --squash --author --date --template --trailer --cleanup"
      check_commit --dry-run
      ;;
    merge)
      guard_opts "mFsX" "--message --file --strategy --strategy-option --into-name"
      check_commit --abort --quit --ff-only --no-commit --squash
      ;;
    cherry-pick | revert)
      guard_opts "msX" "--mainline --strategy --strategy-option"
      check_commit --abort --quit --skip -n --no-commit
      ;;
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
      # A forced create of a branch that is not there yet replaces nothing.
      guard_opts "u" "--sort --format --contains --no-contains --merged --no-merged --points-at --set-upstream-to"
      if guard_opt -M -C || { guard_opt -f --force && guard_opt -m --move -c --copy; }; then
        why="force-moves or force-copies a branch over one of the same name"
      elif guard_opt -D || { guard_opt -f --force && guard_opt -d --delete; }; then
        check_branch_delete "$1"
      elif guard_opt -f --force && git -C "$GUARD_PUSH_LOC" show-ref --verify -q "refs/heads/${OPT_OPERANDS[0]:-}" 2>/dev/null; then
        why="force-repoints a branch, dropping the commits only it held"
      fi
      ;;
    checkout)
      guard_note_switch
      guard_opts "bB" "--orphan --conflict --pathspec-from-file"
      guard_opt -f --force && why="switches over local changes and discards them"
      guard_whole_tree && why="discards every working-tree change"
      ;;
    switch)
      guard_note_switch
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
      guard_opt -d --delete && why="deletes a ref, which drops its reflog with it"
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

GQL_DELETE=$'(deleteRef|deleteRepository)[[:space:]]*[(\002]'
GQL_UPDATE_REF=$'updateRefs?[[:space:]]*[(\002]'

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
  # A mutation is its name and an opening parenthesis, masked to \002 inside the quote.
  if [[ "$endpoint" == graphql ]]; then
    [[ "$fields" =~ $GQL_DELETE ]] && guard_block "'$GUARD_COMMAND' deletes a ref or a repository on GitHub through GraphQL."
    [[ "$fields" =~ $GQL_UPDATE_REF && "$fields" == *force* ]] && guard_block "'$GUARD_COMMAND' force-updates a ref on GitHub through GraphQL."
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
    rm) check_rm_here "$segment" ;;
  esac
done < <(guard_scopes "$SCAN")
[[ -n "$ASK" ]] && guard_ask "$ASK"

exit 0

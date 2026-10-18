#!/bin/bash
# The git readers lib.sh sources — a git command's verb, its options, a push's targets, the branch a
# repository stands on. Not a hook and not sourced on its own: lib.sh sets the locale and
# GUARD_LIB_DIR first and sources this file after the word readers, whose WORDS and guard_words the
# readers here work on.
# --- git ----------------------------------------------------------------------------------------

GUARD_PUSH_LOC=""
GUARD_PUSH_BARE=0
GUARD_PUSH_LEASE=0
GUARD_PUSH_DELETE=0
GUARD_PUSH_MIRROR=0
GUARD_PUSH_ALL=0
GUARD_PUSH_TAGS=0
GUARD_PUSH_DRY=0
GUARD_PUSH_REMOTE=""
GUARD_PUSH_REFSPECS=""
GUARD_GIT_VERB=""
WORD_INDEX=0

# guard_git_verb <segment> — words in WORDS with the wrappers off; sets GUARD_GIT_VERB, GUARD_PUSH_LOC
# (where git runs) and WORD_INDEX (the first word after the verb). Returns 1 when the segment is not a
# git command. Globals, not stdout: a caller capturing stdout would run this in a subshell and lose
# the words.
guard_git_verb() {
  guard_read_words "$1"
  guard_unwrap_words
  guard_git_verb_words
}

# guard_git_verb_words — guard_git_verb for the words already in WORDS, the wrappers off.
guard_git_verb_words() {
  local word i n
  GUARD_PUSH_LOC="${GUARD_SHELL_DIR:-$GUARD_CWD}"
  GUARD_GIT_VERB=""
  n=${#WORDS[@]}
  [[ $n -gt 0 && "${WORDS[0]}" == "git" ]] || return 1
  i=1
  while ((i < n)); do
    word="${WORDS[$i]}"
    case "$word" in
      -C)
        i=$((i + 1))
        GUARD_PUSH_LOC=$(guard_located "${WORDS[$i]:-}")
        ;;
      -C?*) GUARD_PUSH_LOC=$(guard_located "${word#-C}") ;;
      --git-dir=* | --work-tree=*) GUARD_PUSH_LOC=$(guard_located "${word#*=}") ;;
      -c | --git-dir | --work-tree | --namespace | --exec-path) i=$((i + 1)) ;;
      -*) ;;
      *)
        WORD_INDEX=$((i + 1))
        GUARD_GIT_VERB="$word"
        return 0
        ;;
    esac
    i=$((i + 1))
  done
  return 1
}

# guard_parse_push <segment> — 0 when the segment is a `git … push` once the wrappers are off. Fills
# GUARD_PUSH_LOC (where git runs), GUARD_PUSH_BARE (--force, -f, +refspec), GUARD_PUSH_LEASE
# (--force-with-lease, --force-if-includes), GUARD_PUSH_DELETE (--delete, -d, a `:branch` refspec
# with no source — a bare `:` is the matching refspec and deletes nothing — and a --prune that reaches
# past the refspecs it names: with --all, --tags, no refspec or one holding a `*`), GUARD_PUSH_MIRROR
# (--mirror, which force-updates and deletes every remote ref), GUARD_PUSH_ALL (--all, --branches:
# every local branch), GUARD_PUSH_TAGS (--tags: no branch unless a refspec names one), GUARD_PUSH_DRY
# (--dry-run, -n: nothing is written), GUARD_PUSH_REMOTE and GUARD_PUSH_REFSPECS, one per line with a
# leading + stripped. A cluster of short options is read letter by letter.
guard_parse_push() {
  local word i n prune=0
  GUARD_PUSH_BARE=0
  GUARD_PUSH_LEASE=0
  GUARD_PUSH_DELETE=0
  GUARD_PUSH_MIRROR=0
  GUARD_PUSH_ALL=0
  GUARD_PUSH_TAGS=0
  GUARD_PUSH_DRY=0
  GUARD_PUSH_REMOTE=""
  GUARD_PUSH_REFSPECS=""
  guard_git_verb "$1" || return 1
  [[ "$GUARD_GIT_VERB" == "push" ]] || return 1
  n=${#WORDS[@]}
  i=$WORD_INDEX
  while ((i < n)); do
    word="${WORDS[$i]}"
    case "$word" in
      --force) GUARD_PUSH_BARE=1 ;;
      --force-with-lease | --force-with-lease=* | --force-if-includes) GUARD_PUSH_LEASE=1 ;;
      --delete) GUARD_PUSH_DELETE=1 ;;
      --prune) prune=1 ;;
      --mirror) GUARD_PUSH_MIRROR=1 ;;
      --all | --branches) GUARD_PUSH_ALL=1 ;;
      --tags) GUARD_PUSH_TAGS=1 ;;
      --dry-run) GUARD_PUSH_DRY=1 ;;
      --repo=*) GUARD_PUSH_REMOTE="${word#*=}" ;;
      --repo)
        i=$((i + 1))
        GUARD_PUSH_REMOTE="${WORDS[$i]:-}"
        ;;
      -o | --push-option | --receive-pack | --exec) i=$((i + 1)) ;;
      --*) ;;
      -?*)
        [[ "$word" == *f* ]] && GUARD_PUSH_BARE=1
        [[ "$word" == *n* ]] && GUARD_PUSH_DRY=1
        [[ "$word" == *d* ]] && GUARD_PUSH_DELETE=1
        ;;
      -) ;;
      +*)
        GUARD_PUSH_BARE=1
        [[ "$word" == +:?* ]] && GUARD_PUSH_DELETE=1
        GUARD_PUSH_REFSPECS+="${GUARD_PUSH_REFSPECS:+$'\n'}${word#+}"
        ;;
      *)
        if [[ -z "$GUARD_PUSH_REMOTE" ]]; then
          GUARD_PUSH_REMOTE="$word"
        else
          [[ "$word" == :?* ]] && GUARD_PUSH_DELETE=1
          GUARD_PUSH_REFSPECS+="${GUARD_PUSH_REFSPECS:+$'\n'}$word"
        fi
        ;;
    esac
    i=$((i + 1))
  done
  if ((prune)); then
    if ((GUARD_PUSH_ALL || GUARD_PUSH_TAGS)) || [[ -z "$GUARD_PUSH_REFSPECS" || "$GUARD_PUSH_REFSPECS" == *'*'* ]]; then
      GUARD_PUSH_DELETE=1
    fi
  fi
  return 0
}

# guard_push_matching — the branches the matching refspec `:` writes to: every local branch the
# remote has too, read from its remote-tracking refs. A remote with none, such as a URL, gives no way
# to tell, so every local branch counts.
guard_push_matching() {
  local remote="${GUARD_PUSH_REMOTE:-origin}" heads tracked branch
  heads=$(git -C "$GUARD_PUSH_LOC" for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null)
  tracked=$(git -C "$GUARD_PUSH_LOC" for-each-ref --format='%(refname)' "refs/remotes/$remote/" 2>/dev/null)
  while IFS= read -r branch; do
    [[ -n "$branch" ]] || continue
    if [[ -z "$tracked" || $'\n'"$tracked"$'\n' == *$'\n'"refs/remotes/$remote/$branch"$'\n'* ]]; then
      printf '%s\n' "$branch"
    fi
  done <<<"$heads"
}

# guard_push_targets — the branches the parsed push writes to, one per line: every local branch of
# GUARD_PUSH_LOC for --all and for a refspec holding a `*`, else the destination side of each refspec
# (the matching refspec `:` by guard_push_matching), or the branch HEAD is on when none names one.
# Returns 1 when those branches cannot be read.
guard_push_targets() {
  local spec target specs="$GUARD_PUSH_REFSPECS"
  if ((GUARD_PUSH_ALL)) || [[ "$specs" == *'*'* ]]; then
    git -C "$GUARD_PUSH_LOC" for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null
    return
  fi
  [[ -n "$specs" ]] || specs="HEAD"
  while IFS= read -r spec; do
    if [[ "$spec" == ":" ]]; then
      guard_push_matching
      continue
    fi
    target="${spec##*:}"
    target="${target#refs/heads/}"
    if [[ "$target" == "HEAD" ]]; then
      target=$(guard_head_branch "$GUARD_PUSH_LOC") || return 1
    fi
    printf '%s\n' "$target"
  done <<<"$specs"
}

# guard_current_branch <dir> — the branch the repository at <dir> stands on; 1 on a detached HEAD or
# outside a repository.
guard_current_branch() {
  git -C "$1" symbolic-ref --short -q HEAD 2>/dev/null
}

# The branch each location switched to earlier in this command, one `<dir>\t<branch>` per line, the
# last line for a location the one that holds; `-` is a detached HEAD.
GUARD_SWITCHED=""

# guard_note_switch — records where the `git switch` or `git checkout` in WORDS leaves its location:
# the branch it creates, the branch it names, or `-` for --detach. A checkout's operand counts only
# when it is the one operand and names a local branch, since `git checkout main -- a.txt` copies a
# path and stays put.
guard_note_switch() {
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
  [[ -n "$target" ]] && GUARD_SWITCHED+="$GUARD_PUSH_LOC"$'\t'"$target"$'\n'
  return 0
}

# guard_head_branch <dir> — the branch HEAD is on at <dir> once the switches earlier in this command
# ran, else the one it stands on; 1 on a detached HEAD or outside a repository.
guard_head_branch() {
  local line branch=""
  while IFS= read -r line; do
    [[ "${line%%$'\t'*}" == "$1" ]] && branch=${line#*$'\t'}
  done <<<"$GUARD_SWITCHED"
  [[ "$branch" == "-" ]] && return 1
  if [[ -n "$branch" ]]; then
    printf '%s' "$branch"
    return 0
  fi
  guard_current_branch "$1"
}


OPT_FLAGS=" "
OPT_OPERANDS=()

# guard_opts <letters> <long options> [<from>] — reads the options of the git verb in WORDS from
# <from>, WORD_INDEX by default: OPT_FLAGS gets ` -x ` per letter of a cluster and ` --name ` per long
# option, a `=value` cut, and OPT_OPERANDS every other word; `--` ends the options. One of <letters>
# takes the rest of its cluster or the next word as its value, and so does one of <long options>
# written apart, so `--sort -refname`, `-e '*.log'` and the `x` of `-fb x` hold no flag.
guard_opts() {
  local short="$1" long=" $2 " i="${3:-$WORD_INDEX}" n=${#WORDS[@]} word j ch
  OPT_FLAGS=" "
  OPT_OPERANDS=()
  while ((i < n)); do
    word=${WORDS[i]}
    case "$word" in
      --)
        OPT_OPERANDS+=("${WORDS[@]:i+1}")
        return 0
        ;;
      --*=*) OPT_FLAGS+="${word%%=*} " ;;
      --?*)
        OPT_FLAGS+="$word "
        [[ "$long" == *" $word "* ]] && i=$((i + 1))
        ;;
      -?*)
        for ((j = 1; j < ${#word}; j++)); do
          ch=${word:j:1}
          OPT_FLAGS+="-$ch "
          if [[ "$short" == *"$ch"* ]]; then
            ((j == ${#word} - 1)) && i=$((i + 1))
            break
          fi
        done
        ;;
      *) OPT_OPERANDS+=("$word") ;;
    esac
    i=$((i + 1))
  done
  return 0
}

# guard_opt <flag>... — 0 when guard_opts read one of the flags.
guard_opt() {
  local flag
  for flag; do
    [[ "$OPT_FLAGS" == *" $flag "* ]] && return 0
  done
  return 1
}

# guard_whole_tree — 0 when guard_opts read a pathspec that names the whole tree: `.`, `./`, `:/`,
# `:(top)` or a bare `*`.
guard_whole_tree() {
  local word
  for word in ${OPT_OPERANDS[@]+"${OPT_OPERANDS[@]}"}; do
    case "$word" in
      . | ./ | :/ | :/. | ':(top)' | '*') return 0 ;;
    esac
  done
  return 1
}

# guard_protected <branch> — 0 when the resolved config lists it in guardrails.protectedBranches.
guard_protected() {
  [[ -n "$(jq -r --arg b "$1" '.guardrails.protectedBranches[] | select(. == $b)' <<<"$GUARD_CONFIG")" ]]
}

GUARD_BASE_REF=""

# guard_base_ref <dir> — GUARD_BASE_REF becomes the remote-tracking ref of the base branch at <dir>:
# refs/remotes/origin/<baseBranch>, or for `auto` the ref refs/remotes/origin/HEAD names, kept only
# under refs/remotes/origin/. Returns 1 when it is no valid ref naming a commit here, GUARD_BASE_REF
# then empty when origin/HEAD gave none.
guard_base_ref() {
  local base
  base=$(guard_config_get '.baseBranch')
  if [[ -z "$base" || "$base" == auto ]]; then
    GUARD_BASE_REF=$(git -C "$1" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) || GUARD_BASE_REF=""
    [[ "$GUARD_BASE_REF" == refs/remotes/origin/?* ]] || GUARD_BASE_REF=""
  else
    GUARD_BASE_REF="refs/remotes/origin/$base"
  fi
  [[ -n "$GUARD_BASE_REF" ]] && git check-ref-format "$GUARD_BASE_REF" &&
    git -C "$1" rev-parse --verify -q "$GUARD_BASE_REF^{commit}" >/dev/null 2>&1
}

# The base commits guard_landed reads, newest first: a branch that forked further back is refused
# rather than read for seconds.
GUARD_LANDED_SCAN=5000

# guard_landed <dir> <base-ref> <branch> — 0 when the work of the local <branch> at <dir> is on
# <base-ref>: its tip is there (a merge or a fast-forward), or a base commit since the fork holds the
# tip's tree (a squash of a branch up to date with the base) or the patch-id of the branch's whole
# diff (a squash of one behind it). A branch whose tip has the fork's tree is not: its commits may hold
# work no tree shows. The patch-id is --verbatim, so whitespace counts, though not where in a file a
# hunk sits. Local objects only, never fetched lazily in a partial clone: a missing one refuses, and a
# base fetched before the squash lacks it. grep reads to the end, as `grep -q` would cut the pipe and
# pipefail fail it.
guard_landed() {
  local tip fork tree patch
  git check-ref-format "refs/heads/$3" || return 1
  tip=$(git -C "$1" rev-parse --verify -q "refs/heads/$3^{commit}" 2>/dev/null) || return 1
  git -C "$1" merge-base --is-ancestor "$tip" "$2" 2>/dev/null && return 0
  fork=$(git -C "$1" merge-base "$tip" "$2" 2>/dev/null) || return 1
  tree=$(git -C "$1" rev-parse "$tip^{tree}")
  [[ "$tree" == "$(git -C "$1" rev-parse "$fork^{tree}")" ]] && return 1
  git -C "$1" log --format=%T --max-count="$GUARD_LANDED_SCAN" "$fork..$2" | grep -xF "$tree" >/dev/null && return 0
  # pipefail: a diff cut short by a missing object fails here instead of naming part of the work.
  patch=$(GIT_NO_LAZY_FETCH=1 git -C "$1" diff-tree -p --binary --no-renames "$fork" "$tip" 2>/dev/null |
    git patch-id --verbatim) || return 1
  patch=${patch%% *}
  [[ -n "$patch" ]] || return 1
  git -C "$1" rev-list --no-merges --max-count="$GUARD_LANDED_SCAN" "$fork..$2" |
    GIT_NO_LAZY_FETCH=1 git -C "$1" diff-tree --stdin -p --binary --no-renames 2>/dev/null |
    git patch-id --verbatim | cut -d' ' -f1 | grep -xF "$patch" >/dev/null
}

#!/bin/bash
# The git readers lib.sh sources: a git command's verb and options, a push's targets, the branch a
# repository stands on. Not a hook: lib.sh sources it after lib-words.sh, whose WORDS it reads.
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
# A redirect word, its target glued or the next word when alone; guard_scopes made a redirect's `&`
# \003, so `2>&1` reads `2>\0031` and `&>log` reads `\003>log`.
GUARD_REDIRECT=$'^[0-9]*\003?[<>]'
GUARD_REDIRECT_ALONE=$'^[0-9]*\003?(<|>|>>)$'

# guard_git_verb <segment> — WORDS with the launchers off, GUARD_GIT_VERB, GUARD_PUSH_LOC where git
# runs, WORD_INDEX the word after the verb; 1 for no git command. Globals, not stdout: a caller
# capturing stdout runs it in a subshell and loses the words.
guard_git_verb() {
  guard_read_words "$1"
  guard_unwrap_words
  guard_git_verb_words
}

# guard_git_verb_words — guard_git_verb for the words already in WORDS, the launchers off.
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

# guard_parse_push <segment> — 0 for a `git … push`, launchers off, its options in the GUARD_PUSH_*
# flags, a cluster letter by letter, GUARD_PUSH_REFSPECS one a line, `+` and redirects off. A bare `:`
# deletes nothing; a --prune deletes with --all, --tags, no refspec or a `*` refspec.
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
        if [[ "$word" =~ $GUARD_REDIRECT ]]; then
          [[ "$word" =~ $GUARD_REDIRECT_ALONE ]] && i=$((i + 1))
        elif [[ -z "$GUARD_PUSH_REMOTE" ]]; then
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

# guard_push_targets — the branches the parsed push writes to, one a line: every local branch for
# --all or a `*` refspec, else each refspec's destination, `:` by guard_push_matching, or HEAD's
# branch when none names one. Returns 1 when they cannot be read.
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

# guard_note_switch — records the branch the `git switch` or `git checkout` in WORDS leaves its
# location on, `-` for --detach. A checkout's operand counts only alone and naming a local branch:
# `git checkout main -- a.txt` copies a path and stays put.
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

# guard_opts <letters> <long options> [<from>] — the git verb's options in WORDS from <from>,
# WORD_INDEX by default: OPT_FLAGS ` -x ` a letter and ` --name ` a long one, OPT_OPERANDS the rest.
# <letters> and <long options> take a value, so `--sort -refname` and the `x` of `-fb x` hold no flag.
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

# A pathspec's long magic, `:(top,glob)`, its parentheses \002 when the mask read them in a quote.
GUARD_PATHSPEC_MAGIC=$'^:[(\002]([^)\002]*)[)\002](.*)$'

# guard_whole_tree — 0 when guard_opts read a pathspec that names the whole tree: `.`, `*` or `**`
# behind any `./`, or `./` or the `:/` or `:(top)` magic alone. A `*` crosses `/` in git's own
# matching, not under `:(glob)`; `:(exclude)` and `:(literal)` reach none of them.
guard_whole_tree() {
  local word magic rest
  for word in ${OPT_OPERANDS[@]+"${OPT_OPERANDS[@]}"}; do
    magic="" rest=$word
    if [[ "$word" =~ $GUARD_PATHSPEC_MAGIC ]]; then
      magic=",${BASH_REMATCH[1]},"
      rest=${BASH_REMATCH[2]}
    elif [[ "$word" == :/* ]]; then
      magic=",top,"
      rest=${word#:/}
    fi
    [[ "$magic" == *,exclude,* || "$magic" == *,literal,* ]] && continue
    while [[ "$rest" == ./* ]]; do
      rest=${rest#./}
    done
    case "$rest" in
      . | '**') return 0 ;;
      '*') [[ "$magic" != *,glob,* ]] && return 0 ;;
      "") [[ "$magic" == *,top,* || "$word" == ./* ]] && return 0 ;;
    esac
  done
  return 1
}

# guard_protected <branch> — 0 when the resolved config lists it in guardrails.protectedBranches.
guard_protected() {
  [[ -n "$(jq -r --arg b "$1" '.guardrails.protectedBranches[] | select(. == $b)' <<<"$GUARD_CONFIG")" ]]
}

GUARD_BASE_REF=""

# guard_base_ref <dir> — GUARD_BASE_REF, origin's ref of baseBranch at <dir>, under `auto` the one
# refs/remotes/origin/HEAD names. Returns 1 when that names no commit here, the ref left empty when
# origin/HEAD named no branch of origin.
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

# guard_landed <dir> <base-ref> <branch> — 0 when the local <branch>'s work is on <base-ref>, landed
# as README.md#guards defines it. The patch-id is --verbatim, so whitespace counts. grep reads to the
# end: `grep -q` would cut the pipe, and pipefail fail it.
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

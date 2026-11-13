#!/bin/bash
# Refuses a check command whose output a later pipeline stage feeds to a filter: README.md#guards. The
# pipe drops the lines that explain a failure and, with pipefail off, turns the exit code green. A
# guardrail against agent habit, not a security boundary: a disguised spelling slips past.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
[[ "$GUARD_COMMAND" == *'|'* ]] || exit 0

guard_config_load "$GUARD_CWD" || exit 0
[[ "$(guard_config_get '.guardrails.filteredOutput')" == "allow" ]] && exit 0

FILTER_RE='^(head|tail|grep|egrep|fgrep|rg|sed|awk|less|more)$'
# The runners a package manager or an interpreter puts in front of a tool; the launcher table of
# lib-words.sh, which guard_unwrap_words reads, holds the shell's own.
RUNNERS=" pnpm yarn npm npx bunx exec dlx bundle uv poetry run -- "
# The options that take their value as the next word, before the verb: pnpm's and cargo's own.
PNPM_VALUE_OPTIONS=" --filter -F --dir -C "
CARGO_VALUE_OPTIONS=" --color "
DW_SDLC_RE='(^|[[:space:]/])dw-sdlc([[:space:]]+|/src/cli\.ts[[:space:]]+)(gate|check)([[:space:]]|$)'
LEAD=$' \t\003'

# stage_words <stage> — CORE_WORDS, the stage's words once its redirect's \003 and every launcher of
# the table are dropped.
CORE_WORDS=()
stage_words() {
  local stage="$1" word
  stage=${stage#"${stage%%[!$LEAD]*}"}
  WORDS=()
  while IFS= read -r word; do WORDS+=("$word"); done < <(guard_words "$stage")
  guard_unwrap_words
  CORE_WORDS=("${WORDS[@]+"${WORDS[@]}"}")
}

# stage_text <stage> — the stage as typed, launchers and path included, without its redirects; a quoted
# separator's \002 shown as `|`.
stage_text() {
  local word text="" stage="$1" skip=0
  local -a words
  stage=${stage#"${stage%%[!$LEAD]*}"}
  read -ra words <<<"$stage"
  for word in "${words[@]}"; do
    # A redirect is no part of the command: `2>&1`, `>out`, and `> out` with its target.
    if ((skip)); then
      skip=0
      continue
    fi
    if [[ "$word" =~ $GUARD_REDIRECT ]]; then
      [[ "$word" =~ $GUARD_REDIRECT_ALONE ]] && skip=1
      continue
    fi
    text+="${text:+ }${word//$'\002'/|}"
  done
  printf '%s' "$text"
}

# builtin_check — 0 when CORE_WORDS run a test runner, a type checker or a linter of the built-in list.
builtin_check() {
  local i=0 j word next after_pnpm=0
  # A runner's own option, `npx --no-install`, stands before the tool. pnpm's `--filter app` and the
  # like take the next word as their value.
  while ((i < ${#CORE_WORDS[@]})) && [[ "$RUNNERS" == *" ${CORE_WORDS[i]} "* || "${CORE_WORDS[i]}" == -?* ]]; do
    [[ "${CORE_WORDS[i]}" == pnpm ]] && after_pnpm=1
    if ((after_pnpm)) && [[ "$PNPM_VALUE_OPTIONS" == *" ${CORE_WORDS[i]} "* ]]; then
      i=$((i + 1))
    fi
    i=$((i + 1))
  done
  # `python -m pytest`: the module is the tool.
  if [[ "${CORE_WORDS[i]-}" == python || "${CORE_WORDS[i]-}" == python3 ]] && [[ "${CORE_WORDS[i + 1]-}" == -m ]]; then
    i=$((i + 2))
  fi
  ((i < ${#CORE_WORDS[@]})) || return 1
  word=${CORE_WORDS[i]##*/}
  next=${CORE_WORDS[i + 1]-}
  # cargo's toolchain, `cargo +nightly test`, and its options, `cargo --locked test`, stand between
  # the tool and its verb.
  if [[ "$word" == cargo ]]; then
    j=$((i + 1))
    while ((j < ${#CORE_WORDS[@]})) && [[ "${CORE_WORDS[j]}" == [+-]?* ]]; do
      [[ "$CARGO_VALUE_OPTIONS" == *" ${CORE_WORDS[j]} "* ]] && j=$((j + 1))
      j=$((j + 1))
    done
    next=${CORE_WORDS[j]-}
  fi
  case "$word" in
    vitest | jest | tsc | oxlint | eslint | rspec | rubocop | pytest) return 0 ;;
    vp) [[ "$next" == "check" ]] && return 0 ;;
    cargo | go) [[ "$next" == "test" ]] && return 0 ;;
  esac
  return 1
}

# The config's check commands: gate.command, each Step, each gate.checks.run command. A command that
# chains others stands for the first stage of each.
CONFIG_CHECKS=()
while IFS= read -r configured; do
  [[ -n "$configured" ]] || continue
  while IFS= read -r pipeline; do
    stage_words "${pipeline%%|*}"
    [[ ${#CORE_WORDS[@]} -gt 0 ]] && CONFIG_CHECKS+=("${CORE_WORDS[*]}")
  done < <(guard_pipelines "$(guard_mask_quoted_separators "$configured")")
done < <(guard_config_get '(.gate.command, (.gate.steps[]? | if type == "object" then .command else . end), .gate.checks.run[]?.command) | strings')

# is_check <stage> — 0 when the stage runs a check command; CORE_WORDS hold its words.
is_check() {
  local core check
  stage_words "$1"
  [[ ${#CORE_WORDS[@]} -gt 0 ]] || return 1
  core="${CORE_WORDS[*]}"
  for check in "${CONFIG_CHECKS[@]+"${CONFIG_CHECKS[@]}"}"; do
    [[ "$core" == "$check" || "$core" == "$check "* ]] && return 0
  done
  [[ "$core" =~ $DW_SDLC_RE ]] && return 0
  builtin_check
}

# filter_of <stage> — the filter the stage runs, if any.
filter_of() {
  local word
  stage_words "$1"
  word=${CORE_WORDS[0]-}
  word=${word##*/}
  [[ "$word" =~ $FILTER_RE ]] && printf '%s' "$word"
}

# A substitution's body is a command of its own, and a subshell's parenthesis ends nothing a pipe reads.
SCAN=$(guard_mask_quoted_separators "$(printf '%s\n' "$GUARD_COMMAND" | guard_strip_heredocs | guard_join_continuations)")
if [[ "$SCAN" == *'$('* || "$SCAN" == *'`'* ]]; then
  guard_lift_substitutions "$SCAN"
  SCAN=$GUARD_LIFTED
fi
SCAN=$(printf '%s' "$SCAN" | tr $'()\004\005' '\n\n\n\n')

while IFS= read -r pipeline; do
  [[ "$pipeline" == *'|'* ]] || continue
  IFS='|' read -ra stages <<<"$pipeline"
  check=""
  for stage in "${stages[@]}"; do
    if [[ -n "$check" ]]; then
      filter=$(filter_of "$stage")
      if [[ -n "$filter" ]]; then
        guard_block "'$check' is piped into '$filter'. The pipe hides the failure and the exit code: the pipeline reports the filter's status, so a red check reads green, and the lines that explain the failure are dropped. Run '$check' unpiped, or redirect it with '$check > <file> 2>&1' and read the file."
      fi
    elif is_check "$stage"; then
      check=$(stage_text "$stage")
    fi
  done
done < <(guard_pipelines "$SCAN")

exit 0

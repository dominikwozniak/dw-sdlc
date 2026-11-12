#!/bin/bash
# Refuses the credential hunting block-env-access.sh leaves, listed in README.md#guards: the stores
# that are not dotenv, the environment, a curl or wget carrying those or a dotenv file. Not every
# curl: a guard that refuses every network call gets unwired. Not a security boundary.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
COMMAND="$GUARD_COMMAND"

# Credential-ish name fragments, case-blind. No bare `key` (keyboard, keys()), and `auth` ends a word
# or meets a separator, so $AUTHOR passes. ERE has no lookahead, so that consumes a character: safe
# only while nothing in a regex below follows CRED_WORDS.
CRED_WORDS='(token|secret|password|passwd|passphrase|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization|auth([^A-Za-z]|$))'
# A credential-ish variable's expansion: `$S3_SECRET_KEY` and `${K8S_TOKEN}` hold a digit.
CRED_VAR="\\\$\{?[A-Za-z0-9_]*$CRED_WORDS"

# --- 1. the credential stores ---------------------------------------------------------------------

# is_cred_path <token> — 0 when a path COMPONENT is a credential directory or the basename is a
# credential file. Component-exact on purpose: a substring match reads docs/ssh-setup.md and
# scripts/.awsome as credential stores.
is_cred_path() {
  local tok="$1" comp
  case "${tok##*/}" in
    .netrc | .git-credentials | .pypirc | .pgpass) return 0 ;;
    # `.npmrc` has a legitimate project-local twin — committed registry config with no secret in
    # it — so only the user's own one counts: by path, or by name where a `cd` left the shell at
    # home. The siblings above are home-dir files by convention.
    .npmrc)
      case "$tok" in
        '~/'* | '$HOME/'* | '${HOME}/'* | /*) return 0 ;;
      esac
      [[ "${tok#./}" != */* && "${GUARD_SHELL_DIR%/}" == "${HOME%/}" ]] && return 0
      ;;
  esac
  # Split on `/` by newline substitution, never by an unquoted expansion: that also globs, so in a
  # directory holding .ssh the token `.*` expanded to it and `ls .*` was refused.
  while IFS= read -r comp; do
    case "$comp" in
      .ssh | .aws | .gnupg | .kube) return 0 ;;
    esac
  done <<<"${tok//\//$'\n'}"
  return 1
}

# The first line holds the command's own words, each line after it a substitution's or those of a
# quote handed to a shell. Each line starts at the payload's cwd, and a `cd` moves it for the
# commands after it.
STRIPPED=$(guard_strip_quoted "$COMMAND")

CRED_PATH_HIT=""
CRED_PATH_WHERE=""
WHERE=""
# Every name is_cred_path knows holds one of these, so a text without one has no token to read.
CRED_NAMES='\.(ssh|aws|gnupg|kube|netrc|git-credentials|pypirc|pgpass|npmrc)'
if [[ "$STRIPPED" =~ $CRED_NAMES ]]; then
  while IFS= read -r words; do
    GUARD_SHELL_DIR="$GUARD_CWD"
    GUARD_SCOPE_STACK=""
    GUARD_SCOPE_BACKTICK=0
    while IFS= read -r segment; do
      guard_scope_step "$segment" || continue
      while IFS= read -r token; do
        if is_cred_path "$token"; then
          CRED_PATH_HIT="$token"
          CRED_PATH_WHERE="$WHERE"
          break 3
        fi
      done < <(guard_tokens "$segment")
    done < <(guard_scopes "$words")
    WHERE=" in a command substitution or a quoted command, which the shell runs inside double quotes, an unquoted heredoc body and a quote handed to bash -c, eval or rtk run too"
  done <<<"$STRIPPED"
fi

# --- 2. hunting the environment -------------------------------------------------------------------
# A dump and a credential filter in one pipeline; `env; grep -rn password src/` passes, as its search
# never reads the dump.

# dumps_env <command> — 0 when the command, its launchers and redirections off, is a dump as
# README.md#guards lists them. `env` is a launcher to guard_unwrap_words, so a word no command spells
# marks the end: reached, the launchers ran nothing.
DUMP_END='%end%'
# guard_pipelines makes a redirect's `&` \003, guard_mask_quoted_separators a quoted separator \002.
REDIRECT_AMP=$'\003'
MASKED_SEP=$'\002'
REDIRECT="^[0-9]*[${REDIRECT_AMP}<>]"
REDIRECT_ALONE="^[0-9]*[${REDIRECT_AMP}<>]+$"
dumps_env() {
  local word skip=0 had_env=0
  local -a kept=()
  guard_read_words "$1"
  for word in "${WORDS[@]+"${WORDS[@]}"}"; do
    if ((skip)); then
      skip=0
      continue
    fi
    if [[ "$word" =~ $REDIRECT ]]; then
      # `2>&1` is one word, `> out` two.
      [[ "$word" =~ $REDIRECT_ALONE ]] && skip=1
      continue
    fi
    [[ "${word##*/}" == env ]] && had_env=1
    kept+=("$word")
  done
  WORDS=("${kept[@]+"${kept[@]}"}" "$DUMP_END")
  guard_unwrap_words
  case "${WORDS[0]:-}" in
    "$DUMP_END") ((had_env)) ;;
    printenv | set) [[ "${WORDS[1]:-}" == "$DUMP_END" ]] ;;
    export | declare | typeset)
      for word in "${WORDS[@]:1}"; do
        [[ "$word" == "$DUMP_END" ]] && return 0
        # `-f` and `-F` list functions, not variables.
        [[ "$word" == -* && "$word" != -*[fF]* ]] || return 1
      done
      return 1
      ;;
    *) return 1 ;;
  esac
}

# The command position is read on the masked text: a backtick or a `(` inside a quoted message is prose.
MASKED=$(guard_mask_quoted_separators "$COMMAND")
HUNT_FILTER="(grep|rg|ag|awk|sed|fgrep|egrep)[^;&|]*$CRED_WORDS"
env_hunt=0
# A hunt holds a dump's word and a filter's, the filter in any case; a text without them costs no grep.
# One pipeline per line, those filtered for a credential kept; each of its commands is read from the
# last `(`, `$(` or backtick that opens it to the first `)` or backtick that closes it.
case "$MASKED" in
  *env* | *set* | *export* | *declare*)
    case "$MASKED" in
      *[gG][rR][eE][pP]* | *[rR][gG]* | *[aA][gG]* | *[aA][wW][kK]* | *[sS][eE][dD]*)
        while IFS= read -r pipeline; do
          IFS='|' read -ra PARTS <<<"$pipeline"
          for part in "${PARTS[@]}"; do
            part=${part##*[\(\`]}
            part=${part%%[\)\`]*}
            if dumps_env "$part"; then
              env_hunt=1
              break 2
            fi
          done
        done < <(guard_pipelines "$MASKED" | grep -iE "$HUNT_FILTER")
        ;;
    esac
    ;;
esac
# Printing a credential-ish variable, each print README.md#guards lists. Referencing one is fine — gh
# wants $GITHUB_TOKEN and that is its job; putting the VALUE on stdout, where it lands in a
# transcript, is not.
PRINTS="${GUARD_BOUNDARY}((echo|printf|print)[^;&|]*$CRED_VAR|printenv[[:space:]][^;&|]*$CRED_WORDS|(cat|head|tail|tee)[^;&|]*<<<[[:space:]\"']*$CRED_VAR)"
INTERPRETER="${GUARD_BOUNDARY}(node|nodejs|deno|bun|python[0-9.]*|ruby|perl)[[:space:]][^;&|]*"
# `(` inside the quoted code is masked to \002. Ruby's ENV[…] and Perl's $ENV{…} keep their bracket:
# read case-blind, a bare ENV is any `env`, `require('./env').token` too.
ENV_READ="(process\\.env|os\\.environ|getenv|ENV\\[|ENV\\{)[^A-Za-z0-9_]{0,3}[A-Za-z0-9_]*$CRED_WORDS"
PRINT_CALL="([[:space:]]-p[[:space:]e]|[[:space:]]--print|console\\.(log|info|warn|error|dir)|process\\.std(out|err)\\.write|(^|[^A-Za-z0-9_.])(print|puts|say)[[:space:](${MASKED_SEP}])"
echo_secret=0
case "$MASKED" in
  *\$* | *printenv*)
    printf '%s' "$MASKED" | grep -qiE "$PRINTS" && echo_secret=1
    ;;
esac
case "$MASKED" in
  *node* | *deno* | *bun* | *python* | *ruby* | *perl*)
    # Read to the end, not with -q, so no grep exits while the one before it still writes.
    if ((!echo_secret)) && [[ -n "$(printf '%s' "$MASKED" | grep -oiE "$INTERPRETER" | grep -iE "$ENV_READ" | grep -iE "$PRINT_CALL")" ]]; then
      echo_secret=1
    fi
    ;;
esac

# --- 3. exfil ---------------------------------------------------------------------------------------
exfil=0
if [[ "$MASKED" == *curl* || "$MASKED" == *wget* ]] && printf '%s' "$MASKED" | grep -qE "${GUARD_BOUNDARY}(curl|wget)([[:space:]]|\$)"; then
  if [[ -n "$CRED_PATH_HIT" ]] ||
    printf '%s' "$COMMAND" | grep -qiE "$CRED_VAR" ||
    printf '%s' "$STRIPPED" | grep -qE '(^|[[:space:]=])[^[:space:]]*\.env([.[:space:]]|$)'; then
    exfil=1
  fi
fi

# Exfil first: it is a bare read plus a destination, and naming the destination is the more useful
# refusal.
if ((exfil)); then
  guard_block "this command sends a credential off the machine — a curl/wget carrying a secret file or variable. Nothing an agent does should need that."
fi
if [[ -n "$CRED_PATH_HIT" ]]; then
  guard_block "'$COMMAND' touches the credential store '$CRED_PATH_HIT'$CRED_PATH_WHERE. SSH keys, cloud credentials and .netrc are the user's, not the agent's, and reading one puts it in a transcript."
fi
if ((env_hunt)); then
  guard_block "'$COMMAND' searches the environment for credentials. Dumping the environment is fine; filtering it for a token, secret or key is a search, and the matches land in a transcript."
fi
if ((echo_secret)); then
  guard_block "'$COMMAND' prints a credential-ish variable's VALUE to stdout, where it lands in the transcript. Referencing the variable in the command that needs it is fine; printing it is not."
fi

exit 0

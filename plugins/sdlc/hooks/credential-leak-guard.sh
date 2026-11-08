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

# --- 1. the credential stores ---------------------------------------------------------------------

# is_cred_path <token> — 0 when a path COMPONENT is a credential directory or the basename is a
# credential file. Component-exact on purpose: a substring match reads docs/ssh-setup.md and
# scripts/.awsome as credential stores.
is_cred_path() {
  local tok="$1" comp
  case "${tok##*/}" in
    .netrc | .git-credentials | .pypirc | .pgpass) return 0 ;;
    # `.npmrc` has a legitimate project-local twin — committed registry config with no secret in
    # it — so only the user's own one counts. The siblings above are home-dir files by convention.
    .npmrc)
      case "$tok" in
        '~/'* | '$HOME/'* | /*) return 0 ;;
      esac
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
# quote handed to a shell.
STRIPPED=$(guard_strip_quoted "$COMMAND")

CRED_PATH_HIT=""
CRED_PATH_WHERE=""
WHERE=""
# Every name is_cred_path knows holds one of these, so a text without one has no token to read.
CRED_NAMES='\.(ssh|aws|gnupg|kube|netrc|git-credentials|pypirc|pgpass|npmrc)'
if [[ "$STRIPPED" =~ $CRED_NAMES ]]; then
  while IFS= read -r words; do
    while IFS= read -r token; do
      if is_cred_path "$token"; then
        CRED_PATH_HIT="$token"
        CRED_PATH_WHERE="$WHERE"
        break 2
      fi
    done < <(guard_tokens "$words")
    WHERE=" in a command substitution or a quoted command, which the shell runs inside double quotes, an unquoted heredoc body and a quote handed to bash -c, eval or rtk run too"
  done <<<"$STRIPPED"
fi

# --- 2. hunting the environment -------------------------------------------------------------------
# A dump and a credential filter in one pipeline; `env; grep -rn password src/` passes, as its search
# never reads the dump. Only a bare `set` dumps, not `set -e`; a `(` or a backtick opens a dump too.
ENV_DUMP='(^[[:space:]]*|[;&|(`][[:space:]]*)((env|printenv)([[:space:]]|$|[;&|)`])|export -p|declare -x|set[[:space:]]*($|[;&|)`]))'

# The command position is read on the masked text: a backtick or a `(` inside a quoted message is prose.
MASKED=$(guard_mask_quoted_separators "$COMMAND")
# One pipeline per line: the first grep keeps the dumps, the second those filtered for a credential.
# Read to the end, not with -q, so no grep exits while the one before it still writes.
env_hunt=0
HUNTS=$(guard_pipelines "$MASKED" | grep -E "$ENV_DUMP" | grep -iE "(grep|rg|ag|awk|sed|fgrep|egrep)[^;&|]*$CRED_WORDS")
[[ -n "$HUNTS" ]] && env_hunt=1
# Printing a credential-ish variable straight out. Referencing one is fine — gh wants $GITHUB_TOKEN
# and that is its job; putting the VALUE on stdout, where it lands in a transcript, is not.
echo_secret=0
if printf '%s' "$MASKED" | grep -qiE "${GUARD_BOUNDARY}(echo|printf|print)[^;&|]*\\\$\{?[A-Za-z_]*$CRED_WORDS"; then
  echo_secret=1
fi

# --- 3. exfil ---------------------------------------------------------------------------------------
exfil=0
if printf '%s' "$MASKED" | grep -qE "${GUARD_BOUNDARY}(curl|wget)([[:space:]]|\$)"; then
  if [[ -n "$CRED_PATH_HIT" ]] ||
    printf '%s' "$COMMAND" | grep -qiE "\\\$\{?[A-Za-z_]*$CRED_WORDS" ||
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

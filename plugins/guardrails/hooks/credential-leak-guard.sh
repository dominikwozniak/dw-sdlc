#!/bin/bash
# Refuses the three shapes of credential hunting that block-env-access.sh does not cover. Three
# things guard this ground and each leaves a different gap: block-env-access owns env files and
# nothing else; the CI secrets scan reads what was committed, long after the fact, and never sees a
# value that only passed through a shell. What is left, and what this guard owns:
#
#   1. the credential stores that are not dotenv — ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.netrc,
#      ~/.git-credentials, ~/.pypirc, ~/.pgpass, the user's ~/.npmrc
#   2. hunting the ENVIRONMENT: an env/printenv dump filtered for a credential-ish name, or echoing
#      such a variable straight out
#   3. exfil: curl or wget in the same command as a credential path, a credential-ish variable, or a
#      dotenv file
#
# Check 3 is deliberately not "no network calls": a guard that blocks every curl is unwired within a
# day; one that blocks a curl carrying a secret is one nobody argues with. Heredoc bodies and quoted
# prose — a quoted span holding whitespace — are dropped before the path check, while a quoted path
# such as `cat "$HOME/.ssh/id_rsa"` and a substitution the shell runs, in double quotes or an unquoted
# heredoc body, still count. Guardrail against agent accidents, not a security boundary. Runs
# always-on from bash-guard.sh.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
COMMAND="$GUARD_COMMAND"

# Credential-ish name fragments, case-blind, against a variable name or a grep pattern. A bare `key`
# is absent — it matches keyboard, keychain and keys() — and `auth` has to end the word (`$AUTH`,
# `$BASIC_AUTH`) or be followed by a separator (`$AUTH_TOKEN`), with `authorization` spelled out:
# a bare `auth` swallowed $AUTHOR, $AUTHORS and $AUTHOR_DATE, which is everyday git scripting. ERE
# has no negative lookahead, so "not followed by a letter" consumes that character, which is safe
# only because nothing in either regex below follows CRED_WORDS.
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

# --- 2. hunting the environment -------------------------------------------------------------------
# An env dump on its own is ordinary. Filtered for a credential name it is not a look, it is a
# search. The dump and the filter have to share a pipeline: `env; grep -rn password src/` dumps, then
# searches the source, and the search never reads the dump. `set` counts only with NO arguments, the
# spelling that dumps the environment: `set -e` and `set -euo pipefail` set shell options and dump
# nothing, and matching them would refuse `set -e && grep -rn "password" src/`, which is searching
# your own source for a field name. The alternatives end `($|[;&|)`])` rather than `$` so that
# `set | grep -i token` still matches. A `(` or a backtick opens a dump too: `$(env | grep -i token)`
# runs it, inside double quotes as well, and the mask leaves that substitution live.
ENV_DUMP='(^[[:space:]]*|[;&|(`][[:space:]]*)((env|printenv)([[:space:]]|$|[;&|)`])|export -p|declare -x|set[[:space:]]*($|[;&|)`]))'

env_hunt=0
while IFS= read -r pipeline; do
  if printf '%s' "$pipeline" | grep -qE "$ENV_DUMP" &&
    printf '%s' "$pipeline" | grep -qiE "(grep|rg|ag|awk|sed|fgrep|egrep)[^;&|]*$CRED_WORDS"; then
    env_hunt=1
    break
  fi
done < <(guard_pipelines "$(guard_mask_quoted_separators "$COMMAND")")
# The command position is read on the masked text: a backtick or a `(` inside a quoted message is prose.
MASKED=$(guard_mask_quoted_separators "$COMMAND")
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

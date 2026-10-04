#!/bin/bash
# PostToolUse Write — flags a file the agent just wrote that is far larger than anything a human
# maintains by hand. PostToolUse, so the write ALREADY HAPPENED and this cannot prevent it: measuring
# inside a PreToolUse hook means deciding on a string the model may still be streaming, and a limit
# that fires before the write has to be right the first time. After the fact the file is on disk
# with a real size, the check is exact, and exit 2 puts the number in front of the model while the
# decision to keep or delete it is still live.
#
# The threshold is bytes, and generous: a "you did not mean to do that" check — a pasted bundle, a
# base64 blob, a dumped log, generated output that belongs in .gitignore — not a style rule about
# file length. CLAUDE_MAX_WRITE_BYTES overrides it; 0 disables the guard without unwiring it. The
# one guard with a kill switch, because it is advisory and the bytes are already on disk.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# The payload is read in full before any early exit: returning early once left the writer on the
# other end of the pipe with SIGPIPE, an exit 141 the self-test caught only under load.
guard_read_payload "$@" || exit 0

DEFAULT_MAX_BYTES=262144 # 256 KiB
MAX_BYTES="${CLAUDE_MAX_WRITE_BYTES:-$DEFAULT_MAX_BYTES}"
case "$MAX_BYTES" in
  '' | *[!0-9]*) MAX_BYTES="$DEFAULT_MAX_BYTES" ;;
esac
[[ "$MAX_BYTES" -eq 0 ]] && exit 0

# Write only: an Edit changes part of a file that was already whatever size it was.
[[ "$GUARD_TOOL" == "Write" ]] || exit 0
[[ -n "$GUARD_FILE_PATH" && -f "$GUARD_FILE_PATH" ]] || exit 0

# `wc -c` rather than `stat`: the size flag is -c on GNU and -f%z on BSD.
size=$(wc -c <"$GUARD_FILE_PATH" 2>/dev/null | tr -d '[:space:]')
case "$size" in
  '' | *[!0-9]*) exit 0 ;;
esac

if [[ "$size" -gt "$MAX_BYTES" ]]; then
  {
    echo "LARGE WRITE: $GUARD_FILE_PATH is $size bytes, over the ${MAX_BYTES}-byte threshold."
    echo "Nothing maintained by hand reaches that size, so this is usually a pasted bundle, a base64 blob,"
    echo "a dumped log, or generated output that belongs in .gitignore rather than in the tree. The file"
    echo "is already written — check it is what you meant, and delete it if it is not."
    echo "If a file this size is genuinely right here, raise or disable the threshold with"
    echo "CLAUDE_MAX_WRITE_BYTES (0 disables). Flagged by the guardrails plugin."
  } >&2
  exit 2
fi

exit 0

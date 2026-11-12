#!/bin/bash
# PostToolUse Write — flags a file over the threshold once it is on disk: README.md#guards. After
# the write, so the size is exact and not read off text the model may still be streaming; exit 2
# puts it before the model while keeping or deleting the file is still its call.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

# The payload is read in full before any early exit: returning early once left the writer on the
# other end of the pipe with SIGPIPE, an exit 141 the self-test caught only under load.
guard_read_file_payload large-file-guard.sh "The size of the file just written was not checked." "$@" || exit 0

DEFAULT_MAX_BYTES=262144 # 256 KiB
MAX_BYTES="${CLAUDE_MAX_WRITE_BYTES:-$DEFAULT_MAX_BYTES}"
case "$MAX_BYTES" in
  '' | *[!0-9]*) MAX_BYTES="$DEFAULT_MAX_BYTES" ;;
esac
[[ "$MAX_BYTES" -eq 0 ]] && exit 0

# Write only: an Edit changes part of a file that was already whatever size it was.
[[ "$GUARD_TOOL" == "Write" ]] || exit 0
[[ -n "$GUARD_FILE_PATH" ]] || exit 0
GUARD_FILE_PATH=$(guard_absolute "$GUARD_FILE_PATH")
[[ -f "$GUARD_FILE_PATH" ]] || exit 0

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
    echo "CLAUDE_MAX_WRITE_BYTES (0 disables). Flagged by the sdlc plugin."
  } >&2
  exit 2
fi

exit 0

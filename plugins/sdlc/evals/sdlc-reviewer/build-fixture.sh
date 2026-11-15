#!/usr/bin/env bash
# Builds the sdlc-reviewer fixture as a git repository and prints its path.
# Usage: build-fixture.sh [<dir>]  (<dir> new or empty; default a temporary directory)
# Branch `base` holds fixture/base/; each fixture/cases/<n>-<name>/ is one commit on it.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
dest=${1:-$(mktemp -d)}

if [ -e "$dest" ] && [ -n "$(ls -A "$dest")" ]; then
  echo "build-fixture: $dest exists and is not empty" >&2
  exit 2
fi
mkdir -p "$dest"
dest=$(cd "$dest" && pwd)

# The repository stands alone: no remote, no hooks, no signing, and the installed sdlc plugin off, so
# a run with --plugin-dir measures the tree and not the installed copy.
export GIT_AUTHOR_NAME="eval" GIT_AUTHOR_EMAIL="eval@example.invalid"
export GIT_COMMITTER_NAME="eval" GIT_COMMITTER_EMAIL="eval@example.invalid"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

git init --quiet --initial-branch=base "$dest"
cd "$dest"
git config core.hooksPath /dev/null
git config commit.gpgsign false

cp -R "$here/fixture/base/." .
ln -s AGENTS.md CLAUDE.md
git add -A
git commit --quiet -m "chore: add shop-kit"

for case_dir in "$here"/fixture/cases/*/; do
  name=$(basename "$case_dir")
  git switch --quiet -c "case-$name" base
  cp -R "$case_dir." .
  git add -A
  git commit --quiet -m "case $name"
done
git switch --quiet base

mkdir -p .claude
printf '%s\n' '{"enabledPlugins": {"sdlc@dw-sdlc": false}}' >.claude/settings.local.json
printf '%s\n' '.claude/' >>.git/info/exclude

printf '%s\n' "$dest"

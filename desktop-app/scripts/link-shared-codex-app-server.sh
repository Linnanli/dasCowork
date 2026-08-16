#!/bin/sh

set -eu

if [ -n "${CODEX_APP_SERVER_BIN:-}" ]; then
  exit 0
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
desktop_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
repository_root=$(CDPATH= cd -- "$desktop_root/.." && pwd -P)

git_dir=$(git -C "$repository_root" rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0
git_common_dir=$(git -C "$repository_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0

# The main worktree uses the common Git directory directly. Linked worktrees
# have their own directory under <main>/.git/worktrees/ instead.
if [ "$git_dir" = "$git_common_dir" ]; then
  exit 0
fi

main_worktree=$(git -C "$repository_root" worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }')
if [ -z "$main_worktree" ]; then
  exit 0
fi

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) binary_name='codex-app-server.exe' ;;
  *) binary_name='codex-app-server' ;;
esac

source_binary="$main_worktree/codex/codex-rs/target/release/$binary_name"
target_dir="$desktop_root/.bundle-resources/codex-app-server"
target_link="$target_dir/$binary_name"

if [ ! -x "$source_binary" ]; then
  echo "Shared Codex app-server was not found at $source_binary; using the normal development fallback."
  exit 0
fi

mkdir -p "$target_dir"

# Preserve a locally built binary in this worktree. A previous shared link is
# safe to refresh, including a dangling link after the main worktree is moved.
if [ -e "$target_link" ] && [ ! -L "$target_link" ]; then
  echo "Using this worktree's existing Codex app-server at $target_link."
  exit 0
fi

ln -sfn "$source_binary" "$target_link"
echo "Linked Codex app-server from the main worktree."

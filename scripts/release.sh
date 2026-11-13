#!/usr/bin/env bash
# Cuts a release: bumps @linemap/core and @linemap/cli to the same version, commits, tags and pushes.
# The tag push starts .github/workflows/release.yml, which tests and publishes to npm.
#   pnpm release patch|minor|major|<x.y.z>
set -euo pipefail
cd "$(dirname "$0")/.."
version() { node -p "require('./packages/$1/package.json').version"; }

versions() {
  for dir in core cli; do
    printf '  @linemap/%-5s local %-8s npm %s\n' "$dir" "$(version "$dir")" \
      "$(npm view "@linemap/$dir" version 2>/dev/null || echo '?')"
  done
  printf '  last tag             %s\n' "$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo none)"
}

fail() { echo "release: $*" >&2; versions >&2; exit 1; }

[ $# -eq 1 ] || fail "usage: pnpm release patch|minor|major|<x.y.z>"
current=$(version core)
[ "$(version cli)" = "$current" ] || fail "packages/cli is $(version cli), core is $current"

# release only what is on master, committed and pushed
[ "$(git branch --show-current)" = master ] || fail "not on master"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
git fetch --quiet --tags origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || fail "master and origin/master differ, pull or push first"

# npm works out patch/minor/major and validates x.y.z
next=$(cd packages/core && npm version "$1" --no-git-tag-version) || { git checkout -- packages; fail "bad version \"$1\""; }
next=${next#v}
git checkout -- packages # bumped for real below, after the confirmation
[ "$(printf '%s\n' "$current" "$next" | sort -V | tail -1)" = "$next" ] || fail "$next is not newer than $current"
tag=v$next
[ -z "$(git tag --list "$tag")" ] || fail "tag $tag already exists"

last=$(git describe --tags --abbrev=0 --match 'v*')
echo "$current -> $next, changes since $last:"
git --no-pager log --oneline "$last..HEAD"
read -rp $'\n'"Commit \"release $next\", tag $tag and push? [y/N] " answer
[ "$answer" = y ] || fail "aborted"

for dir in core cli; do (cd "packages/$dir" && npm version "$next" --no-git-tag-version >/dev/null); done
git commit --quiet -m "release $next" packages/core/package.json packages/cli/package.json
git tag "$tag"
git push --atomic origin master "$tag" # master and the tag land together, or neither does

echo "pushed $tag; publishing: https://github.com/mergezalot/linemap/actions/workflows/release.yml"

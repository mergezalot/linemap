#!/usr/bin/env bash
# Cuts a release: bumps @linemap/core, @linemap/studio and @linemap/cli to the same version, commits, tags and pushes.
# The annotated tag carries the release notes: the commit subjects since the previous v* tag.
# The tag push starts .github/workflows/release.yml, which tests and publishes to npm.
#   pnpm release patch|minor|major|<x.y.z>
# Plain bash with git, sed, grep and curl; no node.
set -euo pipefail
cd "$(dirname "$0")/.."

packages=(core studio cli)
# the top-level "version" line as npm and pnpm write package.json: two-space indent, so never a nested key
version_line='^  "version": "([^"]*)"(,?)$'
# x.y.z with an optional -prerelease and no leading zeros (semver without build metadata)
semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'

# prints the version of packages/$1; fails unless its package.json has exactly one top-level "version" line
version() {
  local file=packages/$1/package.json count
  count=$(grep -cE "$version_line" "$file") || true
  [ "$count" = 1 ] || { echo "release: $file: expected 1 top-level \"version\" line, found ${count:-none}" >&2; return 1; }
  sed -nE "s/$version_line/\1/p" "$file"
}

# sets the top-level "version" of packages/$1 to $2 and leaves every other byte alone
# (the || returns are needed: set -e is off inside a function called with ||)
set_version() {
  local file=packages/$1/package.json
  version "$1" >/dev/null || return 1
  sed -E "s/$version_line/  \"version\": \"$2\"\2/" "$file" >"$file.tmp" || return 1
  mv "$file.tmp" "$file" || return 1
  [ "$(version "$1")" = "$2" ] || { echo "release: $file: version is not $2 after the edit" >&2; return 1; }
}

# latest version of @linemap/$1 on npm, ? when the registry can't be reached
npm_version() {
  local v
  v=$(curl -fsS --max-time 5 "https://registry.npmjs.org/@linemap%2f$1/latest" 2>/dev/null |
    grep -m1 -oE '"version":"[^"]*"' | cut -d'"' -f4) || v=
  echo "${v:-?}"
}

versions() {
  for dir in "${packages[@]}"; do
    printf '  @linemap/%-6s local %-8s npm %s\n' "$dir" "$(version "$dir" 2>/dev/null || echo '?')" "$(npm_version "$dir")"
  done
  printf '  last tag              %s\n' "$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo none)"
}

# whether version $1 comes after $2: x.y.z first, then a release after its own prereleases (1.0.0-rc.1 < 1.0.0)
newer() {
  local a=${1%%-*} b=${2%%-*}
  if [ "$a" != "$b" ]; then [ "$(printf '%s\n' "$a" "$b" | sort -V | tail -1)" = "$a" ]; return; fi
  [[ $2 == *-* ]] || return 1
  [[ $1 != *-* ]] || [ "$(printf '%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]
}

fail() { echo "release: $*" >&2; versions >&2; exit 1; }

[ $# -eq 1 ] || fail "usage: pnpm release patch|minor|major|<x.y.z>"
current=$(version core) || fail "can't read the version of packages/core"
for dir in studio cli; do
  v=$(version "$dir") || fail "can't read the version of packages/$dir"
  [ "$v" = "$current" ] || fail "packages/$dir is $v, core is $current"
done

# release only what is on master, committed and pushed
[ "$(git branch --show-current)" = master ] || fail "not on master"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
git fetch --quiet --tags origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || fail "master and origin/master differ, pull or push first"

# patch|minor|major count like npm version: on a prerelease, the bump first just drops the -pre
[[ $current =~ $semver ]] || fail "packages/core version $current is not x.y.z"
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]} pre=${BASH_REMATCH[4]}
case $1 in
  major) if [ -n "$pre" ] && [ "$minor.$patch" = 0.0 ]; then next=$major.0.0; else next=$((major + 1)).0.0; fi ;;
  minor) if [ -n "$pre" ] && [ "$patch" = 0 ]; then next=$major.$minor.0; else next=$major.$((minor + 1)).0; fi ;;
  patch) if [ -n "$pre" ]; then next=$major.$minor.$patch; else next=$major.$minor.$((patch + 1)); fi ;;
  *) next=${1#v}; [[ $next =~ $semver ]] || fail "bad version \"$1\"" ;;
esac
[ "$next" != "$current" ] || fail "$current is already the version"
newer "$next" "$current" || fail "$next is not newer than $current"
tag=v$next
[ -z "$(git tag --list "$tag")" ] || fail "tag $tag already exists"

# release notes: commit subjects since the last release tag, newest first, without merges and release commits;
# they become the message of the annotated tag, which release.yml turns into the GitHub release
if last=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null); then range=$last..HEAD; else last="the first commit" range=HEAD; fi
log=$(git log --no-merges --format='- %s' "$range") || fail "can't read the commits since $last"
notes=$(grep -vE '^- release [0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' <<<"$log" || true)
echo "$current -> $next, release notes (changes since $last):"
echo "${notes:-  (no commits)}"
read -rp $'\n'"Commit \"release $next\", tag $tag and push? [y/N] " answer
[ "$answer" = y ] || fail "aborted"

for dir in "${packages[@]}"; do
  set_version "$dir" "$next" || { git checkout -- packages; rm -f packages/*/package.json.tmp; fail "bump failed"; }
done
git commit --quiet -m "release $next" packages/core/package.json packages/studio/package.json packages/cli/package.json
printf 'release %s\n\n%s\n' "$next" "$notes" | git tag --annotate --cleanup=whitespace --file=- "$tag"
git push --atomic origin master "$tag" # master and the tag land together, or neither does

echo "pushed $tag; publishing: https://github.com/mergezalot/linemap/actions/workflows/release.yml"

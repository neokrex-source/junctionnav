#!/usr/bin/env bash
# Publishes a folder as the one commit of a branch in the public site repository, where the
# website (gh-pages), the front page (main) and the traffic news (traffic-news) live when the
# source repository is private. Used by the workflows:
#
#   scripts/site/publish.sh <folder> <branch> "<commit message>"
#
# SITE_REPO    owner/name of the public repository (default neokrex-source/junctionnav)
# SITE_TOKEN   a token that may write to it (a fine-grained token with Contents: Read and write,
#              kept as the SITE_TOKEN secret); when the site is this repository itself, the
#              workflow's own GITHUB_TOKEN does
# SITE_REMOTE  another git address instead (for testing; no token then)
#
# The branch's previous commit is fetched without its files first, so files that did not change
# (the offline maps, the places) are not sent again.
set -euo pipefail
DIR="$(cd "$1" && pwd)"
BRANCH="$2"
MSG="$3"
REPO="${SITE_REPO:-neokrex-source/junctionnav}"
REMOTE="${SITE_REMOTE:-https://github.com/${REPO}.git}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$WORK" init -q
git -C "$WORK" remote add origin "$REMOTE"
if [ -z "${SITE_REMOTE:-}" ]; then
  TOKEN="${SITE_TOKEN:-}"
  SELF="${GITHUB_REPOSITORY:-}"
  if [ -z "$TOKEN" ] && [ "${REPO,,}" = "${SELF,,}" ]; then TOKEN="${GITHUB_TOKEN:-}"; fi
  if [ -z "$TOKEN" ]; then
    echo "::error title=Cannot publish::The SITE_TOKEN secret is not set, so nothing can be written to ${REPO}. See Publishing in the README."
    exit 1
  fi
  # The token as a header (as actions/checkout does), never in an address that could be logged.
  echo "::add-mask::${TOKEN}"
  git -C "$WORK" config http.https://github.com/.extraheader "AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)"
fi
git -C "$WORK" config remote.origin.promisor true
git -C "$WORK" config remote.origin.partialclonefilter blob:none
if git -C "$WORK" fetch -q --depth 1 --filter=blob:none origin "$BRANCH" 2>/dev/null; then
  echo "Updating ${BRANCH} on ${REPO}"
else
  echo "Starting ${BRANCH} on ${REPO}"
fi
git -C "$WORK" --work-tree="$DIR" add -A
git -C "$WORK" --work-tree="$DIR" -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -q -m "$MSG"
git -C "$WORK" -c push.negotiate=false push -q -f origin "HEAD:refs/heads/${BRANCH}"
echo "Published $(du -sh "$DIR" | cut -f1) to ${REPO} (${BRANCH})"

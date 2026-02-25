#!/usr/bin/env bash

set -euo pipefail

# Ensure integration tests reflect current TypeScript sources.
npm run --silent test:compile-client

export CODE_TESTS_PATH="$(pwd)/client/out/test"
export CODE_TESTS_WORKSPACE="$(pwd)/client/testFixture"

NOISE_FILTER='dbus/bus\.cc:408|dbus/object_proxy\.cc:573|viz_main_impl\.cc:189|command_buffer_proxy_impl\.cc:128|\[DEP0040\]|--trace-deprecation'
node "$(pwd)/client/out/test/runTest" \
  2> >(grep -E -v "$NOISE_FILTER" >&2 || true)

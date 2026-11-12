#!/usr/bin/env bash
#
# Behavioural tests for install.sh and uninstall.sh.
#
# All side-effecting commands are replaced with fakes, so the real extension,
# GNOME proxy settings, and /etc are never touched.

set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/torshell-script-tests.XXXXXX")
trap 'rm -rf -- "$TMP"' EXIT

BIN="$TMP/bin"
DATA_HOME="$TMP/data"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/TorShell@itepo.mx"
CALLS="$TMP/calls.log"
mkdir -p "$BIN" "$DATA_HOME/gnome-shell/extensions" "$TMP/tmpdir"
: > "$CALLS"

export XDG_DATA_HOME="$DATA_HOME"
export TMPDIR="$TMP/tmpdir"
export CALLS
export PATH="$BIN:$PATH"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_contains() {
    grep -Fq -- "$1" "$CALLS" || fail "expected call not found: $1"
}

assert_not_contains() {
    if grep -Fq -- "$1" "$CALLS"; then
        fail "unexpected call found: $1"
    fi
}

assert_file() {
    [ -f "$1" ] || fail "expected file: $1"
}

assert_no_file() {
    [ ! -e "$1" ] || fail "unexpected file: $1"
}

cat > "$BIN/gnome-extensions" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'gnome-extensions %s\n' "$*" >> "$CALLS"
case "${1:-}" in
    install)
        mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/TorShell@itepo.mx/schemas"
        ;;
    uninstall)
        if [ "${FAKE_SKIP_UNINSTALL:-0}" != '1' ]; then
            rm -rf -- "$XDG_DATA_HOME/gnome-shell/extensions/${2:-}"
        fi
        ;;
    enable)
        if [ "${FAKE_FAIL_ENABLE:-0}" = '1' ]; then
            exit 1
        fi
        ;;
esac
EOF

cat > "$BIN/gsettings" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'gsettings %s\n' "$*" >> "$CALLS"

args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
    case "${args[$i]}" in
        --schemadir)
            i=$((i + 2))
            ;;
        *)
            break
            ;;
    esac
done

command=${args[$i]:-}
schema=${args[$((i + 1))]:-}
key=${args[$((i + 2))]:-}

if [ "$command" = 'get' ]; then
    case "$schema $key" in
        'org.gnome.system.proxy mode')
            printf "%s\n" "${FAKE_PROXY_MODE:-'manual'}"
            ;;
        'org.gnome.system.proxy.socks host')
            printf "%s\n" "${FAKE_SOCKS_HOST:-'127.0.0.1'}"
            ;;
        'org.gnome.system.proxy.socks port')
            printf '%s\n' "${FAKE_SOCKS_PORT:-9050}"
            ;;
        'org.gnome.shell.extensions.torshell socks-port')
            printf '%s\n' "${FAKE_TOR_SOCKS_PORT:-9050}"
            ;;
        *)
            printf '\n'
            ;;
    esac
fi
EOF

cat > "$BIN/pkexec" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'pkexec %s\n' "$*" >> "$CALLS"
exec "$@"
EOF

cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "$CALLS"

output=''
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o)
            output=$2
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

[ -n "$output" ] || exit 1
printf 'fake extension bundle\n' > "$output"
EOF

chmod +x "$BIN"/*

# ---------------------------------------------------------------------------
# install.sh: local bundle next to the script
# ---------------------------------------------------------------------------

CHECKOUT="$TMP/checkout"
mkdir -p "$CHECKOUT"
cp "$REPO_ROOT/install.sh" "$CHECKOUT/install.sh"
printf 'fake extension bundle\n' > "$CHECKOUT/TorShell@itepo.mx.shell-extension.zip"

: > "$CALLS"
bash "$CHECKOUT/install.sh" > "$TMP/install-local.out" 2>&1
assert_contains "gnome-extensions install --force $CHECKOUT/TorShell@itepo.mx.shell-extension.zip"
assert_contains 'gnome-extensions enable TorShell@itepo.mx'
assert_not_contains 'curl '
[ -d "$EXT_DIR" ] || fail 'install did not create the extension directory'

# A Shell that cannot enable the extension yet must not make the install fail.
: > "$CALLS"
FAKE_FAIL_ENABLE=1 bash "$CHECKOUT/install.sh" > "$TMP/install-enable.out" 2>&1
grep -Fq 'could not be enabled automatically' "$TMP/install-enable.out" ||
    fail 'install did not warn about a failed enable'

# ---------------------------------------------------------------------------
# install.sh: TORSSHELL_ZIP override
# ---------------------------------------------------------------------------

CUSTOM_ZIP="$TMP/custom.zip"
printf 'fake extension bundle\n' > "$CUSTOM_ZIP"
NOLOCAL="$TMP/nolocal"
mkdir -p "$NOLOCAL"
cp "$REPO_ROOT/install.sh" "$NOLOCAL/install.sh"

: > "$CALLS"
TORSSHELL_ZIP="$CUSTOM_ZIP" bash "$NOLOCAL/install.sh" > "$TMP/install-override.out" 2>&1
assert_contains "gnome-extensions install --force $CUSTOM_ZIP"
assert_not_contains 'curl '

# ---------------------------------------------------------------------------
# install.sh: missing TORSSHELL_ZIP fails clearly
# ---------------------------------------------------------------------------

: > "$CALLS"
if TORSSHELL_ZIP="$TMP/missing.zip" bash "$NOLOCAL/install.sh" \
    > "$TMP/install-missing.out" 2>&1; then
    fail 'install accepted a missing TORSSHELL_ZIP'
fi
grep -Fq 'TORSSHELL_ZIP does not exist' "$TMP/install-missing.out" ||
    fail 'missing TORSSHELL_ZIP did not produce a clear error'

# ---------------------------------------------------------------------------
# install.sh: downloads the latest release when no local bundle exists
# ---------------------------------------------------------------------------

: > "$CALLS"
bash "$NOLOCAL/install.sh" > "$TMP/install-download.out" 2>&1
assert_contains 'curl -fL'
assert_contains 'https://github.com/rramirezacosta/torshell/releases/latest/download/TorShell@itepo.mx.shell-extension.zip'
assert_contains 'gnome-extensions install --force '
[ -d "$EXT_DIR" ] || fail 'downloaded install did not create the extension directory'

# ---------------------------------------------------------------------------
# uninstall.sh: disable, uninstall, proxy reset, polkit cleanup
# ---------------------------------------------------------------------------

mkdir -p "$EXT_DIR/schemas"
RULE="$TMP/50-torshell.rules"
printf '// test rule\n' > "$RULE"

: > "$CALLS"
TORSSHELL_POLKIT_RULE="$RULE" bash "$REPO_ROOT/uninstall.sh" \
    > "$TMP/uninstall.out" 2>&1
assert_contains 'gnome-extensions disable TorShell@itepo.mx'
assert_contains 'gnome-extensions uninstall TorShell@itepo.mx'
assert_contains 'gsettings set org.gnome.system.proxy mode none'
assert_contains "pkexec rm -f -- $RULE"
assert_no_file "$RULE"
[ ! -d "$EXT_DIR" ] || fail 'uninstall left the extension directory behind'

# ---------------------------------------------------------------------------
# uninstall.sh: removes the directory even if gnome-extensions cannot
# ---------------------------------------------------------------------------

mkdir -p "$EXT_DIR/schemas"
: > "$CALLS"
FAKE_SKIP_UNINSTALL=1 FAKE_PROXY_MODE="'none'" TORSSHELL_POLKIT_RULE="$TMP/missing.rules" \
    bash "$REPO_ROOT/uninstall.sh" > "$TMP/uninstall-fallback.out" 2>&1
[ ! -d "$EXT_DIR" ] || fail 'uninstall fallback did not remove the extension directory'

# ---------------------------------------------------------------------------
# uninstall.sh: leaves a non-Tor proxy configuration alone
# ---------------------------------------------------------------------------

mkdir -p "$EXT_DIR/schemas"
: > "$CALLS"
FAKE_PROXY_MODE="'auto'" TORSSHELL_POLKIT_RULE="$TMP/missing.rules" \
    bash "$REPO_ROOT/uninstall.sh" > "$TMP/uninstall-auto.out" 2>&1
assert_not_contains 'gsettings set org.gnome.system.proxy mode none'

mkdir -p "$EXT_DIR/schemas"
: > "$CALLS"
FAKE_PROXY_MODE="'manual'" FAKE_SOCKS_PORT=8080 TORSSHELL_POLKIT_RULE="$TMP/missing.rules" \
    bash "$REPO_ROOT/uninstall.sh" > "$TMP/uninstall-port.out" 2>&1
assert_not_contains 'gsettings set org.gnome.system.proxy mode none'

# ---------------------------------------------------------------------------
# uninstall.sh: idempotent when nothing is installed
# ---------------------------------------------------------------------------

: > "$CALLS"
FAKE_PROXY_MODE="'none'" TORSSHELL_POLKIT_RULE="$TMP/missing.rules" \
    bash "$REPO_ROOT/uninstall.sh" > "$TMP/uninstall-idempotent.out" 2>&1
assert_no_file "$EXT_DIR"

printf 'install/uninstall scripts: OK\n'

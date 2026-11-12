#!/usr/bin/env bash
#
# Install TorShell for the current user.
#
# Source of the extension bundle, in order of precedence:
#   1. TORSSHELL_ZIP (path to an existing .shell-extension.zip)
#   2. TorShell@itepo.mx.shell-extension.zip next to this script
#   3. The latest GitHub release
#
# Run as your desktop user, not as root.

set -euo pipefail

UUID='TorShell@itepo.mx'
ZIP_NAME="$UUID.shell-extension.zip"
RELEASE_URL="https://github.com/rramirezacosta/torshell/releases/latest/download/$ZIP_NAME"

info() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
    die "run this script as your desktop user, not as root."
fi

if ! command -v gnome-extensions >/dev/null 2>&1; then
    die "'gnome-extensions' was not found. Install the GNOME Shell utilities and try again."
fi

SCRIPT_DIR=''
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fi

TMP_DIR=''
cleanup() {
    if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
        rm -rf -- "$TMP_DIR"
    fi
}
trap cleanup EXIT

download_zip() {
    local destination=$1

    if command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 --progress-bar -o "$destination" "$RELEASE_URL"
    elif command -v wget >/dev/null 2>&1; then
        wget -q --show-progress -O "$destination" "$RELEASE_URL"
    else
        die "neither 'curl' nor 'wget' is available to download the release."
    fi
}

ZIP=''
if [ -n "${TORSSHELL_ZIP:-}" ]; then
    [ -f "$TORSSHELL_ZIP" ] || die "TORSSHELL_ZIP does not exist: $TORSSHELL_ZIP"
    ZIP=$TORSSHELL_ZIP
    info "Using bundle from TORSSHELL_ZIP: $ZIP"
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$ZIP_NAME" ]; then
    ZIP="$SCRIPT_DIR/$ZIP_NAME"
    info "Using local bundle: $ZIP"
else
    TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/torshell-install.XXXXXX")
    ZIP="$TMP_DIR/$ZIP_NAME"
    info "Downloading the latest TorShell release…"
    if ! download_zip "$ZIP"; then
        die "could not download $RELEASE_URL.
No release may be published yet. Build the bundle from a checkout with
'make pack' and run:

    TORSSHELL_ZIP=$PWD/$ZIP_NAME $0"
    fi
fi

info "Installing $UUID…"
gnome-extensions install --force "$ZIP"

if gnome-extensions enable "$UUID"; then
    info "TorShell is installed and enabled."
else
    warn "TorShell was installed but could not be enabled automatically."
    warn "Enable it from the Extensions app or run: gnome-extensions enable $UUID"
fi

cat <<EOF

TorShell $UUID is installed.

To finish loading it:
  • Wayland: log out and back in.
  • X11: press Alt+F2, type "r", then press Enter.

If the extension does not appear, check:
    gnome-extensions info $UUID
    journalctl -f -o cat /usr/bin/gnome-shell

Configure it with:
    gnome-extensions prefs $UUID
EOF

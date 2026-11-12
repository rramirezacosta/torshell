#!/usr/bin/env bash
#
# Uninstall TorShell for the current user and clean up what it changed.
#
# Run as your desktop user, not as root.

set -euo pipefail

UUID='TorShell@itepo.mx'
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"
POLKIT_RULE="${TORSSHELL_POLKIT_RULE:-/etc/polkit-1/rules.d/50-torshell.rules}"

info() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }

if [ "$(id -u)" -eq 0 ]; then
    printf 'Error: run this script as your desktop user, not as root.\n' >&2
    exit 1
fi

# Read the configured SOCKS port while the extension schema is still installed.
read_tor_socks_port() {
    local port=9050
    local value=''

    if command -v gsettings >/dev/null 2>&1 && [ -d "$EXT_DIR/schemas" ]; then
        value=$(gsettings --schemadir "$EXT_DIR/schemas" get \
            org.gnome.shell.extensions.torshell socks-port 2>/dev/null || true)
        value=${value#uint32 }
        case "$value" in
            ''|*[!0-9]*) ;;
            *) port=$value ;;
        esac
    fi

    printf '%s\n' "$port"
}

# Only touch the proxy when it still looks like the configuration TorShell
# applies. Disabling the extension normally restores the user's snapshot first.
reset_proxy_if_ours() {
    local expected_port=$1
    local mode=''
    local host=''
    local port=''

    command -v gsettings >/dev/null 2>&1 || return 0

    mode=$(gsettings get org.gnome.system.proxy mode 2>/dev/null || true)
    host=$(gsettings get org.gnome.system.proxy.socks host 2>/dev/null || true)
    port=$(gsettings get org.gnome.system.proxy.socks port 2>/dev/null || true)

    if [ "$mode" = "'manual'" ] && [ "$host" = "'127.0.0.1'" ] && [ "$port" = "$expected_port" ]; then
        gsettings set org.gnome.system.proxy mode 'none'
        info "Reset the GNOME proxy mode to 'none'."
    fi
}

TOR_SOCKS_PORT=$(read_tor_socks_port)

if command -v gnome-extensions >/dev/null 2>&1; then
    # disable() restores the proxy snapshot when the Shell is running.
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    gnome-extensions uninstall "$UUID" >/dev/null 2>&1 || true
fi

if [ -d "$EXT_DIR" ]; then
    rm -rf -- "$EXT_DIR"
fi

reset_proxy_if_ours "$TOR_SOCKS_PORT"

if [ -e "$POLKIT_RULE" ]; then
    if command -v pkexec >/dev/null 2>&1; then
        if pkexec rm -f -- "$POLKIT_RULE"; then
            info "Removed the passwordless polkit rule."
        else
            warn "could not remove $POLKIT_RULE; remove it with: sudo rm -f $POLKIT_RULE"
        fi
    else
        warn "remove the passwordless polkit rule with: sudo rm -f $POLKIT_RULE"
    fi
fi

info "TorShell $UUID was uninstalled."

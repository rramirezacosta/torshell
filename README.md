# TorShell

TorShell is a GNOME Shell extension that starts and stops the Tor daemon from
the top bar and points GNOME's proxy settings at Tor while it is running.

![TorShell inactive](screenshots/tor_desactivado.png)
![TorShell active](screenshots/tor_activado.png)

## Features

- Top-bar onion button that shows whether Tor is active and opens a menu with
  the current state and the time Tor became active.
- Start/stop switch, **New Tor identity** (when the control port is available),
  **Check connection**, and **Preferences** in the popup menu.
- Optional Quick Settings toggle, as an alternative to the top-bar button.
- Preferences window (libadwaita) for the systemd unit, proxy, panel, control
  port, and passwordless polkit settings.
- Tor state is watched over systemd's D-Bus API; the Shell is never blocked by
  polling or synchronous subprocesses.
- Non-destructive proxy handling: the previous GNOME proxy configuration is
  snapshotted and restored when Tor stops or the extension is disabled.
- Optional auto-start of Tor when the extension is enabled, and an option to
  force the proxy off when Tor stops.
- Spanish translation (`es`).

## Requirements

- GNOME Shell **45–51** (Wayland or X11). GNOME 40–44 is frozen on the
  [`legacy/gnome-44`](https://github.com/rramirezacosta/torshell/tree/legacy/gnome-44)
  branch.
- Tor installed and managed by systemd, for example `tor.service` or
  `tor@default.service`.
- `gnome-extensions` (shipped with GNOME Shell).
- `pkexec` and `systemctl` for starting/stopping the service. A password prompt
  is shown by default; see [Passwordless control](#passwordless-control-optional).
- For **New Tor identity**: Tor's `ControlPort` enabled (default `9051`) and
  either a readable cookie file or the control password.

## Installation

Run the installer as your desktop user, **not** as root.

### From a checkout (current method)

```sh
git clone https://github.com/rramirezacosta/torshell.git
cd torshell
make install
```

`make install` builds the extension bundle and runs `install.sh`, which uses the
local `TorShell@itepo.mx.shell-extension.zip`.

You can also build and install in two steps:

```sh
make pack
./install.sh
```

`install.sh` looks for the bundle next to itself. Set `TORSSHELL_ZIP` to use a
bundle from another path:

```sh
TORSSHELL_ZIP=/path/to/TorShell@itepo.mx.shell-extension.zip ./install.sh
```

### From a release

Once a release has been published, `install.sh` downloads the latest release
asset when no local bundle is available:

```sh
./install.sh
```

or, without a checkout:

```sh
curl -fsSL https://raw.githubusercontent.com/rramirezacosta/torshell/master/install.sh | bash
```

> No GitHub release has been published yet, so use the checkout method for now.
> TorShell is not yet published on extensions.gnome.org.

### Reload GNOME Shell

- **Wayland:** log out and back in. The Shell cannot be restarted in place.
- **X11:** press `Alt+F2`, type `r`, and press Enter.

If the extension does not appear:

```sh
gnome-extensions info TorShell@itepo.mx
journalctl -f -o cat /usr/bin/gnome-shell
```

## Usage

Click the onion icon in the top bar to open the menu:

- The first row shows the current state (`active`, `inactive`, `activating`,
  `deactivating`, `failed`, or `unknown`) and, when available, the time Tor
  became active.
- **Tor** switches the service on or off.
- **New Tor identity** asks Tor for a new circuit. It is only shown while Tor is
  active and the control port answers.
- **Check connection** opens <https://check.torproject.org/>.
- **Preferences** opens the settings window.

The optional Quick Settings toggle mirrors the same state and can start or stop
Tor. Enable it in **Preferences → Appearance**.

## Configuration

All settings are stored in GSettings under
`org.gnome.shell.extensions.torshell`.

| Key | Default | Description |
|-----|---------|-------------|
| `tor-service` | `tor.service` | systemd unit that runs Tor. |
| `start-tor-on-enable` | `false` | Start Tor when the extension is enabled, if it is not already running. |
| `socks-port` | `9050` | Tor SOCKS port on localhost. |
| `manage-proxy` | `true` | Apply GNOME proxy settings while Tor is active. |
| `restore-proxy` | `true` | Restore the previous proxy when Tor stops. If disabled, the proxy mode is set to `none`. |
| `disable-proxy-on-stop` | `false` | Set the proxy mode to `none` when Tor stops, even if a previous configuration was saved. Takes precedence over `restore-proxy`. |
| `notify-state-change` | `false` | Show a notification when Tor starts or stops. |
| `show-panel-button` | `true` | Show the top-bar button. |
| `panel-position` | `right` | Put the button on the right or left side of the top bar. |
| `show-quick-toggle` | `false` | Add a Tor toggle to Quick Settings. |
| `control-port` | `9051` | Tor control port used by **New Tor identity**. |
| `control-password` | empty | Password for the control port. |
| `control-cookie-path` | `/run/tor/control.authcookie` | Control authentication cookie. Leave empty to skip cookie authentication. |

The control client tries the cookie file first, then the password, then no
authentication.

## Proxy behaviour and limitations

When Tor becomes active and `manage-proxy` is enabled, TorShell sets:

```sh
gsettings set org.gnome.system.proxy mode 'manual'
gsettings set org.gnome.system.proxy.socks host '127.0.0.1'
gsettings set org.gnome.system.proxy.socks port '<socks-port>'
```

It also adds `localhost`, `127.0.0.0/8`, and `::1` to the proxy ignore list. The
previous values are restored when Tor stops, when `manage-proxy` is turned off,
or when the extension is disabled.

Enable **Disable the proxy when Tor stops** (`disable-proxy-on-stop`) to set the
mode to `none` on stop even when a previous configuration was saved. It takes
precedence over `restore-proxy`.

GNOME's proxy settings are honoured by GIO/libportal-aware applications, not by
every program. Applications with their own proxy configuration (for example
Firefox) are not affected.

If the Shell crashes or is killed while Tor is active, the proxy can be left in
manual mode. `uninstall.sh` resets it to `none` only when it still looks like
TorShell's configuration (manual mode, `127.0.0.1`, and the configured SOCKS
port). To reset it by hand:

```sh
gsettings set org.gnome.system.proxy mode 'none'
```

## Passwordless control (optional)

By default, starting and stopping Tor uses `pkexec systemctl …`, so polkit asks
for your password. The preferences window can install a polkit rule at
`/etc/polkit-1/rules.d/50-torshell.rules` that allows local, active users in the
`wheel` or `sudo` groups to start and stop **only the configured Tor unit**
without a prompt.

The rule is optional and can be removed from the same preferences page.
`uninstall.sh` also removes it if present.

## Troubleshooting

- **The extension does not load after installing:** reload the Shell as
  described above. On Wayland only a logout/login works.
- **Nothing happens when toggling Tor:** check
  `journalctl -f -o cat /usr/bin/gnome-shell` for errors, and verify the unit
  name with `systemctl status tor.service` (some distributions use
  `tor@default.service`).
- **The password prompt is cancelled:** the switch returns to its previous state
  and no notification is shown for the cancellation itself.
- **New Tor identity is missing:** Tor is not active, `ControlPort` is disabled,
  or the cookie/password is wrong. Check `torrc` and the control settings.
- **Tor is active but the proxy does not work:** remember that GNOME proxy
  settings do not affect every application. Check the SOCKS port and
  `manage-proxy`.
- **Wrong proxy after a crash:** reset it manually with the command in
  [Proxy behaviour and limitations](#proxy-behaviour-and-limitations).

## Uninstall

```sh
make uninstall
```

or:

```sh
./uninstall.sh
```

The uninstaller disables the extension, removes its directory, resets the GNOME
proxy if it still looks like TorShell's, and removes the optional polkit rule
(with a `pkexec` prompt).

## Development

```sh
npm install          # install eslint
npm run lint         # or: make lint
make test            # proxy, systemd, polkit, and install/uninstall script tests
make check-po        # validate translation catalogs
make update-po       # refresh po/*.po from the sources
make pack            # build TorShell@itepo.mx.shell-extension.zip
make install         # build and install for the current user
make uninstall       # remove for the current user
```

The JavaScript tests use the GSettings memory backend, and the script tests use
fake `gnome-extensions`, `gsettings`, `pkexec`, and `curl` commands, so they do
not modify the real extension, proxy settings, or `/etc`.

## License

TorShell is licensed under the GNU General Public License v3.0. See
[`LICENSE`](LICENSE).

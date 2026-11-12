# TorShell — Modernization & Improvement Plan

Status: **phases 0–4 implemented; selected Phase 5 enhancements** (CI and EGO publication intentionally not set up) · Target: GNOME Shell **45–51** (ESM) · Legacy: keep GNOME 40–44 on a maintenance branch

---

## 1. Where we are today

| Area | Current state | Problem |
|------|---------------|---------|
| Module system | `imports.gi.*`, `imports.misc.*` | Removed in GNOME 45 (ESM only). Extension does not load on 45+. |
| Entry point | global `init()/enable()/disable()` | Must be `export default class extends Extension` since 45. |
| Shell versions | `metadata.json` → `["40","41"]` | 10 versions behind; extension is disabled as "outdated". |
| Panel placement | `Main.panel._rightBox.insert_child_at_index()` | Private API, brittle; should use `PanelMenu.Button` + `addToStatusArea` / Quick Settings. |
| State detection | `GLib.spawn_command_line_sync("systemctl is-active tor")` | **Blocks the Shell main thread**; runs on every refresh and every 300 ms in the poll loop. |
| Toggle action | `Util.trySpawnCommandLine("pkexec systemctl …")` | `misc.util` deprecated; completion detected via `pgrep pkexec -c` count diff. |
| Poll loop | `GLib.timeout_add(0, 300, _isJobDone)` | Source id never stored/removed; leaks if extension is disabled mid-toggle. |
| Globals | `res = true` (no `let`) | Implicit global → `ReferenceError` under ESM strict mode. |
| Proxy config | `dconf write /system/proxy/...` shell-outs | Bypasses GSettings API; overwrites the user's existing manual proxy with no save/restore. |
| Cleanup | `disable()` only removes the button | Signal handlers and timeouts are never disconnected/removed (review-guideline violation). |
| Packaging | `wget`/`unzip` via `curl \| bash`; fragile `dconf` string surgery | No `gnome-extensions pack`, no EGO distribution, no CI, no lint. |
| Extras | no `prefs.js`, no GSettings schema, no i18n, no stylesheet | Not configurable; can't be localized. |

**Root cause:** the code predates GNOME 45's ESM migration. Everything else is an opportunity to fix while porting.

---

## 2. Goals

1. **Load and work on GNOME 45–51** (current: 51.1).
2. **Never block or freeze the Shell** (no sync subprocess, no busy polling).
3. **Correct lifecycle**: everything created in `enable()` is torn down in `disable()`.
4. **Non-destructive proxy handling** with save/restore.
5. **Modern UX**: top-bar button + popup menu, optional Quick Settings toggle, preferences window, i18n.
6. **Distributable**: `gnome-extensions pack`, EGO-ready metadata, CI lint + release.
7. **Keep a legacy branch** so GNOME 40–44 users still have a working package.

---

## 3. Phase 0 — Repo hygiene (30 min)

- [x] Create branch `legacy/gnome-44` from current `master` (frozen, bug-fix only).
- [x] Add `.gitignore` (`*.zip`, `build/`, `po/*.mo`, `.eslintcache`).
- [x] Add `eslint` + GNOME Shell's lint config (gjs) and an `npm run lint` script.
- [x] Move legacy `install.sh`/`uninstall.sh` to the legacy branch; rewrite for `master` in Phase 4.
- [ ] Tag the last legacy commit (e.g. `v1.0.0-gnome44`).

---

## 4. Phase 1 — Port to GNOME 45+ (core, ~1–2 days)

### 4.1 `metadata.json`

```json
{
  "uuid": "TorShell@itepo.mx",
  "name": "TorShell",
  "description": "Toggle the Tor daemon and route your GNOME traffic through it from the top bar.",
  "shell-version": ["45", "46", "47", "48", "49", "50", "51"],
  "url": "https://github.com/rramirezacosta/torshell",
  "settings-schema": "org.gnome.shell.extensions.torshell",
  "gettext-domain": "torshell"
}
```

- Do **not** add `version` (deprecated; set by EGO) or `session-modes` (user mode only).
- Do not claim GNOME 52 (unreleased).

### 4.2 Entry point rewrite

```js
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TorService} from './torService.js';
import {ProxyManager} from './proxy.js';
import {TorIndicator} from './indicator.js';

export default class TorShellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._proxy = new ProxyManager(this._settings);
        this._service = new TorService(this._settings);   // systemd D-Bus watcher
        this._indicator = new TorIndicator(this, this._service, this._proxy);
        this._service.start();                            // connect signals + prime state
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._service.destroy();
        this._service = null;
        this._proxy.destroy();
        this._proxy = null;
        this._settings = null;
    }
}
```

- Keep `enable()`/`disable()` adjacent; split logic into modules (review guideline: small entry point).
- Never touch the Shell in `constructor()`.

### 4.3 Suggested file layout

```
TorShell@itepo.mx/
├── extension.js          # Extension class only
├── indicator.js          # top-bar button + popup menu
├── torService.js         # systemd D-Bus state watcher + pkexec actions
├── proxy.js              # GSettings proxy save/apply/restore
├── prefs.js              # Adw preferences window
├── schemas/
│   └── org.gnome.shell.extensions.torshell.gschema.xml
├── icons/                # cleaned symbolic SVGs
├── po/                   # gettext (en, es)
├── stylesheet.css        # optional
└── metadata.json
```

---

## 5. Phase 2 — Correct runtime behaviour (~2–3 days)

### 5.1 Replace blocking subprocess calls
- Remove all `GLib.spawn_command_line_sync` and `Util.trySpawnCommandLine`.
- Use async `Gio.Subprocess` (`communicate_utf8_async` / `wait_check_async`) — the Shell thread is never blocked.

### 5.2 Watch state through systemd D-Bus (no polling)
Query the unit over the system bus instead of shelling out:

```js
// tor.service → /org/freedesktop/systemd1/unit/tor_2eservice
const proxy = await Gio.DBusProxy.new_for_bus(
    Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
    'org.freedesktop.systemd1',
    unitPath,                       // escaped from the configured service name
    'org.freedesktop.systemd1.Unit', null);

// read `ActiveState`, then subscribe:
proxy.connect('g-properties-changed', () => this._syncState());
```

- Verified locally: `busctl --system get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/tor_2eservice org.freedesktop.systemd1.Unit ActiveState` → `"inactive"`.
- Map `ActiveState` → UI: `active` (on), `activating`/`deactivating` (spinner), `inactive` (off), `failed` (error notification).
- No more `pgrep pkexec` hack and no 300 ms poll; UI updates from the D-Bus signal.

### 5.3 Privileged start/stop (keep pkexec, make it robust)
- EGO rules require privileged subprocesses to go through `pkexec` and not be user-writable → keep `pkexec systemctl <verb> <service>`.
- Track the `Gio.Subprocess` object, await its exit code; on non-zero (auth cancelled / failure) show a notification instead of guessing.
- Optional UX upgrade (opt-in from prefs): install a polkit rule allowing users in `wheel`/`sudo` to `manage-units` for the configured tor unit, removing the password prompt on every toggle. Document the security trade-off.

### 5.4 Non-destructive proxy management (`proxy.js`)
- Use GSettings, not `dconf`:
  - `org.gnome.system.proxy` → `mode`, `use-same-proxy`, `ignore-hosts`, `autoconfig-url`
  - `org.gnome.system.proxy.socks` → `host`, `port`
- On "on": save the current values, then set `socks.host=127.0.0.1`, `socks.port=<configured>`, `mode='manual'`, and add `localhost`/`127.0.0.0/8`/`::1` to `ignore-hosts`.
- On "off": **restore** the saved mode/host/port instead of forcing `none`.
- Note the limitation in the README: GNOME proxy settings cover GIO/libportal-aware apps, not every application.

### 5.5 Lifecycle correctness
- Store every `connect()` id and GLib source id; disconnect/remove them in `disable()`.
- Destroy widgets with `destroy()`; null out references.
- Remove timeouts next to their creation; never guard with `_destroyed` flags.

---

## 6. Phase 3 — UX & features (~2–3 days)

- [x] **Top-bar indicator** (`PanelMenu.Button`, `style_class: 'panel-button'`), `addToStatusArea()` instead of `_rightBox`.
- [x] **Popup menu** with: on/off toggle + status line (`Active since …` / `Inactive`), **New Tor identity** (control-port `SIGNAL NEWNYM`, only if `ControlPort` is enabled), **Check connection** (opens `check.torproject.org`), separator, **Preferences**.
- [x] **Optional Quick Settings toggle** (`QuickSettings.QuickToggle` added via `Main.panel.statusArea.quickSettings.addExternalIndicator`) — behind a setting, since the top-bar icon is the extension's identity.
- [x] **Preferences window** (`prefs.js`, Adw/Gtk, separate process): SOCKS port, tor service name, "manage GNOME proxy automatically", "restore previous proxy", "show panel button"/position, "notify on state change", "install no-password polkit rule".
- [x] **GSettings schema** `org.gnome.shell.extensions.torshell` (base id/path per EGO rules, shipped as `<schema-id>.gschema.xml`).
- [x] **i18n**: `gettext-domain: torshell`; ship `en` + `es` catalogs, extraction in the Makefile.
- [x] **Notifications** on failure/state change (replace the current `Main.notify` hack, remove the broken `res`/`Exception` globals).

Additional Phase 3 settings: `show-panel-button`, `panel-position` (`right`/`left`), `show-quick-toggle`, `control-port`, `control-password`, `control-cookie-path`. The control-port client tries the cookie file first, then the password, then no authentication, and only shows **New Tor identity** when Tor answers `PROTOCOLINFO`. The optional polkit rule is written to `/etc/polkit-1/rules.d/50-torshell.rules` and only covers start/stop of the configured unit for local, active `wheel`/`sudo` users.

---

## 7. Phase 4 — Packaging & distribution (~1 day)

- [x] **Build**: `make pack` runs `gnome-extensions pack --force --podir=po --schema=schemas/org.gnome.shell.extensions.torshell.gschema.xml TorShell@itepo.mx` and includes every runtime module and the icons.
- [x] **Rewrite `install.sh`**: `set -euo pipefail`, non-root check, local-bundle detection, `TORSSHELL_ZIP` override, latest-release download with `curl`/`wget`, `gnome-extensions install --force`, graceful `gnome-extensions enable`, and Wayland/X11 reload instructions. The fragile `dconf` string manipulation is gone.
- [x] **Rewrite `uninstall.sh`**: `gnome-extensions disable`/`uninstall`, directory-removal fallback, cautious proxy reset when the configuration still looks like TorShell's, and optional removal of the polkit rule via `pkexec`.
- [x] **Script tests**: `tests/test-scripts.sh` uses fake `gnome-extensions`, `gsettings`, `pkexec`, and `curl` commands to cover local/override/download installs, uninstall, proxy-reset conditions, polkit cleanup, and idempotency.
- [x] **Make targets**: `make install`, `make uninstall`, and `make test-scripts`; `make test` runs the script tests too.
- [x] **README**: prerequisites, checkout/release/manual installation, usage, settings, proxy limitations, optional polkit rule, troubleshooting, uninstall, and development commands.
- [ ] **CI (GitHub Actions)**: intentionally deferred; not part of the current phase.
- [ ] **Publish to extensions.gnome.org**: intentionally deferred; not part of the current phase.

---

## 8. Phase 5 — Optional enhancements (in progress)

- [ ] Tor bootstrap progress via the control port (9051) → show "Bootstrapping 45%".
- [ ] Detect `tor@default` / user services automatically; per-service config.
- [x] "Disable proxy when tor stops" (`disable-proxy-on-stop`) and "start tor on extension enable" (`start-tor-on-enable`) toggles.
- [ ] Keyboard shortcut via `addKeybinding` in prefs.
- [ ] Clean/redraw the icons: strip Illustrator cruft (empty `<g>` groups, DOCTYPE) and confirm single-colour symbolic rendering.

---

## 9. Testing checklist

- [x] `npm run lint` passes.
- [x] `make test` passes (proxy apply/restore round-trip, systemd D-Bus watcher, polkit rule escaping, install/uninstall scripts).
- [x] `make check-po` passes; `po/es.po` has no untranslated or fuzzy messages.
- [x] `make pack` includes `prefs.js`, all modules, `schemas/`, `locale/es/LC_MESSAGES/torshell.mo`, and icons.
- [x] `install.sh` installs and enables from a local bundle, a `TORSSHELL_ZIP` override, and a downloaded release (with fakes).
- [x] `uninstall.sh` disables/removes the extension, resets a Tor-shaped proxy, and removes the polkit rule (with fakes).
- [x] `disable-proxy-on-stop` takes precedence over `restore-proxy` when Tor stops.
- [ ] `start-tor-on-enable` starts Tor once after the initial systemd state is known.
- [ ] Nested dev shell: `dbus-run-session gnome-shell --devkit --wayland` (49+).
- [ ] Enable → extension appears, no errors in `journalctl -f -o cat /usr/bin/gnome-shell`.
- [ ] Inactive → click → pkexec prompt → `active`; UI updates from D-Bus (no polling).
- [ ] Cancel pkexec → no false "on" state, notification shown.
- [ ] Stop → previous proxy config restored exactly.
- [ ] `disable()`/`enable()` repeatedly → no leaked signals, timeouts, or widgets.
- [ ] Lock/unlock session; multi-monitor; light/dark theme icons.
- [ ] Config changes in prefs apply live.
- [ ] New Tor identity works with cookie and password authentication.
- [ ] Quick Settings toggle starts/stops Tor and stays in sync with the panel button.
- [ ] Polkit rule install/remove prompts once and updates the switch state.

> The live-session checks above and screenshots of the new menu/preferences still
> require a running GNOME Shell session.

---

## 10. Decisions

1. **Version scope** — port to 45–51 only; GNOME 40–44 is frozen on `legacy/gnome-44`. *(implemented)*
2. **UI** — top-bar button as primary, Quick Settings as an option. *(implemented)*
3. **Privileges** — `pkexec` prompt by default, opt-in no-password polkit rule. *(implemented)*
4. **Distribution** — packaged releases plus an install script for now; extensions.gnome.org publication and CI are deferred.
5. **Icons** — keep the current onion artwork, or draw a cleaner symbolic set? (Note: the Tor Project logo is trademarked; the current hand-drawn onion is safer.)

---

## 11. Rough effort

| Phase | Work | Estimate |
|-------|------|----------|
| 0 | Repo hygiene | 0.5 day |
| 1 | ESM/metadata port | 1–2 days |
| 2 | Runtime correctness | 2–3 days |
| 3 | UX, prefs, i18n | 2–3 days |
| 4 | Packaging, CI, EGO | 1 day |
| 5 | Optional extras | 1–2 days |
| — | **Total** | **~7–12 days** |

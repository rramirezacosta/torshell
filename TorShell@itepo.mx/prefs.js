import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {RULE_PATH, buildPolkitRule} from './polkitRule.js';

export default class TorShellPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();

        window.set_default_size(560, 720);
        window.add(this._buildGeneralPage());
        window.add(this._buildProxyPage());
        window.add(this._buildAppearancePage());
        window.add(this._buildControlPage());
    }

    _buildGeneralPage() {
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        const service = this._group(_('Tor service'),
            _('systemd unit that runs the Tor daemon, for example tor.service or tor@default.service.'));
        this._entry(service, _('Unit name'), 'tor-service');
        page.add(service);

        const notifications = this._group(_('Notifications'));
        this._switch(notifications, _('Notify when Tor starts or stops'), 'notify-state-change');
        page.add(notifications);

        return page;
    }

    _buildProxyPage() {
        const page = new Adw.PreferencesPage({
            title: _('Proxy'),
            icon_name: 'network-proxy-symbolic',
        });

        const group = this._group(_('GNOME proxy'),
            _('TorShell switches GNOME’s proxy settings while Tor is running. This affects GIO/libportal-aware applications, not every program.'));

        const manage = this._switch(group,
            _('Manage the GNOME proxy automatically'), 'manage-proxy');
        const restore = this._switch(group,
            _('Restore the previous proxy settings'), 'restore-proxy',
            _('When disabled, the proxy mode is set to “none” when Tor stops.'));
        manage.bind_property('active', restore, 'sensitive',
            GObject.BindingFlags.SYNC_CREATE);

        this._spin(group, _('SOCKS port'), 'socks-port', 1, 65535);

        page.add(group);
        return page;
    }

    _buildAppearancePage() {
        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-theme-symbolic',
        });

        const panel = this._group(_('Panel'));
        const show = this._switch(panel, _('Show the top-bar button'), 'show-panel-button');
        const position = this._combo(panel, _('Top-bar position'), 'panel-position',
            [_('Right'), _('Left')], ['right', 'left']);
        show.bind_property('active', position, 'sensitive',
            GObject.BindingFlags.SYNC_CREATE);
        page.add(panel);

        const quick = this._group(_('Quick Settings'),
            _('The Quick Settings toggle is an alternative to the top-bar button.'));
        this._switch(quick, _('Show the Quick Settings toggle'), 'show-quick-toggle');
        page.add(quick);

        return page;
    }

    _buildControlPage() {
        const page = new Adw.PreferencesPage({
            title: _('Tor control'),
            icon_name: 'utilities-terminal-symbolic',
        });

        const group = this._group(_('Control port'),
            _('Used by “New Tor identity”. Tor must have ControlPort enabled. TorShell tries the cookie file first, then the password below.'));
        this._spin(group, _('Control port'), 'control-port', 1, 65535);
        this._entry(group, _('Cookie file'), 'control-cookie-path');
        this._password(group, _('Control password'), 'control-password');
        page.add(group);

        const polkit = this._group(_('Passwordless control'),
            _('By default, starting and stopping Tor asks for your password. Installing a polkit rule lets users in the wheel or sudo groups manage the configured Tor unit without a prompt.'));
        this._polkitRow(polkit);
        page.add(polkit);

        return page;
    }

    _group(title, description) {
        const group = new Adw.PreferencesGroup({title});
        if (description)
            group.description = description;
        return group;
    }

    _switch(group, title, key, subtitle) {
        const row = new Adw.SwitchRow({title});
        if (subtitle)
            row.subtitle = subtitle;
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
        return row;
    }

    _entry(group, title, key, subtitle) {
        const row = new Adw.EntryRow({title});
        if (subtitle)
            row.subtitle = subtitle;
        row.text = this._settings.get_string(key);
        row.connect('notify::text', () => {
            const value = row.text.trim();
            if (value !== this._settings.get_string(key))
                this._settings.set_string(key, value);
        });
        group.add(row);
        return row;
    }

    _password(group, title, key) {
        const row = new Adw.PasswordEntryRow({title});
        row.text = this._settings.get_string(key);
        row.connect('notify::text', () => {
            if (row.text !== this._settings.get_string(key))
                this._settings.set_string(key, row.text);
        });
        group.add(row);
        return row;
    }

    _spin(group, title, key, lower, upper, subtitle) {
        const row = new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: 1,
                page_increment: 10,
            }),
        });
        if (subtitle)
            row.subtitle = subtitle;
        row.value = this._settings.get_uint(key);
        row.connect('notify::value', () => {
            const value = Math.round(row.value);
            if (value !== this._settings.get_uint(key))
                this._settings.set_uint(key, value);
        });
        group.add(row);
        return row;
    }

    _combo(group, title, key, labels, values, subtitle) {
        const row = new Adw.ComboRow({
            title,
            model: Gtk.StringList.new(labels),
        });
        if (subtitle)
            row.subtitle = subtitle;

        const current = values.indexOf(this._settings.get_string(key));
        row.selected = current >= 0 ? current : 0;

        row.connect('notify::selected', () => {
            const value = values[row.selected] ?? values[0];
            if (value !== this._settings.get_string(key))
                this._settings.set_string(key, value);
        });
        group.add(row);
        return row;
    }

    _polkitRow(group) {
        const row = new Adw.SwitchRow({
            title: _('Allow passwordless start/stop'),
            subtitle: _('Applies to the configured Tor unit only.'),
        });
        row.active = this._ruleMatches();
        group.add(row);

        let syncing = false;
        row.connect('notify::active', () => {
            if (syncing || row.active === this._ruleMatches())
                return;

            syncing = true;
            row.sensitive = false;

            const operation = row.active
                ? this._runPkexec(['tee', RULE_PATH],
                    buildPolkitRule(this._settings.get_string('tor-service')))
                : this._runPkexec(['rm', '-f', RULE_PATH], null);

            operation.then(ok => {
                row.active = this._ruleMatches();
                row.sensitive = true;
                row.subtitle = ok
                    ? _('Applies to the configured Tor unit only.')
                    : _('Could not update the polkit rule.');
                syncing = false;
            });
        });
    }

    _ruleMatches() {
        try {
            const [ok, contents] = GLib.file_get_contents(RULE_PATH);
            if (!ok)
                return false;

            const text = typeof contents === 'string'
                ? contents
                : new TextDecoder().decode(contents);
            return text === buildPolkitRule(this._settings.get_string('tor-service'));
        } catch {
            return false;
        }
    }

    _runPkexec(argv, stdin) {
        return new Promise(resolve => {
            const pkexec = GLib.find_program_in_path('pkexec');
            const program = GLib.find_program_in_path(argv[0]);
            if (!pkexec || !program) {
                resolve(false);
                return;
            }

            let proc;
            try {
                proc = Gio.Subprocess.new(
                    [pkexec, program, ...argv.slice(1)],
                    Gio.SubprocessFlags.STDIN_PIPE |
                    Gio.SubprocessFlags.STDOUT_SILENCE |
                    Gio.SubprocessFlags.STDERR_SILENCE);
            } catch {
                resolve(false);
                return;
            }

            proc.communicate_utf8_async(stdin, null, (p, result) => {
                try {
                    p.communicate_utf8_finish(result);
                    resolve(true);
                } catch {
                    resolve(false);
                }
            });
        });
    }
}

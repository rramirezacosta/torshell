import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const SYSTEMD_BUS_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_ROOT_PATH = '/org/freedesktop/systemd1';
const MANAGER_INTERFACE = 'org.freedesktop.systemd1.Manager';
const UNIT_INTERFACE = 'org.freedesktop.systemd1.Unit';

const PKEXEC_PATH = GLib.find_program_in_path('pkexec');
const SYSTEMCTL_PATH = GLib.find_program_in_path('systemctl');

export const TorService = GObject.registerClass({
    Signals: {
        'state-changed': {param_types: [GObject.TYPE_STRING]},
        'action-failed': {},
    },
}, class TorService extends GObject.Object {
    constructor(settings) {
        super();
        this._settings = settings;
        this._state = 'unknown';
        this._proxy = null;
        this._proxyId = 0;
        this._cancellable = null;
        this._proc = null;
        this._actionCancellable = null;
        this._settingsId = 0;
    }

    get state() {
        return this._state;
    }

    start() {
        this._settingsId = this._settings.connect('changed::tor-service',
            () => this._watchUnit());
        this._watchUnit();
    }

    setEnabled(enabled) {
        return this._runSystemctl(enabled ? 'start' : 'stop');
    }

    _watchUnit() {
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        this._destroyProxy();
        this._setState('unknown');

        const unitName = this._settings.get_string('tor-service');

        // Unit objects only exist once systemd has loaded the unit, so ask
        // the manager to load it before creating the property proxy.
        try {
            Gio.DBus.system.call(
                SYSTEMD_BUS_NAME,
                SYSTEMD_ROOT_PATH,
                MANAGER_INTERFACE,
                'LoadUnit',
                new GLib.Variant('(s)', [unitName]),
                new GLib.VariantType('(o)'),
                Gio.DBusCallFlags.NONE,
                -1,
                cancellable,
                (_connection, result) => {
                    if (this._cancellable !== cancellable)
                        return;

                    let objectPath;
                    try {
                        const reply = _connection.call_finish(result);
                        [objectPath] = reply.deep_unpack();
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            console.error(`TorShell: unable to load ${unitName}: ${e.message}`);
                        return;
                    }

                    this._createProxy(objectPath, cancellable);
                });
        } catch (e) {
            // No system bus (e.g. running outside a systemd session).
            console.error(`TorShell: system bus unavailable: ${e.message}`);
        }
    }

    _createProxy(objectPath, cancellable) {
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            SYSTEMD_BUS_NAME,
            objectPath,
            UNIT_INTERFACE,
            cancellable,
            (_source, result) => {
                if (this._cancellable !== cancellable)
                    return;

                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.error(`TorShell: unable to watch ${objectPath}: ${e.message}`);
                    return;
                }

                this._proxy = proxy;
                this._proxyId = proxy.connect('g-properties-changed',
                    () => this._updateState());
                this._updateState();
            });
    }

    _destroyProxy() {
        if (this._proxy && this._proxyId)
            this._proxy.disconnect(this._proxyId);
        this._proxyId = 0;
        this._proxy = null;
    }

    _updateState() {
        const variant = this._proxy?.get_cached_property('ActiveState');
        this._setState(variant ? variant.unpack() : 'unknown');
    }

    _setState(state) {
        if (this._state === state)
            return;
        this._state = state;
        this.emit('state-changed', state);
    }

    _runSystemctl(verb) {
        if (this._proc)
            return false;

        if (!PKEXEC_PATH || !SYSTEMCTL_PATH) {
            Main.notify('TorShell', _('pkexec or systemctl could not be found.'));
            return false;
        }

        const unitName = this._settings.get_string('tor-service');
        const cancellable = new Gio.Cancellable();
        this._actionCancellable = cancellable;

        try {
            this._proc = Gio.Subprocess.new(
                [PKEXEC_PATH, SYSTEMCTL_PATH, verb, unitName],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._actionCancellable = null;
            Main.notify('TorShell', _('Failed to run systemctl: %s').format(e.message));
            return false;
        }

        this._proc.wait_check_async(cancellable, (proc, result) => {
            if (this._actionCancellable !== cancellable)
                return;

            this._actionCancellable = null;
            this._proc = null;

            let succeeded = true;
            try {
                proc.wait_check_finish(result);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                succeeded = false;
            }

            if (succeeded) {
                this._updateState();
            } else {
                Main.notify('TorShell', _('Could not %s the Tor service.').format(verb));
                this.emit('action-failed');
            }
        });

        return true;
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }

        this._cancellable?.cancel();
        this._cancellable = null;

        this._actionCancellable?.cancel();
        this._actionCancellable = null;

        this._destroyProxy();

        if (this._proc) {
            this._proc.force_exit();
            this._proc = null;
        }

        this._settings = null;
    }
});

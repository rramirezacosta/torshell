import Gio from 'gi://Gio';

const PROXY_SCHEMA = 'org.gnome.system.proxy';
const SOCKS_SCHEMA = 'org.gnome.system.proxy.socks';

// Hosts that must never be sent through the proxy.
const LOCAL_HOSTS = ['localhost', '127.0.0.0/8', '::1'];

/**
 * Applies and restores GNOME's proxy configuration around Tor.
 *
 * The previous configuration is snapshotted the first time the proxy is
 * applied and restored when Tor stops (or the extension is disabled), so
 * we never clobber a user's own manual/automatic proxy setup.
 */
export class ProxyManager {
    constructor(extensionSettings) {
        this._settings = extensionSettings;
        this._proxy = new Gio.Settings({schema_id: PROXY_SCHEMA});
        this._socks = new Gio.Settings({schema_id: SOCKS_SCHEMA});
        this._saved = null;
    }

    get applied() {
        return this._saved !== null;
    }

    apply() {
        if (this._saved === null)
            this._saved = this._snapshot();

        this._socks.set_string('host', '127.0.0.1');
        this._socks.set_int('port', this._settings.get_uint('socks-port'));
        this._proxy.set_string('mode', 'manual');
        this._addIgnoreHosts();
    }

    restore() {
        if (this._saved === null)
            return;

        const saved = this._saved;
        this._saved = null;

        if (this._settings.get_boolean('restore-proxy')) {
            this._proxy.set_string('mode', saved.mode);
            this._socks.set_string('host', saved.socksHost);
            this._socks.set_int('port', saved.socksPort);
            this._proxy.set_strv('ignore-hosts', saved.ignoreHosts);
        } else {
            this._proxy.set_string('mode', 'none');
        }
    }

    destroy() {
        this.restore();
        this._settings = null;
        this._proxy = null;
        this._socks = null;
    }

    _snapshot() {
        return {
            mode: this._proxy.get_string('mode'),
            socksHost: this._socks.get_string('host'),
            socksPort: this._socks.get_int('port'),
            ignoreHosts: this._proxy.get_strv('ignore-hosts'),
        };
    }

    _addIgnoreHosts() {
        const hosts = this._proxy.get_strv('ignore-hosts');
        let changed = false;
        for (const host of LOCAL_HOSTS) {
            if (!hosts.includes(host)) {
                hosts.push(host);
                changed = true;
            }
        }
        if (changed)
            this._proxy.set_strv('ignore-hosts', hosts);
    }
}

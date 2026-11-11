import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TorService} from './torService.js';
import {ProxyManager} from './proxy.js';
import {TorIndicator} from './indicator.js';

export default class TorShellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._proxy = new ProxyManager(this._settings);
        this._service = new TorService(this._settings);
        this._indicator = new TorIndicator(this, this._service);

        this._stateChangedId = this._service.connect('state-changed',
            (_service, state) => this._onStateChanged(state));

        this._settingsChangedId = this._settings.connect('changed',
            (_settings, key) => this._onSettingsChanged(key));

        this._service.start();
        this._indicator.sync();
    }

    disable() {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;

        this._service.disconnect(this._stateChangedId);
        this._stateChangedId = 0;

        this._indicator.destroy();
        this._indicator = null;

        this._service.destroy();
        this._service = null;

        this._proxy.destroy();
        this._proxy = null;

        this._settings = null;
    }

    _onStateChanged(state) {
        this._syncProxy(state);

        this._indicator.sync();

        if (state === 'failed') {
            Main.notify('TorShell', _('The Tor service failed to start.'));
        } else if (this._settings.get_boolean('notify-state-change')) {
            if (state === 'active')
                Main.notify('TorShell', _('Tor is now active.'));
            else if (state === 'inactive')
                Main.notify('TorShell', _('Tor is now inactive.'));
        }
    }

    _onSettingsChanged(key) {
        if (key === 'manage-proxy' || key === 'socks-port')
            this._syncProxy(this._service.state);
    }

    _syncProxy(state) {
        if (state === 'active' && this._settings.get_boolean('manage-proxy'))
            this._proxy.apply();
        else
            this._proxy.restore();
    }
}

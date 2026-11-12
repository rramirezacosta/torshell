import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TorService} from './torService.js';
import {TorControl} from './torControl.js';
import {ProxyManager} from './proxy.js';
import {TorIndicator} from './indicator.js';
import {TorQuickToggle} from './quickToggle.js';

const START_ON_ENABLE_TIMEOUT_SECONDS = 10;

export default class TorShellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._proxy = new ProxyManager(this._settings);
        this._control = new TorControl(this._settings);
        this._service = new TorService(this._settings);
        this._startOnEnablePending = false;
        this._startOnEnableTimeoutId = 0;

        this._stateChangedId = this._service.connect('state-changed',
            (_service, state) => this._onStateChanged(state));
        this._actionFailedId = this._service.connect('action-failed',
            () => this._syncUi());
        this._settingsChangedId = this._settings.connect('changed',
            (_settings, key) => this._onSettingsChanged(key));

        this._buildIndicator();
        this._buildQuickToggle();

        // Start Tor once, after the initial systemd state is known, so we do
        // not prompt for authentication when Tor is already running.
        this._startOnEnablePending = this._settings.get_boolean('start-tor-on-enable');
        if (this._startOnEnablePending) {
            this._startOnEnableTimeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, START_ON_ENABLE_TIMEOUT_SECONDS, () => {
                    this._startOnEnableTimeoutId = 0;
                    this._startOnEnablePending = false;
                    return GLib.SOURCE_REMOVE;
                });
        }

        this._service.start();
        this._syncUi();
    }

    disable() {
        this._clearStartOnEnablePending();

        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;

        this._service.disconnect(this._actionFailedId);
        this._actionFailedId = 0;

        this._service.disconnect(this._stateChangedId);
        this._stateChangedId = 0;

        this._indicator?.destroy();
        this._indicator = null;

        this._quickToggle?.destroy();
        this._quickToggle = null;

        this._service.destroy();
        this._service = null;

        this._control.destroy();
        this._control = null;

        this._proxy.destroy();
        this._proxy = null;

        this._settings = null;
    }

    _buildIndicator() {
        this._indicator?.destroy();
        this._indicator = null;

        if (!this._settings.get_boolean('show-panel-button'))
            return;

        this._indicator = new TorIndicator(
            this,
            this._service,
            this._control,
            this._settings.get_string('panel-position'));
        this._indicator.sync();
    }

    _buildQuickToggle() {
        this._quickToggle?.destroy();
        this._quickToggle = null;

        if (!this._settings.get_boolean('show-quick-toggle'))
            return;

        this._quickToggle = new TorQuickToggle(`${this.path}/icons`);
        this._quickToggle.toggle.connect('clicked', () => {
            const enabled = this._quickToggle.toggle.checked;
            if (!this._service.setEnabled(enabled))
                this._syncUi();
        });
        this._quickToggle.sync(this._service.state);
    }

    _syncUi() {
        this._indicator?.sync();
        this._quickToggle?.sync(this._service.state);
    }

    _clearStartOnEnablePending() {
        this._startOnEnablePending = false;
        if (this._startOnEnableTimeoutId) {
            GLib.source_remove(this._startOnEnableTimeoutId);
            this._startOnEnableTimeoutId = 0;
        }
    }

    _onStateChanged(state) {
        const startingOnEnable = this._startOnEnablePending && state !== 'unknown';
        if (startingOnEnable) {
            this._clearStartOnEnablePending();
            if (state === 'inactive' || state === 'failed')
                this._service.setEnabled(true);
        }

        this._syncProxy(state);
        this._syncUi();

        if (state === 'failed' && !startingOnEnable) {
            Main.notify('TorShell', _('The Tor service failed to start.'));
        } else if (this._settings.get_boolean('notify-state-change')) {
            if (state === 'active')
                Main.notify('TorShell', _('Tor is now active.'));
            else if (state === 'inactive')
                Main.notify('TorShell', _('Tor is now inactive.'));
        }
    }

    _onSettingsChanged(key) {
        switch (key) {
        case 'show-panel-button':
        case 'panel-position':
            this._buildIndicator();
            this._syncUi();
            break;
        case 'show-quick-toggle':
            this._buildQuickToggle();
            this._syncUi();
            break;
        case 'manage-proxy':
        case 'socks-port':
            this._syncProxy(this._service.state);
            break;
        default:
            break;
        }
    }

    _syncProxy(state) {
        if (state === 'active' && this._settings.get_boolean('manage-proxy'))
            this._proxy.apply();
        else
            this._proxy.restore();
    }
}

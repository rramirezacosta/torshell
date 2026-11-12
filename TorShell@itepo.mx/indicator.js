import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ON_ICON = 'torshell-on-symbolic';
const OFF_ICON = 'torshell-off-symbolic';
const CHECK_URL = 'https://check.torproject.org/';

export const TorIndicator = GObject.registerClass(
class TorIndicator extends PanelMenu.Button {
    _init(extension, service, control, position) {
        super._init(0.0, 'TorShell', false);

        this._extension = extension;
        this._service = service;
        this._control = control;
        this._iconsPath = `${extension.path}/icons`;
        this._syncing = false;
        this._controlAvailable = false;
        this._probePending = false;
        this._probeToken = 0;

        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);

        this._statusItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._statusItem);

        this._toggleItem = new PopupMenu.PopupSwitchMenuItem(_('Tor'), false);
        this._toggleId = this._toggleItem.connect('toggled', () => this._onToggle());
        this.menu.addMenuItem(this._toggleItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._newIdentityItem = new PopupMenu.PopupMenuItem(_('New Tor identity'));
        this._newIdentityItem.visible = false;
        this._newIdentityItem.connect('activate', () => this._onNewIdentity());
        this.menu.addMenuItem(this._newIdentityItem);

        this.menu.addAction(_('Check connection'), () => {
            Gio.AppInfo.launch_default_for_uri(CHECK_URL, null);
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction(_('Preferences'), () => this._extension.openPreferences());

        this._openStateId = this.menu.connect('open-state-changed',
            (_menu, isOpen) => {
                if (isOpen && this._service.state === 'active')
                    this._updateControlAvailability();
            });

        Main.panel.addToStatusArea(
            extension.uuid, this, position === 'left' ? -1 : 0, position);
    }

    sync() {
        const state = this._service.state;
        const on = state === 'active' || state === 'activating';
        const busy = state === 'activating' || state === 'deactivating';

        this._icon.gicon = Gio.icon_new_for_string(
            `${this._iconsPath}/${on ? ON_ICON : OFF_ICON}.svg`);
        this._statusItem.label.text = this._statusText(state);

        this._syncing = true;
        this._toggleItem.setToggleState(on);
        this._syncing = false;

        this._toggleItem.setSensitive(!busy);

        if (state === 'active') {
            if (!this._controlAvailable && !this._probePending)
                this._updateControlAvailability();
            this._newIdentityItem.visible = this._controlAvailable;
        } else {
            this._newIdentityItem.visible = false;
        }
    }

    _statusText(state) {
        switch (state) {
        case 'active': {
            const since = this._service.activeSince;
            return since
                ? _('Active since %s').format(this._formatTime(since))
                : _('Active');
        }
        case 'activating':
            return _('Starting…');
        case 'deactivating':
            return _('Stopping…');
        case 'inactive':
            return _('Inactive');
        case 'failed':
            return _('Failed');
        default:
            return _('Unknown');
        }
    }

    _formatTime(date) {
        const then = GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000));
        const now = GLib.DateTime.new_now_local();

        const sameDay =
            then.get_year() === now.get_year() &&
            then.get_month_of_year() === now.get_month_of_year() &&
            then.get_day_of_month() === now.get_day_of_month();

        return sameDay ? then.format('%X') : then.format('%x %X');
    }

    _updateControlAvailability() {
        this._probePending = true;
        const token = ++this._probeToken;

        this._control.probe().then(available => {
            if (token !== this._probeToken || !this._service)
                return;

            this._probePending = false;
            this._controlAvailable = available;
            this._newIdentityItem.visible =
                available && this._service.state === 'active';
        });
    }

    _onToggle() {
        if (this._syncing)
            return;

        const enabled = this._toggleItem.state;
        if (!this._service.setEnabled(enabled)) {
            this._syncing = true;
            this._toggleItem.setToggleState(!enabled);
            this._syncing = false;
        }
    }

    _onNewIdentity() {
        if (!this._controlAvailable || this._service.state !== 'active')
            return;

        this._newIdentityItem.setSensitive(false);
        this._control.newIdentity()
            .then(() => {
                if (this._service)
                    Main.notify('TorShell', _('Requested a new Tor identity.'));
            })
            .catch(e => {
                if (this._service)
                    Main.notify('TorShell', _('Could not request a new Tor identity: %s').format(e.message));
            })
            .finally(() => {
                if (this._service)
                    this._newIdentityItem.setSensitive(true);
            });
    }

    destroy() {
        this._probeToken++;

        if (this._toggleItem && this._toggleId)
            this._toggleItem.disconnect(this._toggleId);
        this._toggleId = 0;

        if (this.menu && this._openStateId)
            this.menu.disconnect(this._openStateId);
        this._openStateId = 0;

        this._service = null;
        this._extension = null;
        this._control = null;
        this._icon = null;
        this._statusItem = null;
        this._toggleItem = null;
        this._newIdentityItem = null;

        super.destroy();
    }
});

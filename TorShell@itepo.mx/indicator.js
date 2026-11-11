import Gio from 'gi://Gio';
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
    _init(extension, service) {
        super._init(0.0, 'TorShell', false);

        this._extension = extension;
        this._service = service;
        this._iconsPath = `${extension.path}/icons`;
        this._syncing = false;

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

        this._actionFailedId = service.connect('action-failed', () => this.sync());

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction(_('Check connection'), () => {
            Gio.AppInfo.launch_default_for_uri(CHECK_URL, null);
        });

        Main.panel.addToStatusArea(extension.uuid, this);
    }

    sync() {
        const state = this._service.state;
        const on = state === 'active' || state === 'activating';
        const busy = state === 'activating' || state === 'deactivating';

        this._icon.gicon = Gio.icon_new_for_string(
            `${this._iconsPath}/${on ? ON_ICON : OFF_ICON}.svg`);
        this._statusItem.label.text = this._labelForState(state);

        this._syncing = true;
        this._toggleItem.setToggleState(on);
        this._syncing = false;

        this._toggleItem.setSensitive(!busy);
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

    _labelForState(state) {
        switch (state) {
        case 'active':
            return _('Connected');
        case 'activating':
            return _('Starting…');
        case 'deactivating':
            return _('Stopping…');
        case 'inactive':
            return _('Disconnected');
        case 'failed':
            return _('Failed');
        default:
            return _('Unknown');
        }
    }

    destroy() {
        if (this._service && this._actionFailedId)
            this._service.disconnect(this._actionFailedId);
        this._actionFailedId = 0;

        if (this._toggleItem && this._toggleId)
            this._toggleItem.disconnect(this._toggleId);
        this._toggleId = 0;

        this._service = null;
        this._extension = null;
        this._icon = null;
        this._statusItem = null;
        this._toggleItem = null;
        super.destroy();
    }
});

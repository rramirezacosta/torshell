import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ON_ICON = 'torshell-on-symbolic';
const OFF_ICON = 'torshell-off-symbolic';

/**
 * Optional Tor toggle for the Quick Settings menu.
 */
export class TorQuickToggle {
    constructor(iconsPath) {
        this._iconsPath = iconsPath;

        this._indicator = new QuickSettings.SystemIndicator();
        this._toggle = new QuickSettings.QuickToggle({
            title: _('Tor'),
            toggleMode: true,
            gicon: Gio.icon_new_for_string(`${iconsPath}/${OFF_ICON}.svg`),
        });

        this._indicator.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    get toggle() {
        return this._toggle;
    }

    sync(state) {
        const on = state === 'active' || state === 'activating';
        const busy = state === 'activating' || state === 'deactivating';

        this._toggle.gicon = Gio.icon_new_for_string(
            `${this._iconsPath}/${on ? ON_ICON : OFF_ICON}.svg`);
        this._toggle.checked = on;
        this._toggle.subtitle = this._labelForState(state);
        this._toggle.reactive = !busy;
    }

    _labelForState(state) {
        switch (state) {
        case 'active':
            return _('Active');
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

    destroy() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        this._toggle = null;
    }
}

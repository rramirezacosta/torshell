const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Util = imports.misc.util;
const PKEXEC_PATH = GLib.find_program_in_path('pkexec');
let numbersOfPkexecProcess = 0;

let text, button, icon;
let maxNumberOfTry = 10;
let numberOfTry = 0;
let action = "start";
const DisabledIcon = 'torshell-off-symbolic';
const EnabledIcon = 'torshell-on-symbolic';

function getNumbersOfPkexecProcess() {
    let [resPkExec, outPkExec] = GLib.spawn_command_line_sync("pgrep pkexec -c");
    let outPkExecString = outPkExec.toString().replace(/(\r\n|\n|\r)/gm, "").trim();
    return outPkExecString;
}

function isPkExecThreadActive() {
    res = true;
    if (numbersOfPkexecProcess == getNumbersOfPkexecProcess()) {
        res = false;
    }
    return res;
}

function isTorActive() {
    let [resTor, outTor] = GLib.spawn_command_line_sync("systemctl is-active tor");
    let outTorString = outTor.toString().replace(/(\r\n|\n|\r)/gm, "");
    return outTorString == "active";
}

function refreshUI() {
    icon.gicon = isTorActive() ? Gio.icon_new_for_string(`${Me.path}/icons/${EnabledIcon}.svg`) : Gio.icon_new_for_string(`${Me.path}/icons/${DisabledIcon}.svg`);

}

function update_proxy_settings() {
    if (isTorActive()) {
        Util.trySpawnCommandLine("dconf write /system/proxy/socks/host " + '"' + "'127.0.0.1'" + '"')
        Util.trySpawnCommandLine("dconf write /system/proxy/socks/port 9050")
        Util.trySpawnCommandLine("dconf write /system/proxy/mode " + '"' + "'manual'" + '"')
    } else {
        Util.trySpawnCommandLine("dconf write /system/proxy/mode " + '"' + "'none'" + '"')
    }
}


function _isJobDone() {
    let done = false;
    if (action == "start") { done = isTorActive(); }
    else { done = !isTorActive(); }
    if (!isPkExecThreadActive()) {
        if (done) {
            numberOfTry = 0;
            refreshUI();
            update_proxy_settings();
            return false;
        }
        if (numberOfTry > maxNumberOfTry) {
            Main.notify('There was a problem ' + action + 'ing your TOR Daemon');
            return false;
        }
        numberOfTry++;

    }
    return true;
}


function _toggle_tor() {
    if (isTorActive()) {
        action = "stop";
    } else {
        action = "start";
    }

    numbersOfPkexecProcess = getNumbersOfPkexecProcess();

    let cmd = PKEXEC_PATH + ' systemctl ' + action + ' ' + ' tor';
    numberOfTry = 0;
    try {
        Util.trySpawnCommandLine(cmd);
        GLib.timeout_add(0, 300, _isJobDone);
    } catch (Exception) {
        Main.notify("Crash !" + Exception);
    }
}


function init() {
    button = new St.Bin({
        style_class: 'panel-button',
        reactive: true,
        can_focus: true,
        track_hover: true
    });

    icon = new St.Icon({
        icon_name: DisabledIcon,
        style_class: 'system-status-icon'
    });

    button.set_child(icon);
    button.add_style_class_name('panel-status-button');
    button.connect('button-press-event', _toggle_tor);
}

function enable() {
    Main.panel._rightBox.insert_child_at_index(button, 0);
    refreshUI();
    update_proxy_settings();
}

function disable() {
    Main.panel._rightBox.remove_child(button);
}

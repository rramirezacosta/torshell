// Verifies the systemd D-Bus mechanism used by TorService: LoadUnit followed
// by a Unit proxy exposing ActiveState. Skips when the unit is not installed.
// Run with: gjs -m tests/test-systemd.js

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const UNIT_NAME = 'tor.service';
const KNOWN_STATES = [
    'active', 'activating', 'deactivating', 'inactive',
    'failed', 'reloading', 'maintenance',
];

const loop = GLib.MainLoop.new(null, false);

function fail(message) {
    printerr(`systemd: FAIL: ${message}`);
    System.exit(1);
}

function skip(message) {
    print(`systemd: SKIP: ${message}`);
    loop.quit();
}

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
    fail('timed out waiting for systemd');
    return GLib.SOURCE_REMOVE;
});

Gio.DBus.system.call(
    'org.freedesktop.systemd1',
    '/org/freedesktop/systemd1',
    'org.freedesktop.systemd1.Manager',
    'LoadUnit',
    new GLib.Variant('(s)', [UNIT_NAME]),
    new GLib.VariantType('(o)'),
    Gio.DBusCallFlags.NONE,
    -1,
    null,
    (connection, result) => {
        let objectPath;
        try {
            const reply = connection.call_finish(result);
            [objectPath] = reply.deep_unpack();
        } catch (e) {
            if (e.message.includes('not found') || e.message.includes('No such unit'))
                skip(`${UNIT_NAME} is not installed`);
            else
                fail(`LoadUnit failed: ${e.message}`);
            return;
        }

        if (!objectPath?.startsWith('/org/freedesktop/systemd1/unit/'))
            fail(`unexpected object path: ${objectPath}`);

        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.systemd1',
            objectPath,
            'org.freedesktop.systemd1.Unit',
            null,
            (_source, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    fail(`could not create Unit proxy: ${e.message}`);
                    return;
                }

                const variant = proxy.get_cached_property('ActiveState');
                if (!variant) {
                    fail('Unit proxy has no cached ActiveState');
                    return;
                }

                const state = variant.unpack();
                if (!KNOWN_STATES.includes(state))
                    fail(`unexpected ActiveState: ${state}`);

                print(`systemd: OK (${objectPath} -> ${state})`);
                loop.quit();
            });
    });

loop.run();

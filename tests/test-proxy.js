// Exercises ProxyManager against an isolated (in-memory) GSettings backend.
// Run with: GSETTINGS_BACKEND=memory gjs -m tests/test-proxy.js

import Gio from 'gi://Gio';

import {ProxyManager} from '../TorShell@itepo.mx/proxy.js';

const SOCKS_PORT = 9050;

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function makeSettings({manageProxy = true, restoreProxy = true} = {}) {
    return {
        get_uint: key => {
            assert(key === 'socks-port', `unexpected get_uint(${key})`);
            return SOCKS_PORT;
        },
        get_boolean: key => {
            if (key === 'manage-proxy')
                return manageProxy;
            if (key === 'restore-proxy')
                return restoreProxy;
            throw new Error(`unexpected get_boolean(${key})`);
        },
    };
}

const proxy = new Gio.Settings({schema_id: 'org.gnome.system.proxy'});
const socks = new Gio.Settings({schema_id: 'org.gnome.system.proxy.socks'});

// Simulate a user with an existing automatic proxy configuration.
proxy.set_string('mode', 'auto');
proxy.set_string('autoconfig-url', 'http://example.test/proxy.pac');
socks.set_string('host', '10.0.0.1');
socks.set_int('port', 1234);
proxy.set_strv('ignore-hosts', ['example.com']);

const manager = new ProxyManager(makeSettings());

// Restoring before applying must be a no-op.
manager.restore();
assert(proxy.get_string('mode') === 'auto', 'restore() without apply() changed the mode');

manager.apply();
assert(proxy.get_string('mode') === 'manual', 'apply() did not set manual mode');
assert(socks.get_string('host') === '127.0.0.1', 'apply() did not point SOCKS at localhost');
assert(socks.get_int('port') === SOCKS_PORT, 'apply() did not set the configured SOCKS port');
assert(proxy.get_string('autoconfig-url') === 'http://example.test/proxy.pac',
    'apply() clobbered autoconfig-url');

const ignoreHosts = proxy.get_strv('ignore-hosts');
for (const host of ['example.com', 'localhost', '127.0.0.0/8', '::1'])
    assert(ignoreHosts.includes(host), `apply() did not ignore ${host}`);

// Applying twice must keep the original snapshot.
manager.apply();
assert(proxy.get_string('mode') === 'manual', 'second apply() changed the mode');

manager.restore();
assert(proxy.get_string('mode') === 'auto', 'restore() did not restore the mode');
assert(socks.get_string('host') === '10.0.0.1', 'restore() did not restore the SOCKS host');
assert(socks.get_int('port') === 1234, 'restore() did not restore the SOCKS port');
assert(proxy.get_strv('ignore-hosts').join(',') === 'example.com',
    'restore() did not restore ignore-hosts');
assert(proxy.get_string('autoconfig-url') === 'http://example.test/proxy.pac',
    'restore() changed autoconfig-url');

// With restore-proxy disabled, stopping Tor must force the proxy off.
proxy.set_string('mode', 'auto');
const noRestore = new ProxyManager(makeSettings({restoreProxy: false}));
noRestore.apply();
assert(proxy.get_string('mode') === 'manual', 'apply() did not set manual mode');
noRestore.restore();
assert(proxy.get_string('mode') === 'none',
    'restore-proxy=false did not disable the proxy');

print('proxy: OK');

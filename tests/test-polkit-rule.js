import {buildPolkitRule} from '../TorShell@itepo.mx/polkitRule.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const rule = buildPolkitRule('tor.service');
assert(rule.includes("action.lookup('unit') !== \"tor.service\""),
    'rule does not match the configured unit');
assert(rule.includes("org.freedesktop.systemd1.manage-units"),
    'rule does not target the systemd manage-units action');
assert(rule.includes("action.lookup('verb') !== 'start'"),
    'rule does not restrict the verb');
assert(rule.includes('!subject.local || !subject.active'),
    'rule does not require a local active session');
assert(rule.includes('polkit.Result.YES'), 'rule does not authorize the action');

// A malicious unit name must stay inside a single, escaped string literal.
const malicious = 'tor.service"; return polkit.Result.YES; //';
const escaped = buildPolkitRule(malicious);
assert(escaped.includes(JSON.stringify(malicious)),
    'unit name was not JSON-escaped');
assert(!escaped.includes(`!== ${malicious}`),
    'unit name broke out of the string literal');

print('polkit rule: OK');

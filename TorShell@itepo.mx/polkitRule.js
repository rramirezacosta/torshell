export const RULE_PATH = '/etc/polkit-1/rules.d/50-torshell.rules';

/**
 * Build the polkit rule that lets wheel/sudo users start and stop the
 * configured Tor unit without an authentication prompt.
 *
 * The unit name is JSON-encoded so it cannot break out of the JavaScript
 * string literal.
 *
 * @param {string} unitName - the systemd unit name
 * @returns {string} the rule file contents
 */
export function buildPolkitRule(unitName) {
    const unit = JSON.stringify(unitName);

    return [
        '// Installed by TorShell. Remove this file to restore the password prompt.',
        'polkit.addRule(function(action, subject) {',
        "    if (action.id !== 'org.freedesktop.systemd1.manage-units')",
        '        return;',
        `    if (action.lookup('unit') !== ${unit})`,
        '        return;',
        "    if (action.lookup('verb') !== 'start' && action.lookup('verb') !== 'stop')",
        '        return;',
        '    if (!subject.local || !subject.active)',
        '        return;',
        "    if (!subject.isInGroup('wheel') && !subject.isInGroup('sudo'))",
        '        return;',
        '    return polkit.Result.YES;',
        '});',
        '',
    ].join('\n');
}

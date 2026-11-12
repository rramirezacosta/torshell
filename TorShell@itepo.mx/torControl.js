import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const HOST = '127.0.0.1';
const CONNECT_TIMEOUT = 3; // seconds
const REPLY_TIMEOUT = 5;   // seconds

Gio._promisify(Gio.SocketClient.prototype, 'connect_to_host_async', 'connect_to_host_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async', 'write_all_finish');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish_utf8');

/**
 * Minimal Tor control-port client used by the “New Tor identity” action.
 *
 * Authentication is attempted with Tor’s cookie file first (hex-encoded),
 * then with the configured password, and finally with no credentials.
 */
export class TorControl {
    constructor(settings) {
        this._settings = settings;
        this._probeCancellable = null;
        this._actionCancellable = null;
    }

    async probe() {
        this._probeCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._probeCancellable = cancellable;

        const timeoutId = this._addTimeout(cancellable);
        let connection = null;
        try {
            connection = await this._connect(cancellable);
            const {input, output} = this._streams(connection);
            // PROTOCOLINFO needs no authentication and proves that this is
            // actually Tor and not some other process listening on the port.
            await this._command(output, input, 'PROTOCOLINFO 1', cancellable);
            return true;
        } catch {
            return false;
        } finally {
            this._removeTimeout(timeoutId);
            if (this._probeCancellable === cancellable)
                this._probeCancellable = null;
            this._close(connection);
        }
    }

    async newIdentity() {
        this._actionCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._actionCancellable = cancellable;

        let timedOut = false;
        const timeoutId = this._addTimeout(cancellable, () => {
            timedOut = true;
        });

        try {
            await this._authenticateAndSignal(cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                throw new Error(timedOut
                    ? _('Timed out waiting for the Tor control port.')
                    : _('The Tor control request was cancelled.'));
            }
            throw e;
        } finally {
            this._removeTimeout(timeoutId);
            if (this._actionCancellable === cancellable)
                this._actionCancellable = null;
        }
    }

    destroy() {
        this._probeCancellable?.cancel();
        this._probeCancellable = null;

        this._actionCancellable?.cancel();
        this._actionCancellable = null;

        this._settings = null;
    }

    async _connect(cancellable) {
        const client = new Gio.SocketClient({timeout: CONNECT_TIMEOUT});
        return client.connect_to_host_async(
            HOST, this._settings.get_uint('control-port'), cancellable);
    }

    async _authenticateAndSignal(cancellable) {
        let lastError = null;

        for (const credentials of this._credentialCandidates()) {
            const connection = await this._connect(cancellable);
            try {
                const {input, output} = this._streams(connection);
                await this._command(output, input, 'PROTOCOLINFO 1', cancellable);

                try {
                    await this._command(output, input,
                        credentials ? `AUTHENTICATE ${credentials}` : 'AUTHENTICATE',
                        cancellable);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        throw e;
                    // Tor closes the connection after a failed authentication,
                    // so retry with the next credential on a fresh connection.
                    lastError = e;
                    continue;
                }

                await this._command(output, input, 'SIGNAL NEWNYM', cancellable);

                try {
                    await this._write(output, 'QUIT\r\n', cancellable);
                } catch {
                    // Closing the connection is enough.
                }

                return;
            } finally {
                this._close(connection);
            }
        }

        if (lastError)
            console.debug(`TorShell: Tor control authentication failed: ${lastError.message}`);
        throw new Error(_('Tor authentication failed.'));
    }

    _streams(connection) {
        return {
            input: new Gio.DataInputStream({
                base_stream: connection.get_input_stream(),
            }),
            output: connection.get_output_stream(),
        };
    }

    async _command(output, input, command, cancellable) {
        await this._write(output, `${command}\r\n`, cancellable);

        const reply = await this._readReply(input, cancellable);
        if (reply.code !== 250) {
            const last = reply.lines[reply.lines.length - 1];
            throw new Error(last ?? _('Tor rejected the command.'));
        }
    }

    async _readReply(input, cancellable) {
        const lines = [];

        while (true) {
            const [line] = await input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
            if (line === null)
                throw new Error(_('Tor closed the control connection.'));

            const clean = line.replace(/\r$/, '');
            lines.push(clean);

            const match = /^(\d{3})([ -])/.exec(clean);
            if (match && match[2] === ' ')
                return {code: Number(match[1]), lines};
        }
    }

    async _write(output, text, cancellable) {
        await output.write_all_async(
            new TextEncoder().encode(text), GLib.PRIORITY_DEFAULT, cancellable);
    }

    _credentialCandidates() {
        const candidates = [];

        const cookie = this._readCookie();
        if (cookie)
            candidates.push(cookie);

        const password = this._settings.get_string('control-password');
        if (password)
            candidates.push(`"${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

        candidates.push('');
        return candidates;
    }

    _readCookie() {
        const cookiePath = this._settings.get_string('control-cookie-path');
        if (!cookiePath)
            return null;

        try {
            const [ok, contents] = GLib.file_get_contents(cookiePath);
            if (!ok || contents.length === 0)
                return null;

            const bytes = contents instanceof Uint8Array
                ? contents
                : new TextEncoder().encode(String(contents));

            let hex = '';
            for (const byte of bytes)
                hex += byte.toString(16).padStart(2, '0');
            return hex;
        } catch {
            return null;
        }
    }

    _addTimeout(cancellable, onTimeout) {
        const timeout = {id: 0};
        timeout.id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REPLY_TIMEOUT, () => {
            timeout.id = 0;
            onTimeout?.();
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        return timeout;
    }

    _removeTimeout(timeout) {
        if (timeout?.id)
            GLib.source_remove(timeout.id);
        if (timeout)
            timeout.id = 0;
    }

    _close(connection) {
        try {
            connection?.close(null);
        } catch {
            // Already closed.
        }
    }
}

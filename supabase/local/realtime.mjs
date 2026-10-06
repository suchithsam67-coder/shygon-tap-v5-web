// A Realtime endpoint that accepts subscriptions and never delivers changes
// (local stack, V6, D-4).
//
// The signed-in app subscribes to two channels (new notifications, order
// updates). Without an endpoint the browser logs a failed WebSocket on every
// page; with this one the channels join and simply stay quiet. No test may
// rely on a Realtime push: the app must also show the change on its own
// refresh, and that is what the journeys check.
//
// It is a minimal RFC 6455 server (text frames, ping/pong, close) speaking
// the Phoenix channel protocol in both the v1 (object) and v2 (array) forms.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Yields complete frames from `buffer`; returns the unread tail. */
function readFrames(buffer, onFrame) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < cursor + maskLength + length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskLength;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    onFrame(opcode, payload);
    offset = cursor + length;
  }
  return buffer.subarray(offset);
}

function reply(message, response = {}) {
  return { topic: message.topic, event: 'phx_reply', payload: { status: 'ok', response }, ref: message.ref, join_ref: message.join_ref };
}

/** Handles an HTTP upgrade for /realtime/v1/websocket. */
export function acceptRealtime(request, socket) {
  const key = request.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let pending = Buffer.alloc(0);
  let arrayForm = false;
  const send = (message) => {
    const text = arrayForm
      ? JSON.stringify([message.join_ref ?? null, message.ref ?? null, message.topic, message.event, message.payload])
      : JSON.stringify(message);
    if (!socket.destroyed) socket.write(frame(text));
  };

  socket.on('data', (chunk) => {
    pending = readFrames(Buffer.concat([pending, chunk]), (opcode, payload) => {
      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        return;
      }
      if (opcode !== 0x1) return;
      let message;
      try {
        const parsed = JSON.parse(payload.toString('utf8'));
        if (Array.isArray(parsed)) {
          arrayForm = true;
          const [join_ref, ref, topic, event, body] = parsed;
          message = { join_ref, ref, topic, event, payload: body };
        } else {
          message = parsed;
        }
      } catch {
        return;
      }
      if (message.event === 'phx_join') {
        const requested = message.payload?.config?.postgres_changes ?? [];
        const postgres_changes = requested.map((binding, i) => ({ ...binding, id: 1000 + i }));
        send(reply(message, { postgres_changes }));
        if (requested.length) {
          send({
            topic: message.topic,
            event: 'system',
            payload: { channel: message.topic.replace(/^realtime:/, ''), extension: 'postgres_changes', message: 'Subscribed to PostgreSQL', status: 'ok' },
            ref: null,
          });
        }
      } else if (message.event === 'heartbeat' || message.event === 'phx_leave' || message.event === 'access_token') {
        send(reply(message));
      }
    });
  });
  socket.on('error', () => socket.destroy());
}

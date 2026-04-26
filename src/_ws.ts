import type { TLSSocket } from "node:tls";

const WS_OPCODES = { TEXT: 0x01, BINARY: 0x02, CLOSE: 0x08, PING: 0x09, PONG: 0x0a } as const;

export type WSMessageEvent = { data: Buffer; isBinary: boolean };

export class WebSocket {
  private socket!: TLSSocket;
  private buf = Buffer.alloc(0);

  onmessage?: (event: WSMessageEvent) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  private constructor() {}

  static connect(url: string, headers: Record<string, string>): Promise<WebSocket> {
    const instance = new WebSocket();
    return instance._connect(url, headers);
  }

  send(data: string): void {
    const payload = Buffer.from(data, "utf-8");
    const mask = crypto.getRandomValues(new Uint8Array(4));
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) {
      masked[i]! ^= mask[i & 3]!;
    }

    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | WS_OPCODES.TEXT, 0x80 | payload.length, ...mask]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | WS_OPCODES.TEXT;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      header.set(mask, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | WS_OPCODES.TEXT;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      header.set(mask, 10);
    }

    this.socket.write(Buffer.concat([header, masked]));
  }

  close(): void {
    const mask = crypto.getRandomValues(new Uint8Array(4));
    this.socket.write(Buffer.from([0x80 | WS_OPCODES.CLOSE, 0x80 | 0, ...mask]));
    this.socket.end();
  }

  private _connect(url: string, headers: Record<string, string>): Promise<WebSocket> {
    const tls: typeof import("node:tls") = globalThis.process?.getBuiltinModule?.("node:tls");
    const parsed = new URL(url);
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host: parsed.hostname, port: 443, servername: parsed.hostname },
        () => {
          const path = parsed.pathname + parsed.search;
          const lines = [
            `GET ${path} HTTP/1.1`,
            `Host: ${headers.host || parsed.hostname}`,
            `Upgrade: websocket`,
            `Connection: Upgrade`,
            `Sec-WebSocket-Key: ${key}`,
            `Sec-WebSocket-Version: 13`,
            ...Object.entries(headers)
              .filter(([k]) => k.toLowerCase() !== "host")
              .map(([k, v]) => `${k}: ${v}`),
            `\r\n`,
          ];
          socket.write(lines.join("\r\n"));
        },
      );

      let handshakeDone = false;
      let handshakeBuf = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        if (handshakeDone) return;
        handshakeBuf = Buffer.concat([handshakeBuf, chunk]);
        const idx = handshakeBuf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const statusLine = handshakeBuf.subarray(0, handshakeBuf.indexOf(0x0d)).toString();
        if (!statusLine.includes(" 101 ")) {
          socket.destroy();
          reject(new Error(`WebSocket upgrade failed: ${statusLine}`));
          return;
        }
        handshakeDone = true;
        const remaining = handshakeBuf.subarray(idx + 4);
        if (remaining.length > 0) {
          socket.unshift(remaining);
        }
        this.socket = socket;
        this._startReading();
        resolve(this);
      });

      socket.on("error", (err) => {
        if (!handshakeDone) {
          reject(err);
        } else {
          this.onerror?.(err);
        }
      });

      socket.on("close", () => {
        this.onclose?.();
      });
    });
  }

  private _startReading(): void {
    this.socket.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);

      while (this.buf.length >= 2) {
        const opcode = this.buf[0]! & 0x0f;
        const isMasked = (this.buf[1]! & 0x80) !== 0;
        let payloadLen = this.buf[1]! & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (this.buf.length < 4) return;
          payloadLen = this.buf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (this.buf.length < 10) return;
          payloadLen = Number(this.buf.readBigUInt64BE(2));
          offset = 10;
        }

        if (isMasked) offset += 4;
        if (this.buf.length < offset + payloadLen) return;

        const payload = this.buf.subarray(offset, offset + payloadLen);
        this.buf = this.buf.subarray(offset + payloadLen);

        if (opcode === WS_OPCODES.PING) {
          const mask = crypto.getRandomValues(new Uint8Array(4));
          const masked = Buffer.from(payload);
          for (let i = 0; i < masked.length; i++) masked[i]! ^= mask[i & 3]!;
          let hdr: Buffer;
          if (payload.length < 126) {
            hdr = Buffer.from([0x80 | WS_OPCODES.PONG, 0x80 | payload.length, ...mask]);
          } else if (payload.length < 65536) {
            hdr = Buffer.alloc(8);
            hdr[0] = 0x80 | WS_OPCODES.PONG;
            hdr[1] = 0x80 | 126;
            hdr.writeUInt16BE(payload.length, 2);
            hdr.set(mask, 4);
          } else {
            hdr = Buffer.alloc(14);
            hdr[0] = 0x80 | WS_OPCODES.PONG;
            hdr[1] = 0x80 | 127;
            hdr.writeBigUInt64BE(BigInt(payload.length), 2);
            hdr.set(mask, 10);
          }
          this.socket.write(Buffer.concat([hdr, masked]));
        } else if (opcode === WS_OPCODES.TEXT || opcode === WS_OPCODES.BINARY) {
          this.onmessage?.({ data: Buffer.from(payload), isBinary: opcode === WS_OPCODES.BINARY });
        } else if (opcode === WS_OPCODES.CLOSE) {
          this.socket.end();
        }
      }
    });
  }
}

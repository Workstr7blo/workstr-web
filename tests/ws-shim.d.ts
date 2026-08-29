declare module 'ws' {
  import type { Server as HttpServer } from 'node:http';

  export class WebSocket {
    readonly OPEN: number;
    readonly readyState: number;
    send(data: string): void;
    on(event: 'message', listener: (data: Buffer | string) => void): this;
    on(event: 'close', listener: () => void): this;
  }

  export class WebSocketServer {
    constructor(options: { server: HttpServer });
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
    close(callback?: () => void): void;
  }
}

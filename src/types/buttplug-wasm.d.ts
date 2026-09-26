declare module 'buttplug-wasm/dist/buttplug-wasm.mjs' {
  import type { IButtplugClientConnector, ButtplugMessage } from 'buttplug';
  import { EventEmitter } from 'events';

  export class ButtplugWasmClientConnector extends EventEmitter implements IButtplugClientConnector {
    constructor();
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(msg: ButtplugMessage): void;
  }
}

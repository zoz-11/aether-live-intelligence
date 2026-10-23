import { EventEmitter } from 'node:events';

export interface BusEvent {
  type: string;
  data?: unknown;
  ts: string;
}

/** Process-wide event bus. Every UI client subscribes through /api/events (SSE). */
export class EventBus {
  private ee = new EventEmitter();
  constructor() { this.ee.setMaxListeners(200); }

  publish(type: string, data?: unknown) {
    const ev: BusEvent = { type, data, ts: new Date().toISOString() };
    this.ee.emit('event', ev);
    this.ee.emit(type, ev);
  }

  subscribe(fn: (ev: BusEvent) => void): () => void {
    this.ee.on('event', fn);
    return () => this.ee.off('event', fn);
  }

  on(type: string, fn: (ev: BusEvent) => void): () => void {
    this.ee.on(type, fn);
    return () => this.ee.off(type, fn);
  }
}

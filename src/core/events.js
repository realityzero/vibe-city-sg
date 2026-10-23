// Tiny event bus.
export class Events {
  constructor() { this.m = new Map(); }
  on(name, fn) { if (!this.m.has(name)) this.m.set(name, new Set()); this.m.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.m.get(name)?.delete(fn); }
  once(name, fn) { const off = this.on(name, (...a) => { off(); fn(...a); }); return off; }
  emit(name, ...a) { for (const fn of [...(this.m.get(name) || [])]) { try { fn(...a); } catch (e) { console.error(`event ${name}`, e); } } }
  wait(name, filter) { return new Promise(res => { const off = this.on(name, (...a) => { if (!filter || filter(...a)) { off(); res(a[0]); } }); }); }
}

// Storage-agnostic document database used by every server handler.
// Production uses Firestore (FirestoreDb). Local development and automated
// end-to-end tests use MemoryDb, which mirrors the same semantics, because the
// Firestore emulator can't be downloaded in every environment.
import fs from 'node:fs';

export type Data = Record<string, any>;
export type Filter = [string, '==' | 'array-contains' | 'in' | '<=' | '>=' | '<' | '>' | '!=', unknown];

export interface Tx {
  get<T = Data>(path: string): Promise<T | null>;
  set(path: string, data: Data, opts?: { merge?: boolean }): void;
  create(path: string, data: Data): void;
  update(path: string, data: Data): void;
}

export interface Db {
  get<T = Data>(path: string): Promise<T | null>;
  getMany<T = Data>(paths: string[]): Promise<(T | null)[]>;
  list<T = Data>(collection: string, filters?: Filter[], opts?: { limit?: number; orderBy?: [string, 'asc' | 'desc'] }): Promise<T[]>;
  set(path: string, data: Data, opts?: { merge?: boolean }): Promise<void>;
  /** Creates a document, throwing AlreadyExistsError if it exists (used for idempotency keys). */
  create(path: string, data: Data): Promise<void>;
  update(path: string, data: Data): Promise<void>;
  delete(path: string): Promise<void>;
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
  newId(): string;
}

export class AlreadyExistsError extends Error {
  constructor(path: string) { super(`Document already exists: ${path}`); }
}
export class NotFoundError extends Error {
  constructor(path: string) { super(`Document not found: ${path}`); }
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function getField(obj: Data, field: string): any {
  return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function matches(doc: Data, [field, op, value]: Filter): boolean {
  const v = getField(doc, field);
  switch (op) {
    case '==': return v === value;
    case '!=': return v !== value && v !== undefined;
    case 'array-contains': return Array.isArray(v) && v.includes(value);
    case 'in': return Array.isArray(value) && value.includes(v);
    case '<=': return v !== undefined && v <= (value as any);
    case '>=': return v !== undefined && v >= (value as any);
    case '<': return v !== undefined && v < (value as any);
    case '>': return v !== undefined && v > (value as any);
  }
}

function merge(target: Data, patch: Data): Data {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k.includes('.')) {
      const parts = k.split('.');
      let o: Data = out;
      for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = { ...(o[parts[i]] ?? {}) }; o = o[parts[i]]; }
      o[parts[parts.length - 1]] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function stripUndefined(d: Data): Data { return clone(d); }

export class MemoryDb implements Db {
  private docs = new Map<string, Data>();
  private lock: Promise<unknown> = Promise.resolve();
  private counter = 0;
  constructor(private persistFile?: string) {
    if (persistFile && fs.existsSync(persistFile)) {
      const raw = JSON.parse(fs.readFileSync(persistFile, 'utf8')) as Record<string, Data>;
      for (const [k, v] of Object.entries(raw)) this.docs.set(k, v);
    }
  }
  private persist() {
    if (!this.persistFile) return;
    fs.writeFileSync(this.persistFile, JSON.stringify(Object.fromEntries(this.docs)));
  }
  newId() {
    this.counter++;
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + this.counter.toString(36)).slice(0, 20);
  }
  async get<T>(path: string) { const d = this.docs.get(path); return d ? (clone(d) as T) : null; }
  async getMany<T>(paths: string[]) { return Promise.all(paths.map((p) => this.get<T>(p))); }
  async list<T>(collection: string, filters: Filter[] = [], opts: { limit?: number; orderBy?: [string, 'asc' | 'desc'] } = {}) {
    const prefix = collection + '/';
    let out: Data[] = [];
    for (const [k, v] of this.docs) {
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && filters.every((f) => matches(v, f))) out.push(clone(v));
    }
    if (opts.orderBy) {
      const [f, dir] = opts.orderBy;
      out.sort((a, b) => { const x = getField(a, f) ?? ''; const y = getField(b, f) ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
    }
    if (opts.limit) out = out.slice(0, opts.limit);
    return out as T[];
  }
  async set(path: string, data: Data, opts?: { merge?: boolean }) {
    this.docs.set(path, opts?.merge ? merge(this.docs.get(path) ?? {}, stripUndefined(data)) : stripUndefined(data));
    this.persist();
  }
  async create(path: string, data: Data) {
    if (this.docs.has(path)) throw new AlreadyExistsError(path);
    await this.set(path, data);
  }
  async update(path: string, data: Data) {
    const cur = this.docs.get(path);
    if (!cur) throw new NotFoundError(path);
    this.docs.set(path, merge(cur, stripUndefined(data)));
    this.persist();
  }
  async delete(path: string) { this.docs.delete(path); this.persist(); }
  async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    // Serialise transactions so concurrent writers see each other's results,
    // matching Firestore's optimistic-retry behaviour closely enough for tests.
    const run = this.lock.then(async () => {
      const writes: (() => void)[] = [];
      const tx: Tx = {
        get: (p) => this.get(p),
        set: (p, d, o) => writes.push(() => { this.docs.set(p, o?.merge ? merge(this.docs.get(p) ?? {}, stripUndefined(d)) : stripUndefined(d)); }),
        create: (p, d) => { if (this.docs.has(p)) throw new AlreadyExistsError(p); writes.push(() => this.docs.set(p, stripUndefined(d))); },
        update: (p, d) => { if (!this.docs.has(p)) throw new NotFoundError(p); writes.push(() => this.docs.set(p, merge(this.docs.get(p)!, stripUndefined(d)))); },
      };
      const result = await fn(tx);
      writes.forEach((w) => w());
      this.persist();
      return result;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }
  /** Test helper. */
  dump() { return Object.fromEntries(this.docs); }
}

// ---------------------------------------------------------------------------
// Firestore implementation (production)

export class FirestoreDb implements Db {
  constructor(private fs: import('firebase-admin/firestore').Firestore) {}
  newId() { return this.fs.collection('_').doc().id; }
  async get<T>(path: string) { const s = await this.fs.doc(path).get(); return s.exists ? (s.data() as T) : null; }
  async getMany<T>(paths: string[]) {
    if (!paths.length) return [];
    const snaps = await this.fs.getAll(...paths.map((p) => this.fs.doc(p)));
    return snaps.map((s) => (s.exists ? (s.data() as T) : null));
  }
  async list<T>(collection: string, filters: Filter[] = [], opts: { limit?: number; orderBy?: [string, 'asc' | 'desc'] } = {}) {
    let q: import('firebase-admin/firestore').Query = this.fs.collection(collection);
    for (const [f, op, v] of filters) q = q.where(f, op, v);
    if (opts.orderBy) q = q.orderBy(opts.orderBy[0], opts.orderBy[1]);
    if (opts.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as T);
  }
  async set(path: string, data: Data, opts?: { merge?: boolean }) { await this.fs.doc(path).set(data, { merge: !!opts?.merge }); }
  async create(path: string, data: Data) {
    try { await this.fs.doc(path).create(data); } catch (e: any) {
      if (e?.code === 6 || /ALREADY_EXISTS/.test(String(e?.message))) throw new AlreadyExistsError(path);
      throw e;
    }
  }
  async update(path: string, data: Data) { await this.fs.doc(path).update(data); }
  async delete(path: string) { await this.fs.doc(path).delete(); }
  async transaction<R>(fn: (tx: Tx) => Promise<R>) {
    return this.fs.runTransaction(async (t) => {
      const tx: Tx = {
        get: async (p) => { const s = await t.get(this.fs.doc(p)); return s.exists ? (s.data() as any) : null; },
        set: (p, d, o) => { t.set(this.fs.doc(p), d, { merge: !!o?.merge }); },
        create: (p, d) => { t.create(this.fs.doc(p), d); },
        update: (p, d) => { t.update(this.fs.doc(p), d); },
      };
      return fn(tx);
    });
  }
}

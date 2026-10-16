// Codificador Kiwi mínimo, só para os testes: monta esquemas e mensagens
// como os que vêm dentro de um arquivo .fig.
import type { KiwiDefinition } from '../src/import/kiwi';

const PRIMS = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];

class Writer {
  out: number[] = [];
  byte(v: number) {
    this.out.push(v & 255);
  }
  uint(v: number) {
    v >>>= 0;
    do {
      let b = v & 127;
      v >>>= 7;
      if (v) b |= 128;
      this.byte(b);
    } while (v);
  }
  int(v: number) {
    this.uint((v << 1) ^ (v >> 31));
  }
  uint64(v: bigint) {
    let shift = 0n;
    for (let i = 0; i < 8 && v >= 128n; i++, shift += 7n) {
      this.byte(Number(v & 127n) | 128);
      v >>= 7n;
    }
    this.byte(Number(v & 255n));
  }
  float(v: number) {
    const f = new Float32Array([v]);
    let bits = new Uint32Array(f.buffer)[0];
    bits = (bits >>> 23) | (bits << 9); // expoente na frente, como o Kiwi grava
    // zero (inclusive -0) e números minúsculos ocupam um byte só
    if ((bits & 255) === 0) return this.byte(0);
    this.byte(bits);
    this.byte(bits >>> 8);
    this.byte(bits >>> 16);
    this.byte(bits >>> 24);
  }
  string(s: string) {
    for (const b of new TextEncoder().encode(s)) this.byte(b);
    this.byte(0);
  }
}

export function encodeSchema(defs: KiwiDefinition[]): Uint8Array {
  const w = new Writer();
  const index = new Map(defs.map((d, i) => [d.name, i]));
  w.uint(defs.length);
  for (const d of defs) {
    w.string(d.name);
    w.byte(['ENUM', 'STRUCT', 'MESSAGE'].indexOf(d.kind));
    w.uint(d.fields.length);
    for (const f of d.fields) {
      w.string(f.name);
      const p = PRIMS.indexOf(f.type);
      w.int(p >= 0 ? ~p : index.get(f.type)!);
      w.byte(f.isArray ? 1 : 0);
      w.uint(f.value);
    }
  }
  return new Uint8Array(w.out);
}

export function encodeMessage(defs: KiwiDefinition[], root: string, value: Record<string, unknown>): Uint8Array {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const w = new Writer();
  const write = (type: string, v: unknown): void => {
    switch (type) {
      case 'bool': return w.byte(v ? 1 : 0);
      case 'byte': return w.byte(v as number);
      case 'int': return w.int(v as number);
      case 'uint': return w.uint(v as number);
      case 'float': return w.float(v as number);
      case 'string': return w.string(v as string);
      case 'uint64': return w.uint64(v as bigint);
      case 'int64': {
        const x = v as bigint;
        return w.uint64(x < 0n ? (~x << 1n) | 1n : x << 1n);
      }
    }
    const d = byName.get(type)!;
    if (d.kind === 'ENUM') return w.uint(d.fields.find((f) => f.name === v)!.value);
    const obj = v as Record<string, unknown>;
    for (const f of d.fields) {
      if (d.kind === 'MESSAGE' && obj[f.name] === undefined) continue;
      if (d.kind === 'MESSAGE') w.uint(f.value);
      const fv = obj[f.name];
      if (f.isArray) {
        if (f.type === 'byte') {
          const bytes = fv as Uint8Array;
          w.uint(bytes.length);
          for (const b of bytes) w.byte(b);
        } else {
          const list = fv as unknown[];
          w.uint(list.length);
          for (const x of list) write(f.type, x);
        }
      } else write(f.type, fv);
    }
    if (d.kind === 'MESSAGE') w.uint(0);
  };
  write(root, value);
  return new Uint8Array(w.out);
}

/** Atalho para declarar definições: { Nome: ['MESSAGE', [['campo', 'tipo', array?], …]] }. */
export function defs(spec: Record<string, ['ENUM' | 'STRUCT' | 'MESSAGE', [string, string, boolean?][]]>): KiwiDefinition[] {
  return Object.entries(spec).map(([name, [kind, fields]]) => ({
    name,
    kind,
    fields: fields.map(([fname, type, isArray], i) => ({ name: fname, type, isArray: !!isArray, value: kind === 'ENUM' ? i : kind === 'MESSAGE' ? i + 1 : i })),
  }));
}

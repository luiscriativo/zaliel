// Leitura do formato binário Kiwi (esquema + mensagem). Arquivos que usam Kiwi
// trazem o próprio esquema embutido, então a leitura é genérica: o resultado é
// um objeto comum com os nomes de campo do esquema.

export interface KiwiField {
  name: string;
  /** Tipo primitivo ("bool", "int"…) ou nome de outra definição. */
  type: string;
  isArray: boolean;
  value: number;
}

export interface KiwiDefinition {
  name: string;
  kind: 'ENUM' | 'STRUCT' | 'MESSAGE';
  fields: KiwiField[];
}

export interface KiwiSchema {
  package: string | null;
  definitions: KiwiDefinition[];
}

const PRIMITIVES = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'];
const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'] as const;

export class KiwiError extends Error {}

const END = new KiwiError('fim inesperado dos dados');

class Reader {
  i = 0;
  private f32 = new Float32Array(1);
  private u32 = new Uint32Array(this.f32.buffer);
  private text = new TextDecoder();
  constructor(public b: Uint8Array) {}

  byte(): number {
    if (this.i >= this.b.length) throw END;
    return this.b[this.i++];
  }

  bool(): boolean {
    const v = this.byte();
    if (v > 1) throw new KiwiError('booleano inválido');
    return v === 1;
  }

  uint(): number {
    const b = this.b;
    let v = 0, shift = 0, x: number;
    do {
      if (this.i >= b.length) throw END;
      x = b[this.i++];
      v |= (x & 127) << shift;
      shift += 7;
    } while (x & 128 && shift < 35);
    return v >>> 0;
  }

  int(): number {
    const v = this.uint();
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  }

  uint64(): bigint {
    // até 8 bytes de 7 bits; o 9º byte usa os 8 bits inteiros
    let v = 0n, shift = 0n, b: number;
    while ((b = this.byte()) & 128 && shift < 56n) {
      v |= BigInt(b & 127) << shift;
      shift += 7n;
    }
    return v | (BigInt(b) << shift);
  }

  int64(): bigint {
    const v = this.uint64();
    return v & 1n ? ~(v >> 1n) : v >> 1n;
  }

  /** Pula um inteiro variável de 32 bits. */
  skipVar(): void {
    const b = this.b;
    while (this.i < b.length && b[this.i++] & 128) {
      /* avança */
    }
  }

  /** Pula um inteiro variável de 64 bits (o 9º byte não tem marca de continuação). */
  skipVar64(): void {
    const b = this.b;
    for (let k = 0; k < 9; k++) {
      if (this.i >= b.length) throw END;
      if (!(b[this.i++] & 128) || k === 8) return;
    }
  }

  float(): number {
    const b = this.b;
    if (this.i >= b.length) throw END;
    const first = b[this.i];
    if (first === 0) {
      this.i++;
      return 0;
    }
    if (this.i + 4 > b.length) throw END;
    let bits = first | (b[this.i + 1] << 8) | (b[this.i + 2] << 16) | (b[this.i + 3] << 24);
    this.i += 4;
    bits = (bits << 23) | (bits >>> 9); // o expoente volta para o lugar
    this.u32[0] = bits;
    return this.f32[0];
  }

  skipFloat(): void {
    if (this.i >= this.b.length) throw END;
    this.i += this.b[this.i] === 0 ? 1 : 4;
  }

  string(): string {
    const b = this.b;
    const start = this.i;
    let ascii = true;
    for (;;) {
      if (this.i >= b.length) throw END;
      const c = b[this.i++];
      if (c === 0) break;
      if (c > 127) ascii = false;
    }
    const end = this.i - 1;
    if (ascii && end - start < 64) {
      let s = '';
      for (let k = start; k < end; k++) s += String.fromCharCode(b[k]);
      return s;
    }
    return this.text.decode(b.subarray(start, end));
  }

  skipString(): void {
    const b = this.b;
    for (;;) {
      if (this.i >= b.length) throw END;
      if (b[this.i++] === 0) return;
    }
  }

  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw END;
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
}

/** Lê um esquema Kiwi binário. */
export function decodeSchema(bytes: Uint8Array): KiwiSchema {
  const r = new Reader(bytes);
  const definitions: KiwiDefinition[] = [];
  const count = r.uint();
  for (let d = 0; d < count; d++) {
    const name = r.string();
    const kind = r.byte();
    const fieldCount = r.uint();
    if (kind > 2) throw new KiwiError('tipo de definição inválido');
    const fields: KiwiField[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const fname = r.string();
      const type = r.int();
      const isArray = !!(r.byte() & 1);
      const value = r.uint();
      fields.push({ name: fname, type: String(type), isArray, value });
    }
    definitions.push({ name, kind: KINDS[kind], fields });
  }
  // tipos: negativos são primitivos, positivos apontam para outra definição
  for (const def of definitions) {
    for (const f of def.fields) {
      const t = Number(f.type);
      if (t < 0) {
        const p = PRIMITIVES[~t];
        if (!p) throw new KiwiError('tipo primitivo inválido');
        f.type = p;
      } else {
        const target = definitions[t];
        if (!target) throw new KiwiError('tipo inexistente no esquema');
        f.type = target.name;
      }
    }
  }
  return { package: null, definitions };
}

export type KiwiValue = boolean | number | bigint | string | Uint8Array | KiwiValue[] | { [k: string]: KiwiValue };

type ReadFn = (r: Reader) => KiwiValue;
type SkipFn = (r: Reader) => void;

/**
 * Lê uma mensagem com o esquema. `root` é o nome da definição de topo (ex.: "Message").
 * `skip`: nomes de campos que não interessam — são pulados sem montar objetos (bem mais rápido).
 */
export function decodeMessage(schema: KiwiSchema, bytes: Uint8Array, root: string, skip: Iterable<string> = []): Record<string, KiwiValue> {
  const defs = new Map(schema.definitions.map((d) => [d.name, d]));
  const skipNames = new Set(skip);
  const readers = new Map<string, ReadFn>();
  const skippers = new Map<string, SkipFn>();

  const primitiveRead: Record<string, ReadFn> = {
    bool: (r) => r.bool(),
    byte: (r) => r.byte(),
    int: (r) => r.int(),
    uint: (r) => r.uint(),
    float: (r) => r.float(),
    string: (r) => r.string(),
    int64: (r) => r.int64(),
    uint64: (r) => r.uint64(),
  };
  const primitiveSkip: Record<string, SkipFn> = {
    bool: (r) => void r.byte(),
    byte: (r) => void r.byte(),
    int: (r) => r.skipVar(),
    uint: (r) => r.skipVar(),
    float: (r) => r.skipFloat(),
    string: (r) => r.skipString(),
    int64: (r) => r.skipVar64(),
    uint64: (r) => r.skipVar64(),
  };

  const fieldSkip = (f: KiwiField): SkipFn => {
    const one = skipperFor(f.type);
    if (!f.isArray) return one;
    if (f.type === 'byte') return (r) => void r.bytes(r.uint());
    return (r) => {
      for (let n = r.uint(); n > 0; n--) one(r);
    };
  };

  const fieldRead = (f: KiwiField): ReadFn => {
    const one = readerFor(f.type);
    if (!f.isArray) return one;
    // vetor de bytes: devolve o pedaço direto (blobs de geometria e imagens)
    if (f.type === 'byte') return (r) => r.bytes(r.uint());
    return (r) => {
      const n = r.uint();
      const list: KiwiValue[] = new Array(n);
      for (let k = 0; k < n; k++) list[k] = one(r);
      return list;
    };
  };

  function readerFor(type: string): ReadFn {
    const p = primitiveRead[type];
    if (p) return p;
    const cached = readers.get(type);
    if (cached) return cached;
    const def = defs.get(type);
    if (!def) throw new KiwiError(`tipo ${type} não existe no esquema`);
    // referência adiada: tipos recursivos (NodeChange dentro de NodeChange…)
    let fn: ReadFn = (r) => fn(r);
    readers.set(type, (r) => fn(r));
    if (def.kind === 'ENUM') {
      const names = new Map(def.fields.map((f) => [f.value, f.name]));
      fn = (r) => {
        const v = r.uint();
        return names.get(v) ?? v;
      };
    } else if (def.kind === 'STRUCT') {
      const parts = def.fields.map((f) => ({ name: f.name, read: fieldRead(f) }));
      fn = (r) => {
        const out: Record<string, KiwiValue> = {};
        for (const p of parts) out[p.name] = p.read(r);
        return out;
      };
    } else {
      const max = Math.max(0, ...def.fields.map((f) => f.value));
      const byValue: ({ name: string; read: ReadFn | null; skip: SkipFn } | undefined)[] = new Array(max + 1);
      for (const f of def.fields) byValue[f.value] = { name: f.name, read: skipNames.has(f.name) ? null : fieldRead(f), skip: fieldSkip(f) };
      fn = (r) => {
        const out: Record<string, KiwiValue> = {};
        for (;;) {
          const id = r.uint();
          if (id === 0) return out;
          const f = byValue[id];
          if (!f) throw new KiwiError(`campo ${id} desconhecido em ${def.name}`);
          if (f.read) out[f.name] = f.read(r);
          else f.skip(r);
        }
      };
    }
    return readers.get(type)!;
  }

  function skipperFor(type: string): SkipFn {
    const p = primitiveSkip[type];
    if (p) return p;
    const cached = skippers.get(type);
    if (cached) return cached;
    const def = defs.get(type);
    if (!def) throw new KiwiError(`tipo ${type} não existe no esquema`);
    let fn: SkipFn = (r) => fn(r);
    skippers.set(type, (r) => fn(r));
    if (def.kind === 'ENUM') fn = (r) => r.skipVar();
    else if (def.kind === 'STRUCT') {
      const parts = def.fields.map(fieldSkip);
      fn = (r) => {
        for (const p of parts) p(r);
      };
    } else {
      const max = Math.max(0, ...def.fields.map((f) => f.value));
      const byValue: (SkipFn | undefined)[] = new Array(max + 1);
      for (const f of def.fields) byValue[f.value] = fieldSkip(f);
      fn = (r) => {
        for (;;) {
          const id = r.uint();
          if (id === 0) return;
          const s = byValue[id];
          if (!s) throw new KiwiError(`campo ${id} desconhecido em ${def.name}`);
          s(r);
        }
      };
    }
    return skippers.get(type)!;
  }

  if (!defs.has(root)) throw new KiwiError(`o esquema não tem a definição ${root}`);
  return readerFor(root)(new Reader(bytes)) as Record<string, KiwiValue>;
}

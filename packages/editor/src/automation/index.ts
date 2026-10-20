// Ferramentas da automação local: o que um programa externo pode pedir ao editor.
// Cada ferramenta tem nome, descrição e esquema dos argumentos (JSON Schema); o
// servidor do processo principal só repassa os pedidos para cá.
import {
  createNode,
  createPage,
  reidentify,
  clone,
  uid,
  exportSvg,
  unionRects,
  hashText,
  imageSize,
  allStyles,
  variantAxes,
  buildPdf,
  splitRgba,
  deflate,
  ROOT,
  walk,
  type SceneNode,
  type Rect,
  type ContainerNode,
  type Op,
  type Style,
  type VariableCollection,
  type VariableValue,
  type Paint,
  type DocComment,
} from '@zaliel/core';
import type { Editor } from '../editor';
import { loadIconShapes } from '../engine/icons';
import { BuildContext, Converter, SpecError, parseColor, findVariableByName, type NodeSpec } from './spec';
import { nodeOut, inspect, analyze } from './read';
import { GUIDES, INSTRUCTIONS } from './guide';
import { loadChunk } from '../chunks';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run(args: Record<string, unknown>): Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: true });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const numb = (description: string) => ({ type: 'number', description });
const arr = (items: unknown, description: string) => ({ type: 'array', items, description });

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };

/** Termos em português mais comuns → nomes dos ícones (que são em inglês). */
const ICON_WORDS: Record<string, string> = {
  casa: 'home', inicio: 'home', início: 'home', usuario: 'user', usuário: 'user', pessoa: 'user', perfil: 'user', busca: 'search', buscar: 'search', pesquisa: 'search', lupa: 'search',
  configuracoes: 'settings', configurações: 'settings', ajustes: 'settings', engrenagem: 'settings', carrinho: 'shopping-cart', sacola: 'shopping-bag', sino: 'bell', notificação: 'bell', notificacao: 'bell',
  coracao: 'heart', coração: 'heart', favorito: 'heart', estrela: 'star', lixeira: 'trash', excluir: 'trash', apagar: 'trash', editar: 'pencil', lapis: 'pencil', lápis: 'pencil', fechar: 'x',
  seta: 'arrow', voltar: 'arrow-left', avançar: 'arrow-right', calendario: 'calendar', calendário: 'calendar', email: 'mail', 'e-mail': 'mail', carta: 'mail', telefone: 'phone', camera: 'camera', câmera: 'camera',
  imagem: 'image', foto: 'image', mapa: 'map', local: 'map-pin', localizacao: 'map-pin', localização: 'map-pin', cadeado: 'lock', senha: 'lock', olho: 'eye', baixar: 'download', enviar: 'send',
  compartilhar: 'share', filtro: 'filter', grafico: 'chart', gráfico: 'chart', dinheiro: 'dollar', carteira: 'wallet', cartao: 'credit-card', cartão: 'credit-card', sair: 'log-out', entrar: 'log-in',
  mais: 'plus', adicionar: 'plus', menos: 'minus', alerta: 'alert', aviso: 'alert-triangle', ajuda: 'help', relogio: 'clock', relógio: 'clock', tempo: 'clock', arquivo: 'file', pasta: 'folder',
  nuvem: 'cloud', chat: 'message', mensagem: 'message', conversa: 'message', globo: 'globe', idioma: 'languages', sol: 'sun', lua: 'moon', play: 'play', pausa: 'pause', musica: 'music', música: 'music',
  video: 'video', vídeo: 'video', microfone: 'mic', etiqueta: 'tag', presente: 'gift', casa2: 'house', carro: 'car', avião: 'plane', aviao: 'plane', onibus: 'bus', ônibus: 'bus', livro: 'book',
  escola: 'school', saude: 'heart-pulse', saúde: 'heart-pulse', hospital: 'hospital', loja: 'store', empresa: 'building', predio: 'building', prédio: 'building', check: 'check', confirmar: 'check',
  direita: 'right', esquerda: 'left', cima: 'up', baixo: 'down', acima: 'up', abaixo: 'down', circulo: 'circle', círculo: 'circle', quadrado: 'square', ponto: 'dot', vazio: 'empty', cheio: 'full',
    info: 'info', informação: 'info', lista: 'list', grade: 'grid', menu: 'menu', copiar: 'copy', link: 'link', anexo: 'paperclip', impressora: 'printer', escudo: 'shield', chave: 'key', bandeira: 'flag',
};

export function createAutomation(ed: Editor) {
  let queue: Promise<unknown> = Promise.resolve();
  let iconNames: string[] | null = null;

  const needDoc = () => {
    if (ed.home) throw new SpecError('nenhum arquivo aberto: use a ferramenta document com action "new" ou "open"');
  };

  /** Recursos das descrições (ícones, imagens, fontes) carregados antes de montar as camadas. */
  async function prepare(ctx: BuildContext, specs: unknown[]): Promise<void> {
    const icons = new Set<string>();
    const images = new Set<string>();
    const fonts = new Set<string>();
    const scan = (v: unknown) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(scan);
      const o = v as Record<string, unknown>;
      if (typeof o.icon === 'string') icons.add(o.icon);
      if (typeof o.src === 'string') images.add(o.src);
      if (typeof o.font === 'string' || o.weight !== undefined) fonts.add(`${o.font ?? 'Inter'}|${typeof o.weight === 'number' ? o.weight : 400}|${o.italic ? 1 : 0}`);
      for (const val of Object.values(o)) if (val && typeof val === 'object') scan(val);
    };
    specs.forEach(scan);
    if (icons.size) {
      const look = await loadIconShapes([...icons].map((name) => ({ library: 'lucide', name })));
      for (const name of icons) {
        const shape = look('lucide', name);
        if (shape) ctx.icons.set(name.toLowerCase(), shape);
      }
    }
    for (const src of images) {
      let mime = 'image/png';
      let data: string;
      // SVG vira vetores editáveis (o motor gráfico não abre SVG como bitmap)
      const utf8 = src.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?,(.*)$/i);
      if (utf8) {
        ctx.svgImages.set(src, decodeURIComponent(utf8[1]));
        continue;
      }
      const m = src.match(/^data:([^;,]+);base64,(.*)$/);
      if (m) {
        mime = m[1];
        data = m[2];
      } else {
        const read = ed.platform.automation?.readBinary;
        if (!read) throw new SpecError('não dá para ler arquivos de imagem neste ambiente; mande a imagem como data URL');
        try {
          data = await read(src);
        } catch {
          throw new SpecError(`não foi possível ler a imagem ${src}`);
        }
        mime = MIME[src.split('.').pop()!.toLowerCase()] ?? 'image/png';
      }
      if (mime === 'image/svg+xml') {
        ctx.svgImages.set(src, new TextDecoder().decode(fromBase64(data)));
        continue;
      }
      const size = imageSize(fromBase64(data.slice(0, 200000)));
      if (!size) throw new SpecError(`não é uma imagem que dá para abrir: ${src.slice(0, 80)}`);
      const key = hashText(data.slice(0, 20000) + data.length);
      if (!ed.doc.assets[key] && !ctx.assetOps.some((o) => o.op === 'asset' && o.key === key)) ctx.assetOps.push({ op: 'asset', key, value: { mime, data, width: size.width, height: size.height } });
      ctx.images.set(src, { key, width: size.width, height: size.height });
    }
    const host = ed.host;
    if (host) await Promise.all([...fonts].map((f) => {
      const [family, w, it] = f.split('|');
      return host.fonts.ensure(host.fonts.has(family) ? family : 'Inter', Number(w), it === '1');
    }));
  }

  /** Lugar livre na página para algo de largura × altura (à direita do conteúdo, ou abaixo). */
  function emptySpace(width: number, height: number, gap = 100, near?: string, direction: 'right' | 'below' = 'right'): { x: number; y: number } {
    const kids = ed.page.children.filter((n) => n.visible !== false);
    if (!kids.length) return { x: 0, y: 0 };
    const boxes = kids.map((n) => ed.worldBounds(n.id));
    const hit = (x: number, y: number) => boxes.some((b) => x < b.x + b.width + gap / 2 && x + width + gap / 2 > b.x && y < b.y + b.height + gap / 2 && y + height + gap / 2 > b.y);
    const ref = near ? ed.worldBounds(near) : unionRects(boxes);
    let x = direction === 'right' ? ref.x + ref.width + gap : ref.x;
    let y = direction === 'right' ? ref.y : ref.y + ref.height + gap;
    for (let i = 0; i < 400 && hit(x, y); i++) {
      if (direction === 'right') x += Math.max(40, width / 4);
      else y += Math.max(40, height / 4);
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  /** Executa as operações do lote; tudo vira um passo só do desfazer, e um erro desfaz o lote inteiro. */
  async function batchDesign(args: Record<string, unknown>): Promise<unknown> {
    needDoc();
    const ops = args.operations as Record<string, unknown>[];
    if (!Array.isArray(ops) || !ops.length) throw new SpecError('"operations" precisa ser uma lista com pelo menos uma operação');
    const ctx = new BuildContext(ed);
    const conv = new Converter(ctx);
    await prepare(ctx, ops);
    const start = ed.model.past.length;
    const selection = [...ed.selection];
    ed.strict = true;
    ed.notices = [];
    const results: unknown[] = [];
    let assetsDone = false;
    try {
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        try {
          const r = await runOp(op, ctx, conv, () => {
            const extra = assetsDone ? [] : ctx.assetOps;
            assetsDone = true;
            return extra;
          });
          results.push(r);
        } catch (e) {
          throw new SpecError(`operação ${i + 1} (${String(op.op ?? '?')}): ${(e as Error).message}`);
        }
      }
      if (!assetsDone && ctx.assetOps.length) ed.run('Imagens', ctx.assetOps);
      if (ctx.links.length) {
        const lops: Op[] = ctx.links.map(({ id, link }) => ({ op: 'set', id, key: 'interactions', value: [conv.interaction(link)] }) as Op);
        ed.run('Protótipo', lops);
      }
      ed.model.squash(start, String(args.label ?? 'Automação'));
    } catch (e) {
      ed.model.rollback(start);
      ed.select(selection.filter((id) => ed.model.index.get(id)));
      throw e;
    } finally {
      ed.strict = false;
      const notices = ed.notices ?? [];
      ed.notices = null;
      ctx.warnings.push(...notices.filter((n) => !n.startsWith('success') && !n.startsWith('info')));
    }
    // o que o lote mudou, pelas operações do próprio passo de desfazer (vale para qualquer operação)
    const step = ed.model.past.length > start ? ed.model.past[start] : undefined;
    const changed = (step?.redo ?? []).map((o) => (o.op === 'insert' ? o.node.id : 'id' in o ? (o.id as string) : '')).filter(Boolean);
    showAgent([...ctx.refs.values(), ...touchedIds(results), ...changed]);
    return { ok: true, created: Object.fromEntries(ctx.refs), results, ...(ctx.warnings.length ? { warnings: ctx.warnings } : {}) };
  }

  /** Ids que aparecem nos resultados das operações ({ id }, { ids }). */
  function touchedIds(v: unknown, out: string[] = []): string[] {
    if (Array.isArray(v)) for (const x of v) touchedIds(x, out);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string') out.push(o.id);
      if (Array.isArray(o.ids)) for (const x of o.ids) if (typeof x === 'string') out.push(x);
    }
    return out;
  }

  /**
   * Leva o cursor do agente até as camadas (da página aberta) e faz o percurso por dentro delas:
   * a camada, depois as partes principais (seções, cartões, componentes), como quem está trabalhando ali.
   * `look`: só está lendo ou capturando (contorno discreto).
   */
  function showAgent(list: string[], look = false): void {
    const host = ed.host;
    if (!host) return;
    const idx = ed.model.index;
    // tudo o que mudou está em outra página: a vista vai para lá (se o usuário não está mexendo nela)
    const alive = list.filter((id) => idx.get(id));
    if (alive.length && !alive.some((id) => idx.pageOf(id) === ed.pageId) && performance.now() - ed.userViewAt >= 4000) {
      const other = idx.pageOf(alive[0]);
      if (other) ed.setPage(other);
    }
    const set = new Set(alive.filter((id) => idx.pageOf(id) === ed.pageId));
    const tops = [...set].filter((id) => !idx.ancestors(id).some((a) => set.has(a.id)));
    if (!tops.length) return;
    const summary = tops.map((id) => ed.worldBounds(id));
    // percurso: cada camada e, por dentro, as partes grandes o bastante para se notar (em largura)
    const steps: Rect[] = [];
    const inner = (n: SceneNode): SceneNode[] => (n.type === 'instance' ? (n.slots ?? []).flatMap((h) => h.children) : 'children' in n ? n.children : []);
    for (const id of tops.slice(0, 6)) {
      const top = idx.get(id)!;
      const tb = ed.worldBounds(id);
      steps.push(tb);
      let level = inner(top);
      for (let depth = 0; depth < 4 && level.length && steps.length < 14; depth++) {
        const next: SceneNode[] = [];
        for (const n of level) {
          if (n.visible === false || !idx.get(n.id)) continue;
          const b = ed.worldBounds(n.id);
          const big = b.width * b.height > 1600;
          // camadas que só embrulham (do tamanho do pai) não contam como passo: entra nelas
          const wrapper = inner(n).length > 0 && b.width >= tb.width * 0.95 && b.height >= tb.height * 0.95;
          if (big && !wrapper && steps.length < 14) steps.push(b);
          next.push(...inner(n));
        }
        level = next;
      }
    }
    host.agent.visit(ed.pageId, steps, summary, look);
    // a vista acompanha onde o agente está mexendo (a camada principal, a primeira da lista)
    ed.glideTo(summary[0]);
    host.invalidate();
  }


  async function runOp(op: Record<string, unknown>, ctx: BuildContext, conv: Converter, assets: () => Op[]): Promise<unknown> {
    const kind = String(op.op ?? op.type ?? '');
    const idx = ed.model.index;
    const node = (id: unknown) => {
      const real = ctx.id(String(id))!;
      const n = idx.get(real);
      if (!n) throw new SpecError(`camada não encontrada: ${id}`);
      return n;
    };
    const ids = (v: unknown) => {
      const list = (Array.isArray(v) ? v : [v]).map((x) => ctx.id(String(x))!);
      if (!list.length) throw new SpecError('faltou "ids"');
      return list;
    };
    const setRef = (ref: unknown, id: string) => {
      if (typeof ref === 'string' && ref) ctx.refs.set(ref.replace(/^@/, ''), id);
    };
    const parentOf = (v: unknown) => {
      const pid = v === undefined || v === null || v === '' ? ed.pageId : ctx.id(String(v))!;
      if (!idx.page(pid) && !idx.siblings(pid)) throw new SpecError(`“${v}” não aceita camadas dentro`);
      return pid;
    };
    const hasLayout = (pid: string) => {
      const p = idx.get(pid);
      return !!p && 'layout' in p && !!p.layout;
    };
    const after = (props: unknown, id: string) => {
      if (!props || typeof props !== 'object') return;
      const ops2 = conv.patch(idx.get(id)!, props as NodeSpec);
      if (ops2.length) ed.run('Ajustar', ops2);
    };

    switch (kind) {
      case 'create':
      case 'insert': {
        const parent = parentOf(op.parent);
        const specs = (op.nodes ?? (op.node ? [op.node] : [])) as NodeSpec[];
        if (!specs.length) throw new SpecError('"create" precisa de "node" (ou "nodes")');
        const list = idx.siblings(parent)!;
        let index = typeof op.index === 'number' ? Math.max(0, Math.min(list.length, op.index)) : list.length;
        const created: unknown[] = [];
        for (const spec of specs) {
          const top = parent === ed.pageId;
          const built = conv.build(spec, hasLayout(parent), top);
          const holder = idx.get(parent);
          if (holder?.type === 'component-set') conv.intoSet(built, spec, holder as ContainerNode);
          // frame novo no topo sem posição: vai para um lugar livre
          if (top && spec.x === undefined && spec.y === undefined) {
            const at = emptySpace(built.width, built.height);
            built.x = at.x;
            built.y = at.y;
          }
          ed.run('Criar', [...assets(), { op: 'insert', parent, index: index++, node: built }]);
          created.push({ id: built.id, name: built.name, ...(spec.ref ? { ref: spec.ref } : {}) });
        }
        return created.length === 1 ? created[0] : created;
      }
      case 'update':
      case 'set': {
        const targets = op.ids ? ids(op.ids) : [ctx.id(String(op.id))!];
        const props = (op.props ?? op.node ?? Object.fromEntries(Object.entries(op).filter(([k]) => !['op', 'id', 'ids'].includes(k)))) as NodeSpec;
        const all: Op[] = [];
        for (const id of targets) {
          const n = idx.get(id);
          if (!n) throw new SpecError(`camada não encontrada: ${id}`);
          all.push(...conv.patch(n, props));
        }
        if (all.length) ed.run('Alterar', [...assets(), ...all]);
        return { updated: targets.length };
      }
      case 'delete':
      case 'remove': {
        const list = ed.topLevel(ids(op.ids ?? op.id));
        ed.run('Excluir', list.map((id) => ({ op: 'remove', id }) as Op));
        return { deleted: list.length };
      }
      case 'move': {
        const n = node(op.id);
        const parent = op.parent !== undefined ? parentOf(op.parent) : idx.parentId(n.id)!;
        const list = idx.siblings(parent)!;
        const index = typeof op.index === 'number' ? Math.max(0, Math.min(list.length, op.index)) : list.length;
        if (parent !== idx.parentId(n.id) || op.index !== undefined) {
          if (parent === n.id || idx.isAncestor(n.id, parent)) throw new SpecError('não dá para mover uma camada para dentro dela mesma');
          ed.moveInto(n.id, parent, index);
        }
        const pos: Op[] = [];
        if (typeof op.x === 'number') pos.push({ op: 'set', id: n.id, key: 'x', value: op.x });
        if (typeof op.y === 'number') pos.push({ op: 'set', id: n.id, key: 'y', value: op.y });
        if (pos.length) ed.run('Mover', pos);
        return { id: n.id };
      }
      case 'duplicate':
      case 'copy': {
        const n = node(op.id);
        const parent = op.parent !== undefined ? parentOf(op.parent) : idx.parentId(n.id)!;
        const copy = reidentify(n);
        if (typeof op.x === 'number') copy.x = op.x;
        if (typeof op.y === 'number') copy.y = op.y;
        if (op.x === undefined && op.y === undefined && parent === ed.pageId && !hasLayout(parent)) {
          const at = emptySpace(copy.width, copy.height, 100, n.id);
          copy.x = at.x;
          copy.y = at.y;
        }
        const list = idx.siblings(parent)!;
        const index = parent === idx.parentId(n.id) ? list.findIndex((s) => s.id === n.id) + 1 : list.length;
        ed.run('Duplicar', [{ op: 'insert', parent, index, node: copy }]);
        setRef(op.ref, copy.id);
        after(op.props, copy.id);
        return { id: copy.id };
      }
      case 'replace': {
        const n = node(op.id);
        const parent = idx.parentId(n.id)!;
        const built = conv.build(op.node as NodeSpec, hasLayout(parent), parent === ed.pageId);
        if ((op.node as NodeSpec).x === undefined) built.x = n.x;
        if ((op.node as NodeSpec).y === undefined) built.y = n.y;
        const index = idx.siblings(parent)!.findIndex((s) => s.id === n.id);
        ed.run('Substituir', [...assets(), { op: 'remove', id: n.id }, { op: 'insert', parent, index, node: built }]);
        return { id: built.id };
      }
      case 'group':
      case 'frame':
      case 'wrap':
      case 'component':
      case 'make_component': {
        const kind2 = kind === 'group' ? 'group' : kind === 'component' || kind === 'make_component' ? 'component' : 'frame';
        ed.select(ids(op.ids ?? op.id));
        ed.wrap(kind2);
        const id = ed.selection[0];
        if (!id || ed.model.index.get(id)?.type !== (kind2 === 'group' ? 'group' : kind2)) throw new SpecError('não foi possível agrupar (as camadas precisam estar no mesmo nível)');
        setRef(op.ref, id);
        if (op.name) ed.run('Nome', [{ op: 'set', id, key: 'name', value: String(op.name) }]);
        after(op.props, id);
        return { id };
      }
      case 'autolayout':
      case 'auto_layout': {
        ed.select(ids(op.ids ?? op.id));
        ed.addAutoLayout();
        const id = ed.selection[0];
        setRef(op.ref, id);
        if (op.layout) after({ layout: op.layout }, id);
        after(op.props, id);
        return { id };
      }
      case 'remove_autolayout': {
        ed.select(ids(op.ids ?? op.id));
        ed.removeAutoLayout();
        return { ok: true };
      }
      case 'ungroup': {
        ed.select(ids(op.ids ?? op.id));
        ed.ungroup();
        return { ids: ed.selection };
      }
      case 'combine_variants': {
        const list = ids(op.ids);
        const variants = (op.variants ?? {}) as Record<string, Record<string, string>>;
        const vops: Op[] = [];
        for (const id of list) {
          const v = variants[id] ?? variants[Object.keys(variants).find((k) => ctx.id(k, false) === id) ?? ''];
          if (v) vops.push({ op: 'set', id, key: 'variant', value: v });
        }
        if (vops.length) ed.run('Variantes', vops);
        ed.select(list);
        ed.combineAsVariants();
        const id = ed.selection[0];
        if (ed.model.index.get(id)?.type !== 'component-set') throw new SpecError('não foi possível combinar (precisam ser componentes no mesmo nível)');
        setRef(op.ref, id);
        if (op.name) ed.run('Nome', [{ op: 'set', id, key: 'name', value: String(op.name) }]);
        after(op.props, id);
        return { id };
      }
      case 'add_property': {
        // "component" é procurado só entre os componentes (instâncias e telas podem ter o mesmo nome)
        const target = op.component !== undefined && !idx.get(String(op.component)) ? conv.findComponent(String(op.component)).main : node(op.component ?? op.id);
        const owner = ed.propertyOwner(target.id);
        if (!owner) throw new SpecError('a camada não é (nem está dentro de) um componente');
        const type = String(op.type ?? 'text') as 'text' | 'boolean' | 'swap';
        const bind = op.bind as { node?: string; slot?: string } | undefined;
        const pid = ed.addProperty(owner.id, type, bind?.node ? { nodeId: ctx.id(bind.node)!, slot: (bind.slot ?? (type === 'boolean' ? 'visible' : type === 'swap' ? 'component' : 'text')) as 'text' } : undefined);
        if (!pid) throw new SpecError('não foi possível criar a propriedade');
        const patch: Record<string, unknown> = {};
        if (op.name) patch.name = String(op.name);
        if (op.default !== undefined) patch.default = type === 'boolean' ? op.default === true || op.default === 'true' : type === 'swap' ? conv.findComponent(String(op.default)).main.id : String(op.default);
        if (Object.keys(patch).length) ed.updateProperty(owner.id, pid, patch);
        return { property: pid };
      }
      case 'slot':
      case 'make_slot': {
        // frame dentro de um componente vira slot (outras camadas são embrulhadas num frame-slot)
        const list = ids(op.ids ?? op.id);
        const frames = list.filter((id) => idx.get(id)?.type === 'frame');
        ed.convertToSlot(list);
        const targets = frames.length === list.length ? list : [ed.selection[0]];
        const t0 = targets[0] ? idx.get(targets[0]) : undefined;
        if (t0?.type !== 'frame' || !t0.slot) throw new SpecError('não foi possível criar o slot (precisa ser um frame, ou camadas, dentro de um componente)');
        const def = conv.slotDef({ preferred: op.preferred as string[] | undefined, description: op.description as string | undefined, min: op.min as number | undefined, max: op.max as number | undefined });
        if (def && Object.keys(def).length) for (const id of targets) ed.updateSlot(id, def);
        if (op.name && targets.length === 1) ed.run('Nome', [{ op: 'set', id: targets[0], key: 'name', value: String(op.name) }]);
        setRef(op.ref, targets[0]);
        return targets.length === 1 ? { id: targets[0] } : { ids: targets };
      }
      case 'fill_slot': {
        const inst = node(op.instance ?? op.id);
        if (inst.type !== 'instance') throw new SpecError('fill_slot precisa de uma instância em "instance"');
        const main = ed.findComponent(inst.componentId, inst.library);
        if (!main) throw new SpecError('componente da instância não encontrado');
        const slot = conv.findSlotIn(main, String(op.slot ?? ''));
        const specs = (op.nodes ?? (op.node ? [op.node] : [])) as NodeSpec[];
        // padrão: as camadas tomam o lugar do conteúdo do slot; com append, entram depois dele
        const append = op.append === true;
        const cur = inst.slots?.find((h) => h.slotOf === slot.id);
        if (!append) {
          if (cur) ed.run('Limpar slot', cur.children.map((c) => ({ op: 'remove', id: c.id }) as Op));
          else ed.clearSlot(inst.id, slot.id);
        }
        const holder = (idx.get(inst.id) as typeof inst).slots?.find((h) => h.slotOf === slot.id);
        const parent = holder?.id ?? `${inst.id}/${slot.id}`;
        const created: unknown[] = [];
        for (const spec of specs) {
          const built = conv.build(spec, !!slot.layout, false);
          ed.run('Preencher slot', [...assets(), { op: 'insert', parent, index: 1e9, node: built }]);
          created.push({ id: built.id, name: built.name, ...(spec.ref ? { ref: spec.ref } : {}) });
        }
        const after2 = (idx.get(inst.id) as typeof inst).slots?.find((h) => h.slotOf === slot.id);
        return { slot: slot.name, holder: after2?.id, created };
      }
      case 'reset_slot': {
        const inst = node(op.instance ?? op.id);
        if (inst.type !== 'instance') throw new SpecError('reset_slot precisa de uma instância em "instance"');
        const main = ed.findComponent(inst.componentId, inst.library);
        if (!main) throw new SpecError('componente da instância não encontrado');
        const slot = conv.findSlotIn(main, String(op.slot ?? ''));
        ed.resetSlot(inst.id, slot.id);
        return { ok: true };
      }
      case 'detach': {
        ed.select(ids(op.ids ?? op.id));
        ed.detach();
        setRef(op.ref, ed.selection[0]);
        return { ids: ed.selection };
      }
      case 'boolean': {
        const operation = String(op.operation ?? 'union') as 'union';
        if (!['union', 'subtract', 'intersect', 'exclude'].includes(operation)) throw new SpecError('operation: union, subtract, intersect ou exclude');
        ed.select(ids(op.ids));
        ed.booleanOperation(operation);
        const id = ed.selection[0];
        setRef(op.ref, id);
        if (op.name) ed.run('Nome', [{ op: 'set', id, key: 'name', value: String(op.name) }]);
        after(op.props, id);
        return { id };
      }
      case 'flatten': {
        const out = ed.flatten(ids(op.ids ?? op.id));
        if (!out.length) throw new SpecError('nada para converter em vetor');
        setRef(op.ref, out[0]);
        after(op.props, out[0]);
        return { ids: out };
      }
      case 'reorder': {
        ed.select(ids(op.ids ?? op.id));
        const where = String(op.where ?? 'front') as 'front';
        if (!['front', 'back', 'forward', 'backward'].includes(where)) throw new SpecError('where: front, back, forward ou backward');
        ed.reorder(where);
        return { ok: true };
      }
      case 'link': {
        const from = ids(op.from ?? op.id);
        const it = conv.interaction({ to: op.to as string, action: op.action as string, transition: op.transition as string, duration: op.duration as number, position: op.position as string, background: op.background as string, closeOutside: op.closeOutside as boolean });
        ed.run('Protótipo', from.map((id) => ({ op: 'set', id, key: 'interactions', value: [it] }) as Op));
        return { ok: true };
      }
      default:
        throw new SpecError(`operação desconhecida: ${kind || '(vazia)'} — use create, update, delete, move, duplicate, replace, group, frame, component, autolayout, remove_autolayout, ungroup, combine_variants, add_property, slot, fill_slot, reset_slot, detach, boolean, flatten, reorder, link`);
    }
  }

  // ── Imagem da tela ─────────────────────────────────────────────────────────

  async function screenshot(args: Record<string, unknown>): Promise<ToolResult> {
    needDoc();
    const host = ed.host;
    if (!host) throw new SpecError('o canvas ainda não está pronto');
    let target: SceneNode;
    if (args.id) {
      const ctx = new BuildContext(ed);
      const n = ed.model.index.get(ctx.id(String(args.id))!);
      if (!n) throw new SpecError(`camada não encontrada: ${args.id}`);
      target = n;
    } else {
      const kids = ed.page.children.filter((n) => n.visible !== false);
      if (!kids.length) throw new SpecError('a página está vazia');
      const b = unionRects(kids.map((n) => ed.worldBounds(n.id)));
      // grupo de mentira só para desenhar a página toda de uma vez
      target = createNode('group', { x: b.x, y: b.y, width: b.width, height: b.height }, { children: kids.map((k) => ({ ...k, x: k.x - b.x, y: k.y - b.y })) as SceneNode[], name: ed.page.name });
    }
    const max = Math.max(256, Math.min(4096, Number(args.maxSize ?? 1600)));
    const scale = Math.min(Number(args.scale ?? 2), max / Math.max(target.width, target.height, 1));
    const bytes = await host.encodeImage(target, Math.max(0.05, scale), 'png');
    if (!bytes) throw new SpecError('não foi possível desenhar a imagem');
    return {
      content: [
        { type: 'image', data: toBase64(bytes), mimeType: 'image/png' },
        { type: 'text', text: `${target.name}: ${Math.round(target.width)}×${Math.round(target.height)} (imagem em ${scale.toFixed(2)}×)` },
      ],
    };
  }

  // ── Variáveis e estilos ────────────────────────────────────────────────────

  function variables(args: Record<string, unknown>): unknown {
    needDoc();
    const action = String(args.action ?? 'list');
    const cols = clone(ed.doc.variables);
    const findCol = (name: unknown) => {
      const n = String(name ?? '').toLowerCase();
      const c = cols.find((x) => x.id === name || x.name.toLowerCase() === n) ?? (cols.length === 1 && !name ? cols[0] : undefined);
      if (!c) throw new SpecError(`coleção não encontrada: ${name ?? '(informe "collection")'}`);
      return c;
    };
    const modeId = (c: VariableCollection, name: unknown) => {
      const m = c.modes.find((x) => x.id === name || x.name.toLowerCase() === String(name).toLowerCase());
      if (!m) throw new SpecError(`modo “${name}” não existe em ${c.name} (modos: ${c.modes.map((x) => x.name).join(', ')})`);
      return m.id;
    };
    const commit = (label: string) => {
      ed.strict = true;
      try {
        ed.run(label, [{ op: 'doc', key: 'variables', value: cols }]);
      } finally {
        ed.strict = false;
      }
    };
    switch (action) {
      case 'list':
        return cols.map((c) => ({
          id: c.id,
          name: c.name,
          modes: c.modes.map((m) => m.name),
          currentMode: c.modes.find((m) => m.id === (ed.doc.settings?.modes?.[c.id] ?? c.defaultMode))?.name,
          variables: c.variables.map((v) => ({ name: v.name, type: v.type, values: Object.fromEntries(c.modes.map((m) => [m.name, v.values[m.id]])) })),
        }));
      case 'create_collection': {
        const modes = (Array.isArray(args.modes) && args.modes.length ? args.modes : ['Padrão']).map((n) => ({ id: uid(8), name: String(n) }));
        const c: VariableCollection = { id: uid(10), name: String(args.name ?? args.collection ?? 'Tokens'), modes, defaultMode: modes[0].id, variables: [] };
        cols.push(c);
        commit('Nova coleção');
        return { id: c.id, modes: modes.map((m) => m.name) };
      }
      case 'add_mode': {
        const c = findCol(args.collection);
        const m = { id: uid(8), name: String(args.mode ?? args.name ?? `Modo ${c.modes.length + 1}`) };
        // o modo novo começa com os valores do padrão
        for (const v of c.variables) v.values[m.id] = v.values[c.defaultMode];
        c.modes.push(m);
        commit('Novo modo');
        return { mode: m.name };
      }
      case 'rename_mode': {
        const c = findCol(args.collection);
        const id = modeId(c, args.mode);
        c.modes = c.modes.map((m) => (m.id === id ? { ...m, name: String(args.name) } : m));
        commit('Renomear modo');
        return { ok: true };
      }
      case 'set': {
        const c = findCol(args.collection);
        const list = (args.variables ?? [args]) as { name: string; type?: string; value?: unknown; values?: Record<string, unknown> }[];
        let created = 0, updated = 0;
        for (const item of list) {
          if (!item.name) throw new SpecError('cada variável precisa de "name"');
          let v = c.variables.find((x) => x.name.toLowerCase() === item.name.toLowerCase());
          const sample = item.values ? Object.values(item.values)[0] : item.value;
          const type = (item.type ?? v?.type ?? (typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : parseColor(sample) ? 'color' : 'string')) as 'color';
          if (!v) {
            v = { id: uid(10), name: item.name, type, values: {} };
            c.variables.push(v);
            created++;
          } else updated++;
          const parse = (raw: unknown): VariableValue => {
            if (typeof raw === 'string' && raw.startsWith('$')) {
              const ref = findVariableByName(ed, raw) ?? (() => {
                const own = c.variables.find((x) => x.name.toLowerCase() === raw.slice(1).toLowerCase());
                return own ? { variable: own } : null;
              })();
              if (!ref) throw new SpecError(`variável para apelido não encontrada: ${raw}`);
              return { alias: ref.variable.id };
            }
            if (type === 'color') {
              const col = parseColor(raw);
              if (!col) throw new SpecError(`cor inválida em ${item.name}: ${raw}`);
              return col;
            }
            if (type === 'number') return Number(raw);
            if (type === 'boolean') return raw === true || raw === 'true';
            return String(raw);
          };
          if (item.values) for (const [mode, raw] of Object.entries(item.values)) v.values[modeId(c, mode)] = parse(raw);
          else if (item.value !== undefined) for (const m of c.modes) v.values[m.id] = parse(item.value);
          for (const m of c.modes) if (v.values[m.id] === undefined) v.values[m.id] = v.values[c.defaultMode] ?? Object.values(v.values)[0] ?? (type === 'color' ? '#000000' : type === 'number' ? 0 : '');
        }
        commit('Variáveis');
        return { created, updated };
      }
      case 'delete': {
        const c = findCol(args.collection);
        if (args.name) {
          const before = c.variables.length;
          c.variables = c.variables.filter((v) => v.name.toLowerCase() !== String(args.name).toLowerCase());
          if (before === c.variables.length) throw new SpecError(`variável não encontrada: ${args.name}`);
        } else cols.splice(cols.indexOf(c), 1);
        commit('Excluir variável');
        return { ok: true };
      }
      case 'set_mode': {
        const c = findCol(args.collection);
        ed.setMode(c.id, modeId(c, args.mode));
        return { ok: true };
      }
      default:
        throw new SpecError('action: list, create_collection, add_mode, rename_mode, set, delete ou set_mode');
    }
  }

  function styles(args: Record<string, unknown>): unknown {
    needDoc();
    const action = String(args.action ?? 'list');
    const list = clone(ed.doc.styles ?? []);
    const conv = new Converter(new BuildContext(ed));
    const byName = (name: unknown) => {
      const s = allStyles(ed.doc).find((x) => x.id === name || x.name.toLowerCase() === String(name).toLowerCase());
      if (!s) throw new SpecError(`estilo não encontrado: ${name}`);
      return s;
    };
    const valueOf = (type: string, a: Record<string, unknown>, prev?: Style): Partial<Style> => {
      if (type === 'text') {
        const base = prev?.type === 'text' ? prev.text : undefined;
        const st = conv.textStyle({ type: 'text', ...(a as object) } as NodeSpec, base);
        const { align: _a, verticalAlign: _v, ...rest } = st;
        return { type: 'text', text: rest };
      }
      if (type === 'effect') return { type: 'effect', effects: conv.effects(a.effects ?? a.shadow ?? (prev?.type === 'effect' ? prev.effects : 'md')) };
      const paints: Paint[] = a.paints ? conv.paints(a.paints) : a.color !== undefined ? conv.paints(a.color) : prev?.type === 'color' ? prev.paints : [];
      if (!paints.length) throw new SpecError('estilo de cor precisa de "color"');
      return { type: 'color', paints };
    };
    const run = (label: string, ops: Op[]) => {
      ed.strict = true;
      try {
        ed.run(label, ops);
      } finally {
        ed.strict = false;
      }
    };
    switch (action) {
      case 'list':
        return allStyles(ed.doc).map((s) => ({ id: s.id, name: s.name, type: s.type, ...(s.type === 'text' ? { text: s.text } : s.type === 'color' ? { color: s.paints.map((p) => (p.type === 'solid' ? p.color : p.type)) } : { effects: s.effects }) }));
      case 'create': {
        const items = (Array.isArray(args.styles) ? args.styles : [args]) as Record<string, unknown>[];
        const out: string[] = [];
        for (const a of items) {
          const type = String(a.type ?? (a.font || a.size ? 'text' : a.effects || a.shadow ? 'effect' : 'color'));
          if (!a.name) throw new SpecError('estilo precisa de "name"');
          if (list.some((s) => s.name.toLowerCase() === String(a.name).toLowerCase())) throw new SpecError(`já existe um estilo “${a.name}”`);
          const style = { id: uid(10), name: String(a.name), ...valueOf(type, a), ...(a.description ? { description: String(a.description) } : {}) } as Style;
          list.push(style);
          out.push(style.id);
        }
        run('Criar estilo', [{ op: 'doc', key: 'styles', value: list }]);
        return { created: out.length };
      }
      case 'update': {
        const s = byName(args.name ?? args.id);
        const next = { ...s, ...valueOf(s.type, args, s), ...(args.rename ? { name: String(args.rename) } : {}) } as Style;
        ed.strict = true;
        try {
          ed.updateStyle(next);
        } finally {
          ed.strict = false;
        }
        return { ok: true };
      }
      case 'delete': {
        ed.deleteStyle(byName(args.name ?? args.id).id);
        return { ok: true };
      }
      default:
        throw new SpecError('action: list, create, update ou delete');
    }
  }

  // ── Catálogos ──────────────────────────────────────────────────────────────

  async function searchIcons(args: Record<string, unknown>): Promise<unknown> {
    if (!iconNames) {
      const mod = (await loadChunk(() => import('lucide-react'))) as unknown as { icons: Record<string, unknown> };
      iconNames = Object.keys(mod.icons).map((k) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase());
    }
    const raw = String(args.query ?? '').toLowerCase().trim();
    const STOP = new Set(['de', 'da', 'do', 'para', 'com', 'e', 'a', 'o', 'the', 'of', 'icon', 'ícone', 'icone']);
    const terms = raw.split(/[\s,]+/).filter((t) => t && !STOP.has(t)).map((t) => ICON_WORDS[t] ?? t);
    const limit = Math.min(200, Number(args.limit ?? 30));
    if (!terms.length) return { icons: iconNames.slice(0, limit), total: iconNames.length };
    const scored = iconNames
      .map((n) => {
        let s = 0;
        for (const t of terms) {
          if (n === t) s += 100;
          else if (n.split('-').includes(t)) s += 30;
          else if (n.startsWith(t)) s += 20;
          else if (n.includes(t)) s += 8;
        }
        return { n, s: s - n.length * 0.1 };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return { icons: scored.slice(0, limit).map((x) => x.n), total: scored.length };
  }

  function listComponents(args: Record<string, unknown>): unknown {
    const q = String(args.query ?? '').toLowerCase();
    const idx = ed.model.index;
    const out: unknown[] = [];
    const describe = (c: ContainerNode, library?: string) => {
      const base = { id: c.id, name: c.name, type: c.type, size: [Math.round(c.width), Math.round(c.height)], ...(library ? { library: ed.doc.libraries.find((l) => l.id === library)?.name } : {}) };
      if (c.type === 'component-set') return { ...base, variants: variantAxes(c), properties: (c.properties ?? []).map((p) => ({ name: p.name, type: p.type, default: p.default })) };
      return { ...base, ...(c.properties?.length ? { properties: c.properties.map((p) => ({ name: p.name, type: p.type, default: p.default })) } : {}), ...(c.description ? { description: c.description } : {}) };
    };
    for (const s of idx.componentSets()) out.push(describe(s));
    for (const c of idx.components()) if (!ed.setFor(c.id)) out.push(describe(c));
    for (const lib of ed.doc.libraries) for (const c of lib.components) out.push(describe(c, lib.id));
    return out.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q)).slice(0, Number(args.limit ?? 200));
  }

  // ── Trocas em massa ────────────────────────────────────────────────────────

  function replaceProperties(args: Record<string, unknown>): unknown {
    needDoc();
    const conv = new Converter(new BuildContext(ed));
    const reps = (args.replacements ?? []) as { property: string; from: unknown; to: unknown }[];
    if (!reps.length) throw new SpecError('"replacements" vazio');
    const roots = Array.isArray(args.ids) && args.ids.length ? (args.ids as string[]).map((id) => ed.model.index.get(new BuildContext(ed).id(id)!)!).filter(Boolean) : ed.page.children;
    const ops: Op[] = [];
    let count = 0;
    const same = (a: string, b: unknown) => parseColor(b)?.slice(0, 7) === a.slice(0, 7) && (parseColor(b)!.length === 7 || parseColor(b) === a);
    walk(roots, (n) => {
      for (const r of reps) {
        const p = r.property;
        if (p === 'color' || p === 'fill' || p === 'stroke') {
          if (p !== 'stroke' && n.fills?.some((f) => f.type === 'solid' && same(f.color, r.from))) {
            ops.push({ op: 'set', id: n.id, key: 'fills', value: n.fills.map((f) => (f.type === 'solid' && same(f.color, r.from) ? conv.paint(r.to)! : f)) });
            count++;
          }
          if (p !== 'fill' && n.strokes?.some((s) => s.paint.type === 'solid' && same(s.paint.color, r.from))) {
            ops.push({ op: 'set', id: n.id, key: 'strokes', value: n.strokes.map((s) => (s.paint.type === 'solid' && same(s.paint.color, r.from) ? { ...s, paint: conv.paint(r.to)! } : s)) });
            count++;
          }
        } else if (n.type === 'text' && (p === 'font' || p === 'fontSize' || p === 'weight')) {
          const key = p === 'font' ? 'family' : p === 'fontSize' ? 'size' : 'weight';
          if (String(n.style[key]).toLowerCase() === String(r.from).toLowerCase()) {
            ops.push({ op: 'set', id: n.id, key: `style.${key}`, value: p === 'font' ? String(r.to) : Number(r.to) });
            count++;
          }
        } else if (p === 'radius' && n.cornerRadius === Number(r.from)) {
          ops.push({ op: 'set', id: n.id, key: 'cornerRadius', value: Number(r.to) });
          count++;
        } else if (p === 'gap' && 'layout' in n && n.layout?.gap === Number(r.from)) {
          ops.push({ op: 'set', id: n.id, key: 'layout.gap', value: Number(r.to) });
          count++;
        }
      }
      if (n.type === 'instance') return false;
    });
    if (ops.length) {
      ed.strict = true;
      try {
        ed.run('Substituir propriedades', ops);
      } finally {
        ed.strict = false;
      }
    }
    return { replaced: count };
  }

  // ── Exportação ─────────────────────────────────────────────────────────────

  async function exportNodes(args: Record<string, unknown>): Promise<unknown> {
    needDoc();
    const write = ed.platform.automation?.writeFile;
    if (!write) throw new SpecError('exportar para arquivo não está disponível neste ambiente');
    const host = ed.host!;
    const folder = String(args.folder ?? '');
    if (!folder) throw new SpecError('informe "folder" (pasta de destino)');
    const format = String(args.format ?? 'png') as 'png';
    const scale = Number(args.scale ?? 2);
    const ctx = new BuildContext(ed);
    const out: string[] = [];
    for (const raw of (args.ids as string[]) ?? []) {
      const n = ed.model.index.get(ctx.id(raw)!);
      if (!n) throw new SpecError(`camada não encontrada: ${raw}`);
      const file = `${folder.replace(/[\\/]+$/, '')}/${n.name.replace(/[\\/:*?"<>|]+/g, '-')}.${format}`;
      let data: Uint8Array | string | null;
      if (format === ('svg' as string)) data = exportSvg(ed.doc, n, ed.resolve);
      else if (format === ('pdf' as string)) {
        const px = host.pixels(n, Math.min(scale, 8000 / Math.max(n.width, n.height, 1)));
        if (!px) throw new SpecError(`falha ao desenhar ${n.name}`);
        const { rgb, alpha } = splitRgba(px.rgba, px.width, px.height);
        data = buildPdf([{ width: n.width, height: n.height, image: { width: px.width, height: px.height, rgb: await deflate(rgb), alpha: alpha && (await deflate(alpha)), deflated: true } }], { title: n.name, producer: `Zaliel ${ed.platform.version}` });
      } else data = await host.encodeImage(n, scale, format === ('jpg' as string) ? 'jpg' : format === ('webp' as string) ? 'webp' : 'png');
      if (!data) throw new SpecError(`falha ao exportar ${n.name}`);
      await write(file, typeof data === 'string' ? data : toBase64(data), typeof data !== 'string');
      out.push(file);
    }
    return { files: out };
  }

  // ── Lista de ferramentas ───────────────────────────────────────────────────

  const NODE_HELP = 'Node description (see get_guidelines "overview"): {type, ref?, name?, x?, y?, width?: number|"fill"|"hug", height?, fill?, stroke?, strokeTop?/strokeRight?/strokeBottom?/strokeLeft? ("1px solid #e5e7eb", like CSS border-bottom), radius?, shadow?/effects?, opacity?, layout?: {direction, gap, padding, align, justify, wrap}, clip?, absolute?, children?: [...], text-only: text (or spans: ["plain ", {text:"bold part", weight:700, color?, italic?}] for mixed styles), font, size, weight, lineHeight, letterSpacing, align, color, autoResize; icon: icon, size, color, strokeWidth; image: src (file path or data URL), fit; svg: svg (markup); instance: component, variant, props, overrides, slots: {"Slot name": [NodeSpec]}; component: properties, bind; frame inside a component: slot: true | {preferred, description, min, max}; any: link:{to, action, transition}, fillStyle, textStyle, effectStyle}.';

  const tools: Tool[] = [
    {
      name: 'get_guidelines',
      title: 'Guidelines',
      description: 'Read FIRST. How Zaliel documents work and the design rules for professional results. Topics: overview (document model, node format, workflow), design (spacing, typography, color, hierarchy), components (components, variants, properties, library), from-code (recreate a front-end app with components and screens), icons (icons, logos, SVG), prototype (links, overlays), variables (tokens, modes, styles), all.',
      inputSchema: obj({ topic: str('Guide topic', { enum: ['overview', 'design', 'components', 'from-code', 'icons', 'prototype', 'variables', 'all'] }) }),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        const t = String(a.topic ?? 'overview');
        if (t === 'all') return { content: [{ type: 'text', text: Object.values(GUIDES).join('\n\n---\n\n') }] };
        const g = GUIDES[t];
        if (!g) throw new SpecError(`tópico desconhecido: ${t}`);
        return { content: [{ type: 'text', text: g }] };
      },
    },
    {
      name: 'get_editor_state',
      title: 'Editor state',
      description: 'Open document, pages, top-level frames of the current page (ids, names, positions, sizes), selection, components, styles, variable collections and viewport. Call before designing.',
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      run: async () => {
        if (ed.home) return { document: null, hint: 'Nenhum arquivo aberto. Use document {action:"new"} ou {action:"open", path}.' };
        const idx = ed.model.index;
        return {
          document: { name: ed.doc.name, path: ed.filePath, unsaved: ed.model.dirty, tabs: ed.tabs.map((t) => ({ id: t.id, name: ed.tabModel(t).doc.name, active: t.id === ed.activeTab })) },
          pages: ed.doc.pages.map((p) => ({ id: p.id, name: p.name, current: p.id === ed.pageId, topLevel: p.children.length })),
          currentPage: {
            id: ed.pageId,
            name: ed.page.name,
            background: ed.page.background,
            flowStart: ed.page.flowStart,
            topLevel: ed.page.children.slice(0, 300).map((n) => ({ id: n.id, name: n.name, type: n.type, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) })),
          },
          selection: ed.selectedNodes().map((n) => ({ id: n.id, name: n.name, type: n.type })),
          components: { count: idx.components().length, sets: idx.componentSets().map((s) => s.name), standalone: idx.components().filter((c) => !ed.setFor(c.id)).slice(0, 80).map((c) => c.name), libraries: ed.doc.libraries.map((l) => l.name) },
          styles: allStyles(ed.doc).map((s) => ({ name: s.name, type: s.type })),
          variables: ed.doc.variables.map((c) => ({ collection: c.name, modes: c.modes.map((m) => m.name), count: c.variables.length })),
          viewport: { zoom: Math.round(ed.viewport.zoom * 100) / 100 },
        };
      },
    },
    {
      name: 'document',
      title: 'Document',
      description: 'Document and tab actions: new (optional name), open (path to a .zal file), save (saves to its path, or to "path"), save_as (path), close (discard:true to drop unsaved changes), list_tabs, switch_tab (tabId), rename (name), undo, redo.',
      inputSchema: obj({ action: str('Action', { enum: ['new', 'open', 'save', 'save_as', 'close', 'list_tabs', 'switch_tab', 'rename', 'undo', 'redo'] }), path: str('File path (.zal)'), name: str('Document name'), tabId: str('Tab id'), discard: { type: 'boolean' } }, ['action']),
      run: async (a) => {
        const action = String(a.action);
        switch (action) {
          case 'new':
            ed.newDocument();
            ed.setTool('move');
            if (a.name) ed.rename(String(a.name));
            return { ok: true, name: ed.doc.name };
          case 'open': {
            if (!a.path) throw new SpecError('informe "path"');
            const before = ed.doc;
            await ed.openPath(String(a.path));
            if (ed.doc === before || ed.home) throw new SpecError(`não foi possível abrir ${a.path}`);
            return { ok: true, name: ed.doc.name, pages: ed.doc.pages.length };
          }
          case 'save':
          case 'save_as': {
            needDoc();
            const path = a.path ? String(a.path) : ed.filePath;
            if (!path) throw new SpecError('o arquivo ainda não tem caminho: informe "path" (ex.: C:/Projetos/app.zal)');
            ed.filePath = path.toLowerCase().endsWith('.zal') ? path : `${path}.zal`;
            const ok = await ed.save(false, true);
            if (!ok) throw new SpecError('não foi possível salvar');
            return { ok: true, path: ed.filePath };
          }
          case 'close': {
            if (ed.home) return { ok: true };
            if (ed.model.dirty && !a.discard) throw new SpecError('há alterações não salvas: salve antes ou mande discard:true');
            if (a.discard) ed.model.markSaved();
            await ed.closeTab(ed.activeTab!);
            return { ok: true };
          }
          case 'list_tabs':
            return ed.tabs.map((t) => ({ id: t.id, name: ed.tabModel(t).doc.name, path: ed.tabPath(t), active: t.id === ed.activeTab, unsaved: ed.tabModel(t).dirty }));
          case 'switch_tab':
            if (!ed.tabs.some((t) => t.id === a.tabId)) throw new SpecError('aba não encontrada');
            ed.switchTab(String(a.tabId));
            return { ok: true };
          case 'rename':
            needDoc();
            ed.rename(String(a.name ?? ''));
            return { ok: true };
          case 'undo':
            ed.undo();
            return { ok: true };
          case 'redo':
            ed.redo();
            return { ok: true };
          default:
            throw new SpecError('action desconhecida');
        }
      },
    },
    {
      name: 'pages',
      title: 'Pages',
      description: 'Page actions: list, create (name), rename (id, name), delete (id), switch (id), duplicate (id), set_background (id?, color), set_flow_start (frame id where the prototype starts).',
      inputSchema: obj({ action: str('Action', { enum: ['list', 'create', 'rename', 'delete', 'switch', 'duplicate', 'set_background', 'set_flow_start'] }), id: str('Page id or name'), name: str('Page name'), color: str('Background color'), frame: str('Frame id') }, ['action']),
      run: async (a) => {
        needDoc();
        const action = String(a.action);
        const page = (v: unknown) => {
          const p = ed.doc.pages.find((x) => x.id === v || x.name.toLowerCase() === String(v ?? '').toLowerCase()) ?? (v === undefined ? ed.page : undefined);
          if (!p) throw new SpecError(`página não encontrada: ${v}`);
          return p;
        };
        ed.strict = true;
        try {
          switch (action) {
            case 'list':
              return ed.doc.pages.map((p) => ({ id: p.id, name: p.name, current: p.id === ed.pageId, topLevel: p.children.length }));
            case 'create': {
              const p = createPage(String(a.name ?? `Página ${ed.doc.pages.length + 1}`));
              p.background = ed.page.background;
              ed.run('Nova página', [{ op: 'insert', parent: ROOT, index: ed.doc.pages.length, node: p }]);
              ed.setPage(p.id);
              return { id: p.id };
            }
            case 'rename':
              ed.renamePage(page(a.id).id, String(a.name ?? ''));
              return { ok: true };
            case 'delete': {
              if (ed.doc.pages.length < 2) throw new SpecError('o arquivo precisa de pelo menos uma página');
              const p = page(a.id);
              if (p.id === ed.pageId) ed.setPage(ed.doc.pages.find((x) => x.id !== p.id)!.id);
              ed.run('Excluir página', [{ op: 'remove', id: p.id }]);
              return { ok: true };
            }
            case 'switch':
              ed.setPage(page(a.id).id);
              return { ok: true, name: ed.page.name };
            case 'duplicate':
              ed.duplicatePage(page(a.id).id);
              return { id: ed.pageId };
            case 'set_background': {
              const c = parseColor(a.color);
              if (!c) throw new SpecError('cor inválida');
              ed.run('Fundo da página', [{ op: 'set', id: page(a.id).id, key: 'background', value: c.slice(0, 7) }]);
              return { ok: true };
            }
            case 'set_flow_start':
              ed.setFlowStart(new BuildContext(ed).id(String(a.frame ?? a.id)));
              return { ok: true };
            default:
              throw new SpecError('action desconhecida');
          }
        } finally {
          ed.strict = false;
        }
      },
    },
    {
      name: 'read_nodes',
      title: 'Read layers',
      description: 'Read layers in the same format batch_design accepts (round-trip: read, change, update). Pass ids, or parent (lists its children), or search {name, type, text} (substring, case-insensitive) over the current page (all:true for all pages; with parent, only inside that layer). depth controls how many levels of children come back (default 2).',
      inputSchema: obj({ ids: arr({ type: 'string' }, 'Layer ids'), parent: str('Parent id (page by default)'), search: obj({ name: str('Name contains'), type: str('Layer type'), text: str('Text contains') }), all: { type: 'boolean' }, depth: numb('Children depth (0–6)'), limit: numb('Max results (default 50)') }),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        needDoc();
        const ctx = new BuildContext(ed);
        const depth = Math.max(0, Math.min(6, Number(a.depth ?? 2)));
        const limit = Math.max(1, Math.min(500, Number(a.limit ?? 50)));
        if (Array.isArray(a.ids) && a.ids.length) return (a.ids as string[]).map((id) => nodeOut(ed, ed.model.index.get(ctx.id(id)!)!, depth));
        if (a.search && typeof a.search === 'object') {
          const s = a.search as Record<string, string>;
          const out: unknown[] = [];
          // com parent, a busca fica dentro daquela camada (ex.: uma tela entre várias duplicadas)
          const scope = a.parent ? (ed.model.index.get(ctx.id(String(a.parent))!) as ContainerNode | undefined) : undefined;
          if (a.parent && !scope) throw new SpecError('pai não encontrado');
          const pages = scope ? [{ name: ed.page.name, children: scope.children ?? [] }] : a.all ? ed.doc.pages : [ed.page];
          for (const p of pages) walk(p.children, (n) => {
            if (out.length >= limit) return false;
            const okName = !s.name || n.name.toLowerCase().includes(s.name.toLowerCase());
            const okType = !s.type || n.type === s.type;
            const okText = !s.text || (n.type === 'text' && n.text.toLowerCase().includes(s.text.toLowerCase()));
            if (okName && okType && okText) out.push({ ...nodeOut(ed, n, Math.min(depth, 1)), ...(a.all ? { page: p.name } : {}) });
          });
          return out;
        }
        const pid = a.parent ? ctx.id(String(a.parent))! : ed.pageId;
        const list = ed.model.index.page(pid)?.children ?? (ed.model.index.get(pid) as ContainerNode | undefined)?.children;
        if (!list) throw new SpecError('pai não encontrado');
        return list.slice(0, limit).map((n) => nodeOut(ed, n, depth));
      },
    },
    {
      name: 'batch_design',
      title: 'Design (batch)',
      description: `Create and change layers. Operations run in order as ONE undo step; if one fails, nothing is applied. Use "ref" to reference layers created earlier in the same call. Operations:
- create {parent?: id|ref (page if omitted), index?, node: NodeSpec | nodes: [NodeSpec]} — top-level frames without x/y go to free space automatically.
- update {id | ids, props: partial NodeSpec}
- delete {id | ids}; move {id, parent?, index?, x?, y?}; duplicate {id, ref?, parent?, x?, y?, props?}; replace {id, node}
- group|frame|component {ids, ref?, name?, props?} (wrap layers); autolayout {ids, layout?}; remove_autolayout {ids}; ungroup {id}
- combine_variants {ids, variants?: {id: {Prop: Value}}, name?, ref?}; add_property {component, name, type: text|boolean|swap, default, bind?: {node, slot}}; detach {id}
- slot {id|ids, preferred?: [component names], description?, min?, max?, name?, ref?} — a frame (or layers) INSIDE a component becomes a slot: a free area each instance fills with its own content without detaching
- fill_slot {instance, slot: slot name, node|nodes: [NodeSpec], append?} — put content in an instance's slot (replaces the default content unless append: true); reset_slot {instance, slot}
- boolean {ids, operation: union|subtract|intersect|exclude, ref?}; flatten {ids, ref?}; reorder {id, where: front|back|forward|backward}
- link {from, to, action: navigate|overlay|back|close, transition?, position?}
${NODE_HELP}`,
      inputSchema: obj({ operations: arr({ type: 'object' }, 'Operations to run in order'), label: str('Name of the undo step') }, ['operations']),
      annotations: { destructiveHint: false },
      run: (a) => batchDesign(a),
    },
    {
      name: 'get_screenshot',
      title: 'Screenshot',
      description: 'PNG image of a layer (usually a screen frame) or of the whole current page (no id). Look at it to check quality after every change.',
      inputSchema: obj({ id: str('Layer id or ref name; omit for the whole page'), scale: numb('Scale (default 2, reduced to fit maxSize)'), maxSize: numb('Max width/height in px (default 1600)') }),
      annotations: { readOnlyHint: true },
      run: (a) => screenshot(a),
    },
    {
      name: 'inspect_layout',
      title: 'Inspect layout',
      description: 'Finds problems in a screen or layer: clipped/overflowing text, layers outside the frame, overlapping texts, low contrast text, tiny text, missing fonts or components. Run after building and fix everything it reports.',
      inputSchema: obj({ id: str('Layer id (usually a screen frame)') }, ['id']),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        needDoc();
        return inspect(ed, new BuildContext(ed).id(String(a.id))!);
      },
    },
    {
      name: 'find_empty_space',
      title: 'Find empty space',
      description: 'A free position on the current page for a new top-level frame of width×height (to the right of the content, or below with direction "below"; near a frame with "near").',
      inputSchema: obj({ width: numb('Width'), height: numb('Height'), gap: numb('Distance from other frames (default 100)'), near: str('Frame id'), direction: str('right or below', { enum: ['right', 'below'] }) }, ['width', 'height']),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        needDoc();
        return emptySpace(Number(a.width), Number(a.height), Number(a.gap ?? 100), a.near ? new BuildContext(ed).id(String(a.near)) : undefined, a.direction === 'below' ? 'below' : 'right');
      },
    },
    {
      name: 'variables',
      title: 'Variables',
      description: 'Design tokens with modes (e.g., Light/Dark). Actions: list; create_collection {name, modes: ["Light","Dark"]}; add_mode {collection, mode}; rename_mode {collection, mode, name}; set {collection, variables: [{name:"color/bg", type?: color|number|string|boolean, values: {Light:"#fff", Dark:"#000"} | value}]} (creates or updates; "$other" makes an alias); delete {collection, name?}; set_mode {collection, mode}. Use colors in nodes as fill:"$color/bg".',
      inputSchema: obj({ action: str('Action', { enum: ['list', 'create_collection', 'add_mode', 'rename_mode', 'set', 'delete', 'set_mode'] }), collection: str('Collection name or id'), name: str('Name'), mode: str('Mode name'), modes: arr({ type: 'string' }, 'Mode names'), variables: arr({ type: 'object' }, 'Variables to set') }, ['action']),
      run: async (a) => variables(a),
    },
    {
      name: 'styles',
      title: 'Styles',
      description: 'Reusable styles. Actions: list; create {type: text|color|effect, name, ...} or {styles: [...]} — text: font, size, weight, lineHeight, letterSpacing, italic, case; color: color (or paints); effect: shadow preset or effects; update {name, ...new values, rename?} (re-applies to every layer using it); delete {name}. Apply with textStyle / fillStyle / strokeStyle / effectStyle in nodes.',
      inputSchema: obj({
        action: str('Action', { enum: ['list', 'create', 'update', 'delete'] }),
        type: str('text, color or effect'),
        name: str('Style name'),
        rename: str('New name (update)'),
        styles: arr({ type: 'object' }, 'Several styles to create'),
        font: str('Text: font family'),
        size: numb('Text: font size'),
        weight: { type: ['number', 'string'], description: 'Text: weight (400, 700, "bold"…)' },
        lineHeight: { type: ['number', 'string'], description: 'Text: line height (px or multiplier)' },
        letterSpacing: numb('Text: letter spacing (px)'),
        case: str('Text: upper, lower, title or none'),
        color: str('Color: "#hex", "rgba(...)" or "$variable"'),
        paints: arr({}, 'Color: several paints'),
        shadow: str('Effect: preset xs|sm|md|lg|xl'),
        effects: arr({ type: 'object' }, 'Effect: [{type:"shadow"|"inner-shadow"|"blur"|"background-blur", color, x, y, blur, spread}]'),
      }, ['action']),
      run: async (a) => styles(a),
    },
    {
      name: 'search_icons',
      title: 'Search icons',
      description: 'Search the built-in outline icon set (~1600 icons, Lucide names like "arrow-right", "bell", "shopping-cart"). Portuguese words also work. Use the result in nodes: {type:"icon", icon:"bell", size:24, color:"#111"}.',
      inputSchema: obj({ query: str('Words describing the icon'), limit: numb('Max results (default 30)') }, ['query']),
      annotations: { readOnlyHint: true },
      run: (a) => searchIcons(a),
    },
    {
      name: 'list_fonts',
      title: 'Fonts',
      description: 'Font families available on this computer (Inter is always available). Pass query to filter.',
      inputSchema: obj({ query: str('Filter') }),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        const q = String(a.query ?? '').toLowerCase();
        const fams = ed.host?.fonts.sortedFamilies() ?? [];
        const list = fams.filter((f) => !q || f.family.toLowerCase().includes(q)).map((f) => ({ family: f.family, weights: [...new Set(f.faces.map((x) => x.weight))].sort((x, y) => x - y), italic: f.faces.some((x) => x.italic) }));
        return { total: list.length, fonts: list.slice(0, 300) };
      },
    },
    {
      name: 'list_components',
      title: 'Components',
      description: 'Components and variant sets in the document and linked libraries, with variant axes and properties (use the names in instance nodes: component, variant, props).',
      inputSchema: obj({ query: str('Filter by name'), limit: numb('Max results') }),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        needDoc();
        return listComponents(a);
      },
    },
    {
      name: 'analyze_design',
      title: 'Analyze design',
      description: 'Inventory of what a drawing uses: colors (with counts and where), typography combinations, radii, gaps, paddings, shadows. Use it to extract tokens from an existing design or to find inconsistencies. ids: layers to analyze (current page if omitted).',
      inputSchema: obj({ ids: arr({ type: 'string' }, 'Layer ids') }),
      annotations: { readOnlyHint: true },
      run: async (a) => {
        needDoc();
        const ctx = new BuildContext(ed);
        return analyze(ed, Array.isArray(a.ids) ? (a.ids as string[]).map((id) => ctx.id(id)!) : undefined);
      },
    },
    {
      name: 'replace_properties',
      title: 'Replace properties',
      description: 'Bulk replace values under some layers (or the whole current page): replacements: [{property: color|fill|stroke|font|fontSize|weight|radius|gap, from, to}]. Colors can be replaced by variables ("to": "$color/brand").',
      inputSchema: obj({ ids: arr({ type: 'string' }, 'Scope layers'), replacements: arr({ type: 'object' }, '{property, from, to}') }, ['replacements']),
      run: async (a) => replaceProperties(a),
    },
    {
      name: 'export_nodes',
      title: 'Export',
      description: 'Export layers to files in a folder: format png|jpg|webp|svg|pdf, scale (raster, default 2). Returns the file paths.',
      inputSchema: obj({ ids: arr({ type: 'string' }, 'Layer ids'), folder: str('Destination folder'), format: str('Format', { enum: ['png', 'jpg', 'webp', 'svg', 'pdf'] }), scale: numb('Scale') }, ['ids', 'folder']),
      run: (a) => exportNodes(a),
    },
    {
      name: 'focus',
      title: 'Show to the user',
      description: 'Select layers and zoom the canvas to them so the user sees the result.',
      inputSchema: obj({ ids: arr({ type: 'string' }, 'Layer ids') }, ['ids']),
      run: async (a) => {
        needDoc();
        const ctx = new BuildContext(ed);
        const list = (a.ids as string[]).map((id) => ctx.id(id)!);
        const pageOf = ed.model.index.pageOf?.(list[0]);
        if (pageOf && pageOf !== ed.pageId) ed.setPage(pageOf);
        ed.select(list);
        const b = unionRects(list.map((id) => ed.worldBounds(id)));
        ed.fitRect(b, 1, 60);
        showAgent(list);
        return { ok: true };
      },
    },
    {
      name: 'comments',
      title: 'Comments',
      description: 'Canvas comments: list; add {node?: id, x?, y?, text, author?} (pinned to the layer); reply {id, text}; resolve {id}.',
      inputSchema: obj({ action: str('Action', { enum: ['list', 'add', 'reply', 'resolve'] }), id: str('Comment id'), node: str('Layer id'), x: numb('x'), y: numb('y'), text: str('Text'), author: str('Author name') }, ['action']),
      run: async (a) => {
        needDoc();
        const action = String(a.action);
        if (action === 'list') return ed.comments.map((c) => ({ id: c.id, page: ed.doc.pages.find((p) => p.id === c.pageId)?.name, node: c.nodeId, author: c.author, text: c.text, resolved: !!c.resolved, replies: (c.replies ?? []).map((r) => ({ author: r.author, text: r.text })) }));
        if (action === 'add') {
          if (!a.text) throw new SpecError('informe "text"');
          const ctx = new BuildContext(ed);
          const nodeId = a.node ? ctx.id(String(a.node)) : undefined;
          const c: DocComment = { id: uid(), pageId: ed.pageId, x: Number(a.x ?? 16), y: Number(a.y ?? 16), ...(nodeId ? { nodeId } : {}), author: String(a.author ?? 'Automação'), text: String(a.text), createdAt: Date.now() };
          ed.run('Comentar', [{ op: 'doc', key: 'comments', value: [...ed.comments, c] }]);
          return { id: c.id };
        }
        if (action === 'reply') {
          ed.replyComment(String(a.id), String(a.text ?? ''));
          return { ok: true };
        }
        if (action === 'resolve') {
          ed.resolveComment(String(a.id), true);
          return { ok: true };
        }
        throw new SpecError('action: list, add, reply ou resolve');
      },
    },
  ];

  const byName = new Map(tools.map((t) => [t.name, t]));

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = byName.get(name);
    if (!tool) return { content: [{ type: 'text', text: `Ferramenta desconhecida: ${name}` }], isError: true };
    try {
      ed.host?.agent.busy();
      // leituras e capturas de uma camada: o cursor vai até ela, só olhando
      if (ed.doc && ['get_screenshot', 'inspect_layout', 'read_nodes', 'export_nodes', 'analyze_design'].includes(name)) {
        const raw = [args?.id, ...(Array.isArray(args?.ids) ? args.ids : []), args?.parent].filter((v) => typeof v === 'string') as string[];
        const ctx = new BuildContext(ed);
        const ids = raw.map((r) => ctx.id(r)).filter((v): v is string => !!v && !!ed.model.index.get(v));
        if (ids.length) showAgent(ids, true);
      }
      const res = await tool.run(args ?? {});
      if (res && typeof res === 'object' && 'content' in (res as object)) return res as ToolResult;
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 1) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Erro: ${(e as Error)?.message ?? e}` }], isError: true };
    }
  }

  return {
    describe: () => ({ instructions: INSTRUCTIONS, tools: tools.map(({ run: _r, ...t }) => t) }),
    /** Um pedido de cada vez (um lote não pode se misturar com outro). */
    handle(payload: { kind: 'describe' } | { kind: 'call'; name: string; args: Record<string, unknown> }): Promise<unknown> {
      const job: Promise<unknown> = queue.then((): unknown => (payload.kind === 'describe' ? { instructions: INSTRUCTIONS, tools: tools.map(({ run: _r, ...t }) => t) } : call(payload.name, payload.args)));
      queue = job.catch(() => undefined);
      return job;
    },
  };
}

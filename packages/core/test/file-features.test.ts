import { describe, expect, it } from 'vitest';
import {
  createDocument, createNode, serialize, parse, createVersion, readVersion, addVersion, MAX_AUTO_VERSIONS, overlayRect, nodeMatrix, apply, exportSvg, prototypeLinks, Model, resolveInstance, componentFinder,
  type DocVersion, type TextNode,
} from '../src';

describe('sobreposições do protótipo', () => {
  it('posiciona o frame sobre a tela', () => {
    expect(overlayRect(400, 800, 300, 200)).toEqual({ x: 50, y: 300, width: 300, height: 200 });
    expect(overlayRect(400, 800, 300, 200, 'bottom')).toEqual({ x: 50, y: 600, width: 300, height: 200 });
    expect(overlayRect(400, 800, 100, 100, 'top-right')).toEqual({ x: 300, y: 0, width: 100, height: 100 });
    expect(overlayRect(400, 800, 100, 100, 'left')).toEqual({ x: 0, y: 350, width: 100, height: 100 });
  });

  it('ligações de sobreposição aparecem no canvas', () => {
    const doc = createDocument('P');
    const a = createNode('frame', { x: 0, y: 0, width: 100, height: 100 });
    const b = createNode('frame', { x: 200, y: 0, width: 50, height: 50 });
    const btn = createNode('rect', { x: 10, y: 10, width: 20, height: 20 }, { interactions: [{ trigger: 'click', action: 'overlay', target: b.id, overlay: { position: 'center' } }] });
    a.children.push(btn);
    doc.pages[0].children.push(a, b);
    expect(prototypeLinks(doc.pages[0]).map((l) => l.interaction.action)).toEqual(['overlay']);
  });
});

describe('espelhar', () => {
  it('espelha em torno do centro sem sair do lugar', () => {
    const n = { x: 10, y: 20, width: 100, height: 50, flipX: true };
    const m = nodeMatrix(n);
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 110, y: 20 });
    expect(apply(m, { x: 100, y: 0 })).toEqual({ x: 10, y: 20 });
    const v = nodeMatrix({ ...n, flipX: false, flipY: true });
    expect(apply(v, { x: 0, y: 0 })).toEqual({ x: 10, y: 70 });
  });

  it('vai para o SVG', () => {
    const doc = createDocument('S');
    const r = createNode('rect', { x: 0, y: 0, width: 40, height: 20 }, { flipX: true });
    doc.pages[0].children.push(r);
    expect(exportSvg(doc, r)).toContain('scale(-1 1)');
  });
});

describe('texto em caminho', () => {
  it('exporta com textPath e sobrevive a salvar e abrir', () => {
    const doc = createDocument('T');
    const t = createNode('text', { x: 0, y: 0, width: 200, height: 100 }, { text: 'Olá mundo', autoResize: 'none', textPath: { d: 'M0 100 Q100 0 200 100', start: 10 } }) as TextNode;
    doc.pages[0].children.push(t);
    const svg = exportSvg(doc, t);
    expect(svg).toContain('<textPath');
    expect(svg).toContain('startOffset="10%"');
    const back = parse(serialize(doc));
    expect((back.pages[0].children[0] as TextNode).textPath?.d).toBe('M0 100 Q100 0 200 100');
  });
});

describe('comentários', () => {
  it('ficam no arquivo e entram no desfazer', () => {
    const m = new Model(createDocument('C'));
    const c = { id: 'c1', pageId: m.doc.pages[0].id, x: 5, y: 6, author: 'Ana', text: 'Ajustar margem', createdAt: 1 };
    m.transact('Comentar', [{ op: 'doc', key: 'comments', value: [c] }]);
    expect(parse(serialize(m.doc)).comments?.[0].text).toBe('Ajustar margem');
    m.undo();
    expect(m.doc.comments).toBeUndefined();
  });
});

describe('histórico de versões', () => {
  it('guarda e lê de volta o documento, sem imagens e sem o próprio histórico', async () => {
    const doc = createDocument('Teste');
    doc.pages[0].children.push(createNode('rect', { x: 10, y: 20, width: 30, height: 40 }, { name: 'Caixa' }));
    doc.assets = { a1: { mime: 'image/png', data: 'AAAA' } };
    const v = await createVersion(doc, 'Primeira');
    doc.versions = addVersion(doc.versions, v);
    expect(v.pages).toBe(1);
    expect(v.size).toBeGreaterThan(0);

    // muda depois de guardar
    doc.pages[0].children[0].x = 999;
    const back = await readVersion(v, doc);
    expect(back.pages[0].children[0].x).toBe(10);
    expect(back.assets).toBe(doc.assets); // as imagens vêm do documento atual
    expect(back.versions).toBe(doc.versions);

    // o histórico vai no arquivo e volta ao abrir
    const reopened = parse(serialize(doc));
    expect(reopened.versions?.[0].name).toBe('Primeira');
    expect((await readVersion(reopened.versions![0], reopened)).pages[0].children[0].x).toBe(10);
  });

  it('descarta só as versões automáticas mais antigas', () => {
    let list: DocVersion[] = [{ id: 'nomeada', name: 'Aprovada', createdAt: 0, data: '', size: 0, pages: 1 }];
    for (let i = 0; i < MAX_AUTO_VERSIONS + 5; i++) list = addVersion(list, { id: `a${i}`, name: 'Auto', createdAt: i, auto: true, data: '', size: 0, pages: 1 });
    expect(list.filter((v) => v.auto)).toHaveLength(MAX_AUTO_VERSIONS);
    expect(list[0].id).toBe('nomeada');
    expect(list[1].id).toBe('a5');
  });

  it('arquivo sem versões nem comentários não ganha essas chaves', () => {
    const text = serialize(createDocument('Limpo'));
    expect(text).not.toContain('"versions"');
    expect(text).not.toContain('"comments"');
  });
});

describe('instância aninhada trocando de variante', () => {
  it('passa para o tamanho da nova variante (sem cortar o conteúdo)', () => {
    const a = createNode('component', { x: 0, y: 0, width: 50, height: 20 }, { name: 'Status=Ok', variant: { Status: 'Ok' } });
    const b = createNode('component', { x: 60, y: 0, width: 80, height: 20 }, { name: 'Status=Atrasado', variant: { Status: 'Atrasado' } });
    const set = createNode('component-set', { x: 0, y: 0, width: 160, height: 40 }, { name: 'Status', children: [a, b] });
    const inner = createNode('instance', { x: 0, y: 0, width: 50, height: 20 }, { componentId: a.id });
    const row = createNode('component', { x: 0, y: 100, width: 200, height: 20 }, { name: 'Linha', children: [inner] });
    const inst = createNode('instance', { x: 0, y: 200, width: 200, height: 20 }, { componentId: row.id, overrides: { [inner.id]: { componentId: b.id } } });
    const find = componentFinder(createDocument('x'), () => [a, b, row], (id) => (set.children.some((c) => c.id === id) ? set : undefined));
    const r = resolveInstance(inst, find) as unknown as { children: { width: number }[] };
    expect(r.children[0].width).toBe(80);
  });
});

import { describe, expect, it } from 'vitest';
import { createNode, type ContainerNode, type InstanceNode, type TextNode } from '@zaliel/core';
import { Editor } from '../src/editor';
import type { Platform } from '../src/platform';
import { createAutomation } from '../src/automation';

/** Plataforma de mentira: o editor só precisa dela para salvar, avisos de janela e afins. */
function editor(): Editor {
  const platform = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as unknown as Platform;
  const ed = new Editor(platform);
  ed.home = false;
  ed.strict = true;
  return ed;
}

/** Shell com barra lateral fixa e a área de conteúdo como slot (auto layout vertical). */
function shell(ed: Editor) {
  const lateral = createNode('frame', { x: 0, y: 0, width: 120, height: 400 }, { name: 'Lateral' });
  const padrao = createNode('rect', { x: 0, y: 0, width: 100, height: 30 }, { name: 'Vazio' });
  const area = createNode('frame', { x: 120, y: 0, width: 280, height: 400 }, {
    name: 'Conteúdo',
    fills: [],
    layout: { direction: 'vertical', gap: 10, padding: [16, 16, 16, 16], justify: 'start', align: 'start' },
    children: [padrao],
  });
  const comp = createNode('component', { x: 0, y: 0, width: 400, height: 400 }, { name: 'Shell', children: [lateral, area] });
  const linha = createNode('component', { x: 0, y: 500, width: 200, height: 40 }, { name: 'Linha' });
  ed.run('Componentes', [
    { op: 'insert', parent: ed.pageId, index: 0, node: comp },
    { op: 'insert', parent: ed.pageId, index: 1, node: linha },
  ]);
  ed.convertToSlot([area.id]);
  const inst = createNode('instance', { x: 600, y: 0, width: 400, height: 400 }, { componentId: comp.id, name: 'Tela' });
  ed.insert(inst);
  return { comp, area, linha, padrao, inst: () => ed.model.index.get(inst.id) as InstanceNode };
}

describe('slots no editor', () => {
  it('converter em slot marca o frame; camadas soltas são embrulhadas num frame-slot', () => {
    const ed = editor();
    const { area, comp } = shell(ed);
    expect((ed.model.index.get(area.id) as ContainerNode).slot).toEqual({});
    const r = createNode('rect', { x: 10, y: 10, width: 20, height: 20 });
    ed.insert(r, comp.id);
    ed.convertToSlot([r.id]);
    const wrap = ed.model.index.get(ed.model.index.parentId(r.id)!) as ContainerNode;
    expect(wrap.type).toBe('frame');
    expect(wrap.slot).toEqual({});
    expect(wrap.name).toBe('Slot');
    ed.undo();
    expect(ed.model.index.parentId(r.id)).toBe(comp.id);
  });

  it('o ponto sobre a área do slot é destino (e vira o frame do slot quando ele existe)', () => {
    const ed = editor();
    const { inst, area } = shell(ed);
    const p = { x: 600 + 200, y: 100 };
    expect(ed.containerAt(p)).toBe(`${inst().id}/${area.id}`);
    // fora do slot (na lateral): a instância não recebe camadas
    expect(ed.containerAt({ x: 610, y: 100 })).toBe(ed.pageId);
    // coordenadas locais do slot
    expect(ed.toLocal(`${inst().id}/${area.id}`, p)).toEqual({ x: 80, y: 100 });
    ed.insertIntoSlot(inst().id, area.id, ed.model.index.components().find((c) => c.name === 'Linha')!.id);
    const holder = inst().slots![0];
    expect(ed.containerAt(p)).toBe(holder.id);
  });

  it('inserir sugerido, esvaziar e restaurar', () => {
    const ed = editor();
    const { inst, area, linha } = shell(ed);
    ed.insertIntoSlot(inst().id, area.id, linha.id);
    let holder = inst().slots![0];
    // o conteúdo padrão vem junto (como no Figma) e o novo entra embaixo, no auto layout do slot
    expect(holder.children.map((c) => c.name)).toEqual(['Vazio', 'Linha']);
    const novo = holder.children[1];
    expect(ed.selection).toEqual([novo.id]);
    expect(ed.worldBounds(novo.id)).toEqual({ x: 600 + 120 + 16, y: 16 + 30 + 10, width: 200, height: 40 });
    ed.clearSlot(inst().id, area.id);
    holder = inst().slots![0];
    expect(holder.children).toHaveLength(0);
    ed.resetSlot(inst().id, area.id);
    expect(inst().slots).toBeUndefined();
  });

  it('esvaziar um slot que nunca foi mexido cria o frame vazio', () => {
    const ed = editor();
    const { inst, area } = shell(ed);
    ed.clearSlot(inst().id, area.id);
    expect(inst().slots![0].children).toEqual([]);
    expect(inst().slots![0].slotOf).toBe(area.id);
  });

  it('o frame do slot não é movido, agrupado nem duplicado', () => {
    const ed = editor();
    const { inst, area, linha } = shell(ed);
    ed.insertIntoSlot(inst().id, area.id, linha.id);
    const holder = inst().slots![0];
    expect(ed.topLevel([holder.id])).toEqual([]);
    ed.select([holder.id]);
    ed.duplicate();
    expect(inst().slots).toHaveLength(1);
  });

  it('restaurar a instância também volta os slots ao padrão', () => {
    const ed = editor();
    const { inst, area, linha } = shell(ed);
    ed.insertIntoSlot(inst().id, area.id, linha.id);
    ed.select([inst().id]);
    ed.resetOverrides();
    expect(inst().slots).toBeUndefined();
  });

  it('trocar de variante leva o conteúdo para o slot de mesmo nome', () => {
    const ed = editor();
    const { comp, inst, area, linha } = shell(ed);
    ed.select([comp.id]);
    ed.addVariant(comp.id);
    const set = ed.setFor(comp.id)!;
    const outra = set.children.find((c) => c.id !== comp.id) as ContainerNode;
    const outraArea = outra.children.find((c) => c.name === 'Conteúdo')!;
    ed.insertIntoSlot(inst().id, area.id, linha.id);
    ed.setInstanceVariant(inst().id, Object.keys(outra.variant!)[0], Object.values(outra.variant!)[0]);
    expect(inst().componentId).toBe(outra.id);
    expect(inst().slots![0].slotOf).toBe(outraArea.id);
  });

  it('automação: slot, instância com slots e fill_slot', async () => {
    const ed = editor();
    shell(ed);
    const auto = createAutomation(ed);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await auto.handle({ kind: 'call', name, args })) as { content: { text: string }[]; isError?: boolean };
      if (r.isError) throw new Error(r.content[0].text);
      return JSON.parse(r.content[0].text);
    };
    const ok = await call('batch_design', {
      operations: [{ op: 'create', node: { type: 'instance', ref: 'tela', component: 'Shell', x: 0, y: 900, slots: { Conteúdo: [{ type: 'text', text: 'Olá' }, { type: 'instance', component: 'Linha' }] } } }],
    });
    const id = ok.created.tela as string;
    const inst = ed.model.index.get(id) as InstanceNode;
    expect(inst.slots![0].children.map((c) => c.type)).toEqual(['text', 'instance']);
    expect((inst.slots![0].children[0] as TextNode).text).toBe('Olá');
    // fill_slot troca o conteúdo; append acrescenta
    await call('batch_design', { operations: [{ op: 'fill_slot', instance: id, slot: 'Conteúdo', nodes: [{ type: 'text', text: 'Só isto' }] }] });
    expect((ed.model.index.get(id) as InstanceNode).slots![0].children.map((c) => (c as TextNode).text)).toEqual(['Só isto']);
    await call('batch_design', { operations: [{ op: 'fill_slot', instance: id, slot: 'Conteúdo', append: true, node: { type: 'text', text: 'E mais' } }] });
    expect((ed.model.index.get(id) as InstanceNode).slots![0].children).toHaveLength(2);
    // leitura mostra os slots
    const read = await call('read_nodes', { ids: [id], depth: 2 });
    expect(Object.keys(read[0].slots)).toEqual(['Conteúdo']);
    // slot desconhecido explica quais existem
    await expect(call('batch_design', { operations: [{ op: 'fill_slot', instance: id, slot: 'Rodapé', node: { type: 'text', text: 'x' } }] })).rejects.toThrow(/tem: Conteúdo/);
    await call('batch_design', { operations: [{ op: 'reset_slot', instance: id, slot: 'Conteúdo' }] });
    expect((ed.model.index.get(id) as InstanceNode).slots).toBeUndefined();
  });

  it('automação: criar um componente com slot e sugeridos', async () => {
    const ed = editor();
    shell(ed);
    const auto = createAutomation(ed);
    const r = (await auto.handle({ kind: 'call', name: 'batch_design', args: { operations: [{ op: 'create', node: { type: 'component', ref: 'card', name: 'Cartão', layout: { direction: 'vertical' }, children: [{ type: 'frame', ref: 'corpo', name: 'Corpo', slot: { preferred: ['Linha'], min: 1 } }] } }] } })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    const corpo = ed.model.index.components().find((c) => c.name === 'Cartão')!.children[0] as ContainerNode;
    const linha = ed.model.index.components().find((c) => c.name === 'Linha')!;
    expect(corpo.slot).toEqual({ preferred: [{ componentId: linha.id }], min: 1 });
  });
});

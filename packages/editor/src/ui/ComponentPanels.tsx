// Painéis de componentes: variantes, propriedades (booleana, texto, troca de instância),
// ligação de camadas às propriedades, slots e os controles da instância.
import { useState } from 'react';
import { Plus, Minus, Component, Unlink, CornerUpLeft, SquarePlus, ToggleLeft, Type, Replace, SquareDashed, Eraser, RotateCcw, X } from 'lucide-react';
import { componentSlots, overridableTexts, propertyValues, slotHolder, variantAxes, type ComponentProperty, type ContainerNode, type InstanceNode, type SceneNode, type SlotDef } from '@zaliel/core';
import type { Editor } from '../editor';
import { useEditor } from './hooks';
import { Check, IconBtn, NumberField, Section, Select, TextField } from './controls';
import { Menu } from './Menu';

const TYPE_LABEL: Record<ComponentProperty['type'], string> = { boolean: 'Booleana', text: 'Texto', swap: 'Troca de instância' };
const TYPE_ICON: Record<ComponentProperty['type'], React.ReactNode> = {
  boolean: <ToggleLeft size={12} />,
  text: <Type size={12} />,
  swap: <Replace size={12} />,
};

/** Componentes que podem entrar numa troca de instância (do arquivo e das bibliotecas). */
function useSwapOptions(): { value: string; label: string }[] {
  const ed = useEditor('doc');
  const out: { value: string; label: string }[] = [];
  const name = (c: ContainerNode, set?: ContainerNode) => (set ? `${set.name} / ${c.name}` : c.name);
  for (const c of ed.model.index.components()) out.push({ value: c.id, label: name(c, ed.setFor(c.id)) });
  for (const lib of ed.doc.libraries) {
    for (const c of lib.components) {
      if (c.type === 'component-set') for (const v of c.children) out.push({ value: v.id, label: `${lib.name} · ${name(v as ContainerNode, c)}` });
      else out.push({ value: c.id, label: `${lib.name} · ${c.name}` });
    }
  }
  return out;
}

// ── Conjunto de variantes ────────────────────────────────────────────────────

export function VariantSetSection({ set }: { set: ContainerNode }) {
  const ed = useEditor('doc');
  const axes = variantAxes(set);
  const count = set.children.filter((c) => c.type === 'component').length;
  return (
    <Section
      title="Variantes"
      actions={<IconBtn icon={<Plus size={14} />} tip="Nova propriedade de variante" onClick={() => {
        let i = axes.length + 1;
        while (axes.some((a) => a.name === `Propriedade ${i}`)) i++;
        ed.editVariantAxis(set.id, null, `Propriedade ${i}`);
      }} />}
    >
      {axes.map((a) => (
        <div key={a.name} style={{ marginBottom: 8 }}>
          <div className="row">
            <TextField className="grow" value={a.name} onChange={(v) => v.trim() && ed.editVariantAxis(set.id, a.name, v)} />
            <IconBtn icon={<Minus size={13} />} tip="Remover propriedade" onClick={() => ed.editVariantAxis(set.id, a.name, null)} />
          </div>
          <div className="chips">
            {a.values.map((v) => <span key={v} className="chip">{v}</span>)}
          </div>
        </div>
      ))}
      {!axes.length && <div className="muted" style={{ marginBottom: 8 }}>As variantes ainda não têm propriedades.</div>}
      <button className="btn small block" onClick={() => ed.addVariant(set.id)}><SquarePlus size={12} /> Adicionar variante</button>
      <div className="label" style={{ marginTop: 6 }}>{count} variante{count === 1 ? '' : 's'} · clique numa variante para editar os valores dela</div>
    </Section>
  );
}

/** Valores de uma variante dentro do conjunto. */
export function VariantValuesSection({ comp, set }: { comp: ContainerNode; set: ContainerNode }) {
  const ed = useEditor('doc');
  const axes = variantAxes(set);
  return (
    <Section title="Variante" actions={<IconBtn icon={<SquarePlus size={14} />} tip="Duplicar como nova variante" onClick={() => ed.addVariant(comp.id)} />}>
      {axes.map((a) => (
        <div className="row" key={a.name} style={{ marginBottom: 6 }}>
          <span className="label" style={{ width: 92, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
          <TextField className="grow" value={comp.variant?.[a.name] ?? ''} placeholder="Valor" onChange={(v) => ed.setVariantValue(comp.id, a.name, v)} />
        </div>
      ))}
      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn small ghost" onClick={() => ed.select([set.id])}>Selecionar o conjunto “{set.name}”</button>
      </div>
    </Section>
  );
}

// ── Propriedades ─────────────────────────────────────────────────────────────

export function PropertiesSection({ owner }: { owner: ContainerNode }) {
  const ed = useEditor('doc');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const swaps = useSwapOptions();
  const props = owner.properties ?? [];
  return (
    <Section
      title="Propriedades"
      empty={!props.length}
      actions={<IconBtn icon={<Plus size={14} />} tip="Nova propriedade" onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenu({ x: r.left - 120, y: r.bottom + 4 });
      }} />}
    >
      {props.map((p) => (
        <div key={p.id} className="prop-def">
          <div className="row">
            <span className="prop-kind" title={TYPE_LABEL[p.type]}>{TYPE_ICON[p.type]}</span>
            <TextField className="grow" value={p.name} onChange={(v) => v.trim() && ed.updateProperty(owner.id, p.id, { name: v.trim() })} />
            <IconBtn icon={<Minus size={13} />} tip="Remover propriedade" onClick={() => ed.removeProperty(owner.id, p.id)} />
          </div>
          <div className="row" style={{ marginTop: 4, paddingLeft: 22 }}>
            {p.type === 'boolean' && <Check checked={p.default} onChange={(v) => ed.updateProperty(owner.id, p.id, { default: v })} label="Visível por padrão" />}
            {p.type === 'text' && <TextField className="grow" value={p.default} placeholder="Texto padrão" onChange={(v) => ed.updateProperty(owner.id, p.id, { default: v })} />}
            {p.type === 'swap' && <Select className="grow" value={p.default} options={swaps} onChange={(v) => ed.updateProperty(owner.id, p.id, { default: v })} title="Componente padrão" />}
          </div>
        </div>
      ))}
      {props.length > 0 && <div className="label" style={{ marginTop: 2 }}>Ligue camadas às propriedades selecionando a camada dentro do componente.</div>}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={(['boolean', 'text', 'swap'] as const).map((t) => ({ label: TYPE_LABEL[t], icon: TYPE_ICON[t], run: () => ed.addProperty(owner.id, t) }))}
        />
      )}
    </Section>
  );
}

/** Liga uma camada de dentro do componente a uma propriedade. */
export function PropertyBindSection({ node, owner }: { node: SceneNode; owner: ContainerNode }) {
  const ed = useEditor('doc');
  const props = owner.properties ?? [];
  const NEW = '__nova__';
  const NONE = '';
  const slots: { slot: 'visible' | 'text' | 'component'; type: ComponentProperty['type']; label: string }[] = [{ slot: 'visible', type: 'boolean', label: 'Visibilidade' }];
  if (node.type === 'text') slots.push({ slot: 'text', type: 'text', label: 'Conteúdo' });
  if (node.type === 'instance') slots.push({ slot: 'component', type: 'swap', label: 'Instância' });
  return (
    <Section title="Propriedade do componente">
      {slots.map(({ slot, type, label }) => {
        const options = [{ value: NONE, label: '— Nenhuma' }, ...props.filter((p) => p.type === type).map((p) => ({ value: p.id, label: p.name })), { value: NEW, label: `+ Nova ${TYPE_LABEL[type].toLowerCase()}` }];
        return (
          <div className="row" key={slot} style={{ marginBottom: 6 }}>
            <span className="label" style={{ width: 80, flex: 'none' }}>{label}</span>
            <Select
              className="grow"
              value={node.propRefs?.[slot] ?? NONE}
              options={options}
              onChange={(v) => {
                if (v === NEW) ed.addProperty(owner.id, type, { nodeId: node.id, slot });
                else ed.bindProperty(node.id, slot, v || undefined);
              }}
            />
          </div>
        );
      })}
      <div className="label">Propriedades de “{owner.name}”: as instâncias mudam estes valores sem desanexar.</div>
    </Section>
  );
}

// ── Slots ────────────────────────────────────────────────────────────────────

/** Nome legível de um componente (com o conjunto de variantes, se for o caso). */
function componentLabel(ed: Editor, id: string, library?: string): string {
  const c = ed.findComponent(id, library);
  if (!c) return 'Componente ausente';
  const set = ed.finder.setOf?.(c.id, library);
  return set ? `${set.name} / ${c.name}` : c.name;
}

/** Biblioteca de onde vem um componente escolhido na lista (undefined = do próprio arquivo). */
function libraryOf(ed: Editor, id: string): string | undefined {
  if (ed.model.index.get(id)) return undefined;
  return ed.doc.libraries.find((l) => l.components.some((c) => c.id === id || (c.type === 'component-set' && c.children.some((k) => k.id === id))))?.id;
}

/** Frame dentro de um componente: marcar como slot e configurar (sugeridos, limites, descrição). */
export function SlotSection({ node }: { node: ContainerNode }) {
  const ed = useEditor('doc');
  const options = useSwapOptions();
  const def: SlotDef | undefined = node.slot;
  if (!def) {
    return (
      <Section title="Slot">
        <button className="btn small block" onClick={() => ed.convertToSlot([node.id])}><SquareDashed size={12} /> Converter em slot</button>
        <div className="label" style={{ marginTop: 6 }}>Cada instância coloca o próprio conteúdo neste frame, sem desanexar. Posição e auto layout continuam vindo do componente.</div>
      </Section>
    );
  }
  const preferred = def.preferred ?? [];
  const own = ed.propertyOwner(node.id);
  const free = options.filter((o) => !preferred.some((p) => p.componentId === o.value) && o.value !== own?.id && !own?.children.some((c) => c.id === o.value));
  return (
    <Section title="Slot" actions={<IconBtn icon={<Minus size={13} />} tip="Deixar de ser slot" onClick={() => ed.removeSlot(node.id)} />}>
      <TextField value={def.description ?? ''} placeholder="Descrição (para quem usa o componente)" onChange={(v) => ed.updateSlot(node.id, { description: v.trim() || undefined })} />
      <div className="label" style={{ margin: '8px 0 4px' }}>Componentes sugeridos</div>
      {preferred.map((p) => (
        <div className="row" key={`${p.library ?? ''}:${p.componentId}`} style={{ marginBottom: 4 }}>
          <Component size={12} style={{ color: 'var(--component)', flex: 'none' }} />
          <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{componentLabel(ed, p.componentId, p.library)}</span>
          <IconBtn icon={<X size={12} />} tip="Tirar dos sugeridos" onClick={() => ed.updateSlot(node.id, { preferred: preferred.filter((x) => x !== p) })} />
        </div>
      ))}
      <Select
        value=""
        options={[{ value: '', label: '+ Sugerir componente…' }, ...free]}
        onChange={(v) => {
          if (!v) return;
          const library = libraryOf(ed, v);
          ed.updateSlot(node.id, { preferred: [...preferred, { componentId: v, ...(library ? { library } : {}) }] });
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="label" style={{ width: 70, flex: 'none' }}>Camadas</span>
        <NumberField className="grow" value={def.min} placeholder="Mín." min={0} step={1} precision={0} title="Mínimo de camadas (só avisa)" onChange={(v) => ed.updateSlot(node.id, { min: v > 0 ? Math.round(v) : undefined })} />
        <NumberField className="grow" value={def.max} placeholder="Máx." min={0} step={1} precision={0} title="Máximo de camadas (só avisa)" onChange={(v) => ed.updateSlot(node.id, { max: v > 0 ? Math.round(v) : undefined })} />
      </div>
      <div className="label" style={{ marginTop: 6 }}>Os sugeridos aparecem na instância para inserir com um clique; outros conteúdos continuam permitidos.</div>
    </Section>
  );
}

/** Situação de um slot na instância: padrão, alterado, vazio, e se está dentro dos limites. */
function slotState(def: SlotDef, count: number, own: boolean): { text: string; warn?: string } {
  const text = !own ? 'Padrão do componente' : count ? `Alterado · ${count} camada${count === 1 ? '' : 's'}` : 'Vazio';
  if (def.min !== undefined && count < def.min) return { text, warn: `pede pelo menos ${def.min}` };
  if (def.max !== undefined && count > def.max) return { text, warn: `recomendado até ${def.max}` };
  return { text };
}

/** Um slot de uma instância: sugeridos para inserir, esvaziar e restaurar. */
function SlotRow({ inst, slot }: { inst: InstanceNode; slot: ContainerNode }) {
  const ed = useEditor('doc');
  const options = useSwapOptions();
  const holder = slotHolder(inst, slot.id);
  const def = slot.slot ?? {};
  const count = (holder ?? slot).children.length;
  const st = slotState(def, count, !!holder);
  const preferred = def.preferred ?? [];
  return (
    <div className="prop-def" style={{ marginBottom: 8 }}>
      <div className="row">
        <SquareDashed size={12} style={{ color: 'var(--slot)', flex: 'none' }} />
        <span className="grow" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={def.description}>{slot.name}</span>
        <IconBtn icon={<Eraser size={12} />} tip="Esvaziar o slot" disabled={!!holder && !count} onClick={() => ed.clearSlot(inst.id, slot.id)} />
        <IconBtn icon={<RotateCcw size={12} />} tip="Restaurar o conteúdo padrão" disabled={!holder} onClick={() => ed.resetSlot(inst.id, slot.id)} />
      </div>
      <div className="label" style={{ margin: '2px 0 4px 18px' }}>
        {st.text}
        {st.warn && <span style={{ color: 'var(--warn)' }}> · {st.warn}</span>}
      </div>
      {def.description && <div className="label" style={{ margin: '0 0 4px 18px' }}>{def.description}</div>}
      {preferred.length > 0 && (
        <div className="chips" style={{ marginLeft: 18 }}>
          {preferred.map((p) => (
            <button key={`${p.library ?? ''}:${p.componentId}`} className="chip slot-chip" title="Inserir no slot" onClick={() => ed.insertIntoSlot(inst.id, slot.id, p.componentId, p.library)}>
              <Plus size={10} /> {componentLabel(ed, p.componentId, p.library)}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginLeft: 18, marginTop: 4 }}>
        <Select
          value=""
          options={[{ value: '', label: '+ Inserir componente…' }, ...options.filter((o) => o.value !== inst.componentId)]}
          onChange={(v) => v && ed.insertIntoSlot(inst.id, slot.id, v, libraryOf(ed, v))}
        />
      </div>
    </div>
  );
}

/** Slots de uma instância. */
export function InstanceSlotsSection({ inst }: { inst: InstanceNode }) {
  const ed = useEditor('doc');
  const main = ed.findComponent(inst.componentId, inst.library);
  const slots = main ? componentSlots(main) : [];
  if (!slots.length) return null;
  return (
    <Section title="Slots">
      {slots.map((s) => <SlotRow key={s.id} inst={inst} slot={s} />)}
      <div className="label">Arraste camadas para dentro do slot no canvas ou desenhe direto nele. Duplo clique entra no conteúdo.</div>
    </Section>
  );
}

/** Frame de conteúdo de um slot selecionado (na instância). */
export function SlotHolderSection({ holder }: { holder: ContainerNode }) {
  const ed = useEditor('doc');
  const info = ed.slotInfo(holder.id);
  if (!info) {
    return (
      <Section title="Slot">
        <div className="label">O componente não tem mais este slot. Mova as camadas para fora ou apague o frame.</div>
      </Section>
    );
  }
  return (
    <Section title="Slot">
      <SlotRow inst={info.inst} slot={info.slot} />
      <button className="btn small ghost" onClick={() => ed.select([info.inst.id])}>Selecionar a instância “{info.inst.name}”</button>
    </Section>
  );
}

// ── Instância ────────────────────────────────────────────────────────────────

export function InstanceSection({ inst }: { inst: InstanceNode }) {
  const ed = useEditor('doc');
  const { defs, set, main } = ed.instanceInfo(inst);
  const swaps = useSwapOptions();
  const lib = inst.library ? ed.doc.libraries.find((l) => l.id === inst.library) : null;
  const values = propertyValues(defs, inst);
  // textos ligados a propriedades são editados pela propriedade
  const bound = new Set<string>();
  const visit = (list: SceneNode[]) => list.forEach((n) => {
    if (n.propRefs?.text) bound.add(n.id);
    if ('children' in n) visit(n.children);
  });
  if (main) visit(main.children);
  const texts = main ? overridableTexts(main).filter((t) => !bound.has(t.id)) : [];
  const axes = set ? variantAxes(set) : [];
  return (
    <Section title="Instância">
      <div className="row" style={{ marginBottom: 8 }}>
        <Component size={14} style={{ color: 'var(--component)' }} />
        <span className="grow" style={{ color: 'var(--component)', fontWeight: 500 }}>{set ? set.name : main?.name ?? 'Componente ausente'}</span>
        {lib && <span className="badge">{lib.name}</span>}
      </div>
      {!main && <div className="label" style={{ color: 'var(--danger)', marginBottom: 8 }}>O componente desta instância não está mais disponível. Desanexe para manter o conteúdo.</div>}
      {axes.map((a) => (
        <div className="row" key={a.name} style={{ marginBottom: 6 }}>
          <span className="label" style={{ width: 92, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
          <Select className="grow" value={main?.variant?.[a.name] ?? ''} options={a.values.map((v) => ({ value: v, label: v }))} onChange={(v) => ed.setInstanceVariant(inst.id, a.name, v)} />
        </div>
      ))}
      {defs.map((d) => (
        <div className="row" key={d.id} style={{ marginBottom: 6 }}>
          <span className="label" style={{ width: 92, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }} title={TYPE_LABEL[d.type]}>{d.name}</span>
          {d.type === 'boolean' && (
            <span className="grow">
              <Check checked={values[d.id] === true} onChange={(v) => ed.setInstanceProp(inst.id, d.id, v)} label={values[d.id] ? 'Visível' : 'Oculto'} />
            </span>
          )}
          {d.type === 'text' && <TextField className="grow" value={String(values[d.id] ?? '')} onChange={(v) => ed.setInstanceProp(inst.id, d.id, v)} />}
          {d.type === 'swap' && <Select className="grow" value={String(values[d.id])} options={swaps} onChange={(v) => ed.setInstanceProp(inst.id, d.id, v)} />}
        </div>
      ))}
      {texts.map((t) => (
        <div key={t.id} style={{ marginBottom: 6 }}>
          <div className="label" style={{ marginBottom: 3 }}>{t.name}</div>
          <TextField value={inst.overrides?.[t.id]?.text ?? t.text} onChange={(v) => ed.setOverride(inst.id, t.id, { text: v })} />
        </div>
      ))}
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        {!inst.library && main && <button className="btn small" onClick={() => ed.goToMainComponent()}><CornerUpLeft size={12} /> Principal</button>}
        <button className="btn small" onClick={() => ed.resetOverrides()} disabled={(!inst.overrides || !Object.keys(inst.overrides).length) && (!inst.props || !Object.keys(inst.props).length) && !inst.slots?.length}>Restaurar</button>
        <button className="btn small" onClick={() => ed.detach()}><Unlink size={12} /> Desanexar</button>
      </div>
    </Section>
  );
}

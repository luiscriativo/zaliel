// Painéis de componentes: variantes, propriedades (booleana, texto, troca de instância),
// ligação de camadas às propriedades e os controles da instância.
import { useState } from 'react';
import { Plus, Minus, Component, Unlink, CornerUpLeft, SquarePlus, ToggleLeft, Type, Replace } from 'lucide-react';
import { overridableTexts, propertyValues, variantAxes, type ComponentProperty, type ContainerNode, type InstanceNode, type SceneNode } from '@zaliel/core';
import { useEditor } from './hooks';
import { Check, IconBtn, Section, Select, TextField } from './controls';
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
        <button className="btn small" onClick={() => ed.resetOverrides()} disabled={(!inst.overrides || !Object.keys(inst.overrides).length) && (!inst.props || !Object.keys(inst.props).length)}>Restaurar</button>
        <button className="btn small" onClick={() => ed.detach()}><Unlink size={12} /> Desanexar</button>
      </div>
    </Section>
  );
}

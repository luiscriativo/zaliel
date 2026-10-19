import { useMemo, useState } from 'react';
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Plus, Minus, Eye, EyeOff, ArrowRight, ArrowDown, WrapText,
  RotateCw, Scan, AlignLeft, AlignCenter, AlignRight, AlignJustify, Underline, Strikethrough, Variable, Component, Download, SquareDashed,
  MoveHorizontal, MoveVertical, ArrowUpToLine, ArrowDownToLine, FoldVertical, FlipVertical2, SquaresUnite, SquaresSubtract, SquaresIntersect, SquaresExclude, Spline, PenTool, Layers2, Ruler,
} from 'lucide-react';
import {
  findVariable, allCollections, clone, detachPatch, scalePath, acceptsStrokeSides, RUN_ATTRS, clearRunAttr,
  type StrokeSides, type AutoLayout, type BlendMode, type BooleanOp, type ContainerNode, type Effect, type Paint, type SceneNode, type ShapeNode, type Stroke, type TextNode, type TextStyle, type SizingMode,
} from '@zaliel/core';
import { useEditor } from './hooks';
import { Check, IconBtn, NumberField, Section, Seg, Select, common, MIXED, type Maybe } from './controls';
import { PaintPicker, paintCss } from './ColorPicker';
import { InstanceSection, InstanceSlotsSection, PropertiesSection, PropertyBindSection, SlotHolderSection, SlotSection, VariantSetSection, VariantValuesSection } from './ComponentPanels';
import { LayoutGridSection } from './GridSection';
import { PrototypePanel } from './PrototypePanel';
import { LocalStyles, StyleButton, StyleRow, linkedStyle } from './Styles';

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiplicar' }, { value: 'screen', label: 'Tela' }, { value: 'overlay', label: 'Sobrepor' },
  { value: 'darken', label: 'Escurecer' }, { value: 'lighten', label: 'Clarear' }, { value: 'color-dodge', label: 'Subexposição de cor' }, { value: 'color-burn', label: 'Superexposição de cor' },
  { value: 'hard-light', label: 'Luz direta' }, { value: 'soft-light', label: 'Luz suave' }, { value: 'difference', label: 'Diferença' }, { value: 'exclusion', label: 'Exclusão' },
  { value: 'hue', label: 'Matiz' }, { value: 'saturation', label: 'Saturação' }, { value: 'color', label: 'Cor' }, { value: 'luminosity', label: 'Luminosidade' },
];

const TYPE_NAMES: Record<string, string> = {
  frame: 'Frame', group: 'Grupo', rect: 'Retângulo', ellipse: 'Elipse', line: 'Linha', polygon: 'Polígono', star: 'Estrela', path: 'Vetor', text: 'Texto', component: 'Componente',
  'component-set': 'Variantes', boolean: 'Booleana', instance: 'Instância',
};

export function DesignPanel() {
  const ed = useEditor('selection', 'doc', 'ui');
  const nodes = ed.selectedNodes();
  return (
    <aside className="panel right">
      <div className="tabs">
        <button className={ed.rightTab === 'design' ? 'on' : ''} onClick={() => ed.setRightTab('design')}>Design</button>
        <button className={ed.rightTab === 'prototype' ? 'on' : ''} onClick={() => ed.setRightTab('prototype')}>Protótipo</button>
      </div>
      <div className="scroll">
        {ed.rightTab === 'prototype' ? <PrototypePanel /> : nodes.length === 0 ? <PageSection /> : <NodeSections nodes={nodes} />}
      </div>
    </aside>
  );
}

function PageSection() {
  const ed = useEditor('doc');
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const cols = allCollections(ed.doc).filter((c) => c.modes.length > 1);
  return (
    <>
      <Section title="Página">
        <div className="paint-row">
          <label className="field">
            <span className="lead">
              <button className="swatch" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} aria-label="Cor de fundo">
                <i style={{ background: ed.page.background }} />
              </button>
            </span>
            <input
              key={ed.page.background}
              defaultValue={ed.page.background.slice(1).toUpperCase()}
              onBlur={(e) => {
                const v = e.target.value.replace('#', '');
                if (/^[0-9a-f]{6}$/i.test(v)) ed.run('Fundo da página', [{ op: 'set', id: ed.pageId, key: 'background', value: `#${v.toLowerCase()}` }]);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
        </div>
        {picker && (
          <PaintPicker
            anchor={picker}
            allowImage={false}
            paint={{ type: 'solid', color: ed.page.background }}
            onClose={() => setPicker(null)}
            onChange={(p, merge) => p.type === 'solid' && ed.run('Fundo da página', [{ op: 'set', id: ed.pageId, key: 'background', value: p.color.slice(0, 7) }], { merge })}
          />
        )}
      </Section>
      <Section title="Variáveis" actions={<IconBtn icon={<Variable size={14} />} tip="Abrir variáveis" onClick={() => ed.openDialog('variables')} />}>
        {cols.length ? (
          cols.map((c) => (
            <div className="row" key={c.id}>
              <span className="grow muted">{c.name}</span>
              <Select value={ed.doc.settings?.modes?.[c.id] ?? c.defaultMode} options={c.modes.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => ed.setMode(c.id, v)} />
            </div>
          ))
        ) : (
          <div className="muted" style={{ lineHeight: 1.55 }}>
            Crie cores e medidas reutilizáveis — com modos como claro e escuro — em <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => ed.openDialog('variables')}>Variáveis</a>.
          </div>
        )}
      </Section>
      <LocalStyles />
      <Section title="Guias" actions={ed.page.guides?.length ? <button className="btn small ghost" onClick={() => ed.setGuides([], 'Remover guias')}>Remover todas</button> : undefined}>
        <div className="muted" style={{ lineHeight: 1.55 }}>
          {ed.page.guides?.length ? `${ed.page.guides.length} guia${ed.page.guides.length === 1 ? '' : 's'} nesta página. ` : ''}
          {ed.settings.rulers ? (
            <>Arraste a partir das réguas para criar guias; arraste de volta para a régua (ou clique na guia e aperte Delete) para apagar.</>
          ) : (
            <>
              <Ruler size={11} style={{ verticalAlign: -1 }} /> Réguas ocultas — <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => ed.setSettings({ rulers: true })}>mostrar (Shift+R)</a>
            </>
          )}
        </div>
      </Section>
      <div className="empty-state" style={{ paddingTop: 24 }}>
        <div className="title">Nada selecionado</div>
        Clique numa camada para ver e editar as propriedades dela.
      </div>
    </>
  );
}

function NodeSections({ nodes }: { nodes: SceneNode[] }) {
  const ed = useEditor('doc', 'selection');
  const ids = nodes.map((n) => n.id);
  const single = nodes.length === 1 ? nodes[0] : null;
  const type = common(nodes.map((n) => n.type));
  const parent = single ? ed.model.index.get(ed.model.index.parentId(single.id)!) : null;
  const parentLayout = !!(parent && 'layout' in parent && parent.layout);
  const containers = nodes.filter((n) => n.type === 'frame' || n.type === 'component' || n.type === 'component-set') as ContainerNode[];
  const frames = nodes.filter((n) => n.type === 'frame' || n.type === 'component') as ContainerNode[];
  const texts = nodes.filter((n) => n.type === 'text') as TextNode[];
  const set = (key: string, merge?: string) => (v: unknown) => ed.setProp(ids, key, v, merge);
  const variantSet = single?.type === 'component' ? ed.setFor(single.id) : undefined;
  const owner = single && single.type !== 'component' && single.type !== 'component-set' ? ed.propertyOwner(single.id) : undefined;

  return (
    <>
      <AlignBar />
      <div className="section" style={{ paddingTop: 12 }}>
        <div className="row">
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: single?.type === 'component' || single?.type === 'instance' ? 'var(--component)' : 'var(--text)' }}>
            {single ? TYPE_NAMES[single.type] : type === MIXED || !type ? `${nodes.length} camadas` : `${nodes.length} × ${TYPE_NAMES[type as string]}`}
          </span>
          <span className="grow" />
          {single && (single.type === 'frame' || single.type === 'group') && (
            <IconBtn icon={<Component size={14} />} tip="Criar componente" onClick={() => ed.wrap('component')} />
          )}
          {nodes.length > 1 && nodes.every((n) => n.type === 'component') && !ed.setFor(nodes[0].id) && (
            <IconBtn icon={<Layers2 size={14} />} tip="Combinar como variantes" onClick={() => ed.combineAsVariants()} />
          )}
          {single?.type === 'component' && !variantSet && <IconBtn icon={<Layers2 size={14} />} tip="Criar variantes a partir deste componente" onClick={() => ed.addVariant(single.id)} />}
        </div>
        {single?.type === 'component-set' && <div className="label" style={{ marginTop: 2 }}>{single.name}</div>}
        {variantSet && <div className="label" style={{ marginTop: 2 }}>Variante de “{variantSet.name}”</div>}
      </div>

      {nodes.length > 1 && <BooleanBar />}
      {single?.type === 'instance' && <InstanceSection inst={single} />}
      {single?.type === 'instance' && <InstanceSlotsSection inst={single} />}
      {single?.type === 'frame' && single.slotOf && <SlotHolderSection holder={single} />}
      {single?.type === 'frame' && !single.slotOf && owner && <SlotSection node={single} />}
      {single?.type === 'component-set' && <VariantSetSection set={single} />}
      {single?.type === 'component-set' && <PropertiesSection owner={single} />}
      {single?.type === 'component' && variantSet && <VariantValuesSection comp={single} set={variantSet} />}
      {single?.type === 'component' && !variantSet && <PropertiesSection owner={single} />}
      {single && owner && <PropertyBindSection node={single} owner={owner} />}
      {single?.type === 'boolean' && <BooleanSection id={single.id} op={single.booleanOp ?? 'union'} />}
      {single && ['path', 'rect', 'ellipse', 'polygon', 'star', 'line'].includes(single.type) && (
        <div className="section" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => ed.enterVectorEdit(single.id)} title="Duplo clique ou Enter num vetor também abrem os pontos"><PenTool size={12} /> Editar pontos</button>
            {single.type !== 'path' && <button className="btn small ghost" onClick={() => ed.flatten([single.id])} title="Ctrl+E"><Spline size={12} /> Converter em vetor</button>}
          </div>
        </div>
      )}
      {single?.type === 'component' && (
        <Section title="Componente">
          <textarea
            key={single.id}
            className="field"
            style={{ width: '100%', height: 54, padding: 6, resize: 'vertical' }}
            placeholder="Descrição para quem usar a biblioteca"
            defaultValue={single.description ?? ''}
            onBlur={(e) => e.target.value !== (single.description ?? '') && ed.setProp([single.id], 'description', e.target.value || undefined)}
          />
        </Section>
      )}

      <Section title="Posição e tamanho">
        <div className="grid2">
          <NumberField lead="X" value={common(nodes.map((n) => n.x))} onChange={(v, o) => ed.setProp(ids, 'x', v, o.merge)} />
          <NumberField lead="Y" value={common(nodes.map((n) => n.y))} onChange={(v, o) => ed.setProp(ids, 'y', v, o.merge)} />
          <NumberField lead="L" title="Largura" min={type === 'line' ? 1 : 0.01} value={common(nodes.map((n) => n.width))} onChange={(v, o) => resize(ed, ids, 'width', v, o.merge)} />
          {type !== 'line' && <NumberField lead="A" title="Altura" min={0.01} value={common(nodes.map((n) => n.height))} onChange={(v, o) => resize(ed, ids, 'height', v, o.merge)} />}
          <NumberField lead={<RotateCw size={11} />} title="Rotação" unit="°" value={common(nodes.map((n) => n.rotation ?? 0))} onChange={(v, o) => ed.setProp(ids, 'rotation', ((((v + 180) % 360) + 360) % 360) - 180 || undefined, o.merge)} />
          {nodes.every((n) => ['frame', 'component', 'rect', 'instance'].includes(n.type)) && <CornerField nodes={nodes} />}
        </div>
        {(parentLayout || containers.some((c) => c.layout) || texts.length > 0) && (
          <div className="grid2" style={{ marginTop: 6 }}>
            <SizingSelect nodes={nodes} axis="horizontal" parentLayout={parentLayout} />
            <SizingSelect nodes={nodes} axis="vertical" parentLayout={parentLayout} />
          </div>
        )}
        {parentLayout && single && (
          <div className="row" style={{ marginTop: 8 }}>
            <Check checked={!!single.absolute} onChange={(v) => ed.setProp(ids, 'absolute', v || undefined)} label="Posição absoluta (ignora o auto layout)" />
          </div>
        )}
        {containers.length === nodes.length && (
          <div className="row" style={{ marginTop: 8 }}>
            <Check checked={common(containers.map((c) => !!c.clip)) === true} onChange={(v) => ed.setProp(ids, 'clip', v || undefined)} label="Cortar conteúdo" />
          </div>
        )}
        {single && parent && !parentLayout && parent.type !== 'group' && <ConstraintsRow n={single} />}
        {nodes.every((n) => n.type === 'polygon' || n.type === 'star') && (
          <div className="grid2" style={{ marginTop: 6 }}>
            <NumberField lead="Nº" title="Pontas" min={3} max={60} value={common((nodes as ShapeNode[]).map((n) => n.points ?? 5))} onChange={(v, o) => ed.setProp(ids, 'points', Math.round(v), o.merge)} />
            {type === 'star' && <NumberField lead="R" title="Raio interno" unit="%" min={1} max={100} value={common((nodes as ShapeNode[]).map((n) => Math.round((n.innerRadius ?? 0.38) * 100)))} onChange={(v, o) => ed.setProp(ids, 'innerRadius', v / 100, o.merge)} />}
          </div>
        )}
      </Section>

      {containers.length === nodes.length && <AutoLayoutSection nodes={containers} />}
      {frames.length === nodes.length && <LayoutGridSection nodes={frames} />}

      <Section title="Aparência">
        <div className="grid2">
          <NumberField lead={<Scan size={11} />} title="Opacidade" unit="%" min={0} max={100} value={common(nodes.map((n) => Math.round((n.opacity ?? 1) * 100)))} onChange={(v, o) => ed.setProp(ids, 'opacity', v >= 100 ? undefined : v / 100, o.merge)} />
          <Select value={common(nodes.map((n) => n.blendMode ?? 'normal'))} options={BLENDS} onChange={(v) => set('blendMode')(v === 'normal' ? undefined : v)} title="Mesclagem" />
        </div>
      </Section>

      {texts.length === nodes.length && <TextSection nodes={texts} />}
      <PaintSection nodes={nodes} kind="fills" />
      <PaintSection nodes={nodes} kind="strokes" />
      <EffectsSection nodes={nodes} />
      <ExportSection />
    </>
  );
}

function resize(ed: ReturnType<typeof useEditor>, ids: string[], key: 'width' | 'height', v: number, merge?: string) {
  ed.setEach(ids, (n) => {
    const patch: Record<string, unknown> = { [key]: v };
    // vetor: o desenho acompanha o novo tamanho
    if (n.type === 'path' && n[key] > 0) patch.d = scalePath(n.d, key === 'width' ? v / n.width : 1, key === 'height' ? v / n.height : 1);
    if (n.type === 'text') {
      const t = n as TextNode;
      if (key === 'width' && t.autoResize === 'width') patch.autoResize = 'height';
      if (key === 'height') patch.autoResize = 'none';
    }
    if (n.sizing) {
      const axis = key === 'width' ? 'horizontal' : 'vertical';
      if (n.sizing[axis] !== 'fixed') patch.sizing = { ...n.sizing, [axis]: 'fixed' };
    }
    return patch;
  }, 'Redimensionar', merge);
}

const BOOLEAN_OPS: { op: BooleanOp; icon: React.ReactNode; tip: string }[] = [
  { op: 'union', icon: <SquaresUnite size={15} />, tip: 'Unir (Ctrl+Alt+U)' },
  { op: 'subtract', icon: <SquaresSubtract size={15} />, tip: 'Subtrair (Ctrl+Alt+S)' },
  { op: 'intersect', icon: <SquaresIntersect size={15} />, tip: 'Interseção (Ctrl+Alt+I)' },
  { op: 'exclude', icon: <SquaresExclude size={15} />, tip: 'Excluir sobreposição (Ctrl+Alt+X)' },
];

/** Botões de operação booleana para várias camadas selecionadas. */
function BooleanBar() {
  const ed = useEditor('selection');
  return (
    <Section title="Operação booleana">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {BOOLEAN_OPS.map((b) => <IconBtn key={b.op} icon={b.icon} tip={b.tip} onClick={() => ed.booleanOperation(b.op)} />)}
      </div>
    </Section>
  );
}

function BooleanSection({ id, op }: { id: string; op: BooleanOp }) {
  const ed = useEditor('doc');
  return (
    <Section title="Operação booleana">
      <div className="row">
        <Seg<BooleanOp> value={op} onChange={(v) => ed.booleanOperation(v)} options={BOOLEAN_OPS.map((b) => ({ value: b.op, label: b.icon, tip: b.tip.split(' (')[0] }))} />
        <span className="grow" />
        <IconBtn icon={<Spline size={14} />} tip="Converter em vetor (Ctrl+E)" onClick={() => ed.flatten([id])} />
      </div>
      <div className="label" style={{ marginTop: 6 }}>As formas continuam editáveis dentro dela (duplo clique ou painel de camadas).</div>
    </Section>
  );
}

function AlignBar() {
  const ed = useEditor('selection');
  const many = ed.selection.length > 1;
  const b = (icon: React.ReactNode, tip: string, fn: () => void, disabled = false) => <IconBtn icon={icon} tip={tip} onClick={fn} disabled={disabled} />;
  return (
    <div className="section" style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between' }}>
      {b(<AlignStartVertical size={15} />, 'Alinhar à esquerda', () => ed.align('left'))}
      {b(<AlignCenterVertical size={15} />, 'Centralizar na horizontal', () => ed.align('hcenter'))}
      {b(<AlignEndVertical size={15} />, 'Alinhar à direita', () => ed.align('right'))}
      {b(<AlignStartHorizontal size={15} />, 'Alinhar ao topo', () => ed.align('top'))}
      {b(<AlignCenterHorizontal size={15} />, 'Centralizar na vertical', () => ed.align('vcenter'))}
      {b(<AlignEndHorizontal size={15} />, 'Alinhar à base', () => ed.align('bottom'))}
      {b(<AlignHorizontalDistributeCenter size={15} />, 'Distribuir na horizontal', () => ed.distribute('h'), ed.selection.length < 3)}
      {b(<AlignVerticalDistributeCenter size={15} />, 'Distribuir na vertical', () => ed.distribute('v'), !many || ed.selection.length < 3)}
    </div>
  );
}

function CornerField({ nodes }: { nodes: SceneNode[] }) {
  const ed = useEditor();
  const [split, setSplit] = useState(nodes.some((n) => Array.isArray(n.cornerRadius)));
  const ids = nodes.map((n) => n.id);
  const r4 = (n: SceneNode): [number, number, number, number] => (Array.isArray(n.cornerRadius) ? n.cornerRadius : [n.cornerRadius ?? 0, n.cornerRadius ?? 0, n.cornerRadius ?? 0, n.cornerRadius ?? 0]);
  if (!split) {
    const v = common(nodes.map((n) => (Array.isArray(n.cornerRadius) ? -1 : n.cornerRadius ?? 0)));
    return (
      <div className="row" style={{ gap: 2 }}>
        <NumberField className="grow" lead="◜" title="Raio dos cantos" min={0} value={v === -1 ? MIXED : v} onChange={(x, o) => ed.setProp(ids, 'cornerRadius', x || undefined, o.merge)} />
        <IconBtn icon={<SquareDashed size={13} />} tip="Cantos independentes" onClick={() => setSplit(true)} />
      </div>
    );
  }
  return (
    <>
      <div className="row" style={{ gap: 2 }}>
        <span className="label grow">Cantos</span>
        <IconBtn on icon={<SquareDashed size={13} />} tip="Raio único" onClick={() => setSplit(false)} />
      </div>
      <div className="grid2" style={{ gridColumn: '1 / -1', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', marginTop: 0 }}>
        {(['◜', '◝', '◞', '◟'] as const).map((lead, i) => (
          <NumberField key={i} lead={lead} min={0} value={common(nodes.map((n) => r4(n)[i]))} onChange={(x, o) => ed.setEach(ids, (n) => {
            const r = r4(n);
            r[i] = x;
            return { cornerRadius: r.every((v) => v === r[0]) ? r[0] || undefined : r };
          }, 'Raio', o.merge)} />
        ))}
      </div>
    </>
  );
}

function SizingSelect({ nodes, axis, parentLayout }: { nodes: SceneNode[]; axis: 'horizontal' | 'vertical'; parentLayout: boolean }) {
  const ed = useEditor();
  const canHug = nodes.every((n) => ((n.type === 'frame' || n.type === 'component' || n.type === 'component-set') && (n as ContainerNode).layout) || n.type === 'text');
  const value = common(nodes.map((n) => {
    if (n.type === 'text') {
      const t = n as TextNode;
      const auto = axis === 'horizontal' ? t.autoResize === 'width' : t.autoResize !== 'none';
      if (t.sizing?.[axis] === 'fill') return 'fill';
      return auto ? 'hug' : 'fixed';
    }
    return n.sizing?.[axis] ?? 'fixed';
  }));
  const ax = axis === 'horizontal' ? 'L' : 'A';
  const opts: { value: SizingMode; label: string }[] = [{ value: 'fixed', label: `${ax} · Fixa` }];
  if (canHug) opts.push({ value: 'hug', label: `${ax} · Abraçar` });
  if (parentLayout) opts.push({ value: 'fill', label: `${ax} · Preencher` });
  return (
    <Select<SizingMode>
      value={value as Maybe<SizingMode>}
      options={opts}
      title={axis === 'horizontal' ? 'Largura' : 'Altura'}
      onChange={(v) =>
        ed.setEach(nodes.map((n) => n.id), (n) => {
          const patch: Record<string, unknown> = { sizing: { horizontal: n.sizing?.horizontal ?? 'fixed', vertical: n.sizing?.vertical ?? 'fixed', [axis]: v } };
          if (n.type === 'text') {
            const t = n as TextNode;
            if (axis === 'horizontal') patch.autoResize = v === 'hug' ? 'width' : t.autoResize === 'width' ? 'height' : t.autoResize;
            else patch.autoResize = v === 'hug' ? (t.autoResize === 'none' ? 'height' : t.autoResize) : v === 'fixed' ? 'none' : t.autoResize;
          }
          return patch;
        }, 'Dimensionamento')
      }
    />
  );
}

function ConstraintsRow({ n }: { n: SceneNode }) {
  const ed = useEditor();
  const c = n.constraints ?? { horizontal: 'left', vertical: 'top' };
  return (
    <div className="grid2" style={{ marginTop: 6 }}>
      <Select
        title="Restrição horizontal"
        value={c.horizontal}
        options={[{ value: 'left', label: '⇤ Esquerda' }, { value: 'right', label: 'Direita ⇥' }, { value: 'left-right', label: '⇤ Esq. e dir. ⇥' }, { value: 'center', label: 'Centro' }, { value: 'scale', label: 'Escala' }]}
        onChange={(v) => ed.setProp([n.id], 'constraints', { ...c, horizontal: v })}
      />
      <Select
        title="Restrição vertical"
        value={c.vertical}
        options={[{ value: 'top', label: '⤒ Topo' }, { value: 'bottom', label: 'Base ⤓' }, { value: 'top-bottom', label: 'Topo e base' }, { value: 'center', label: 'Centro' }, { value: 'scale', label: 'Escala' }]}
        onChange={(v) => ed.setProp([n.id], 'constraints', { ...c, vertical: v })}
      />
    </div>
  );
}

function AutoLayoutSection({ nodes }: { nodes: ContainerNode[] }) {
  const ed = useEditor();
  const ids = nodes.map((n) => n.id);
  const layouts = nodes.map((n) => n.layout).filter(Boolean) as AutoLayout[];
  const has = layouts.length === nodes.length;
  const L = layouts[0];
  const setL = (patch: Partial<AutoLayout>, merge?: string) => ed.setEach(ids, (n) => (n.type === 'frame' || n.type === 'component') && (n as ContainerNode).layout ? { layout: { ...(n as ContainerNode).layout!, ...patch } } : null, 'Auto layout', merge);
  const [padSplit, setPadSplit] = useState(false);
  return (
    <Section
      title="Auto layout"
      empty={!has}
      actions={has ? <IconBtn icon={<Minus size={14} />} tip="Remover auto layout" onClick={() => ed.setProp(ids, 'layout', undefined)} /> : <IconBtn icon={<Plus size={14} />} tip="Adicionar auto layout (Shift+A)" onClick={() => ed.addAutoLayout()} />}
    >
      {has && L && (
        <>
          <div className="row">
            <Seg<string>
              value={L.wrap ? 'wrap' : L.direction}
              options={[
                { value: 'vertical', label: <ArrowDown size={13} />, tip: 'Vertical' },
                { value: 'horizontal', label: <ArrowRight size={13} />, tip: 'Horizontal' },
                { value: 'wrap', label: <WrapText size={13} />, tip: 'Quebrar linha' },
              ]}
              onChange={(v) => setL(v === 'wrap' ? { direction: 'horizontal', wrap: true } : { direction: v as AutoLayout['direction'], wrap: undefined })}
            />
            <span className="grow" />
            <IconBtn on={L.justify === 'space-between'} icon={L.direction === 'horizontal' ? <MoveHorizontal size={14} /> : <MoveVertical size={14} />} tip="Espaçar entre (space-between)" onClick={() => setL({ justify: L.justify === 'space-between' ? 'start' : 'space-between' })} />
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
            <AlignGrid L={L} onChange={setL} />
            <div className="grow" style={{ display: 'grid', gap: 6 }}>
              <NumberField lead={L.direction === 'horizontal' ? <FoldVertical size={11} style={{ transform: 'rotate(90deg)' }} /> : <FoldVertical size={11} />} title="Espaço entre itens" min={0} value={common(layouts.map((l) => l.gap))} onChange={(v, o) => setL({ gap: v }, o.merge)} />
              {L.wrap && <NumberField lead="↕" title="Espaço entre linhas" min={0} value={L.crossGap ?? L.gap} onChange={(v, o) => setL({ crossGap: v }, o.merge)} />}
              {!padSplit ? (
                <>
                  <NumberField lead={<MoveHorizontal size={11} />} title="Margem interna horizontal" min={0} value={L.padding[1] === L.padding[3] ? L.padding[1] : MIXED} onChange={(v, o) => setL({ padding: [L.padding[0], v, L.padding[2], v] }, o.merge)} />
                  <NumberField lead={<MoveVertical size={11} />} title="Margem interna vertical" min={0} value={L.padding[0] === L.padding[2] ? L.padding[0] : MIXED} onChange={(v, o) => setL({ padding: [v, L.padding[1], v, L.padding[3]] }, o.merge)} />
                </>
              ) : (
                <div className="grid2">
                  {(['↑', '→', '↓', '←'] as const).map((lead, i) => (
                    <NumberField key={i} lead={lead} min={0} value={L.padding[i]} onChange={(v, o) => {
                      const p = [...L.padding] as AutoLayout['padding'];
                      p[i] = v;
                      setL({ padding: p }, o.merge);
                    }} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn small ghost" onClick={() => setPadSplit(!padSplit)}>{padSplit ? 'Margens simples' : 'Margens individuais'}</button>
            <span className="grow" />
            {L.direction === 'horizontal' && <Check checked={L.align === 'baseline'} onChange={(v) => setL({ align: v ? 'baseline' : 'start' })} label="Linha de base" />}
          </div>
        </>
      )}
    </Section>
  );
}

function AlignGrid({ L, onChange }: { L: AutoLayout; onChange: (p: Partial<AutoLayout>) => void }) {
  const horiz = L.direction === 'horizontal';
  const pos = ['start', 'center', 'end'] as const;
  const crossOf = (a: AutoLayout['align']) => (a === 'stretch' || a === 'baseline' ? 'start' : a);
  return (
    <div className={`align-grid ${horiz ? '' : 'vertical'}`} title="Alinhamento">
      {pos.map((row) =>
        pos.map((col) => {
          // horizontal: coluna = principal, linha = cruzado; vertical: o contrário
          const main = horiz ? col : row;
          const cross = horiz ? row : col;
          const on = (L.justify === main || (L.justify === 'space-between' && main === 'start')) && crossOf(L.align) === cross;
          return (
            <button key={`${row}-${col}`} className={on ? 'on' : ''} onClick={() => onChange({ justify: L.justify === 'space-between' ? 'space-between' : main, align: cross })} aria-label={`Alinhar ${row} ${col}`}>
              <i />
            </button>
          );
        }),
      )}
    </div>
  );
}

function TextSection({ nodes }: { nodes: TextNode[] }) {
  const ed = useEditor('doc');
  const ids = nodes.map((n) => n.id);
  const st = (k: keyof TextStyle) => common(nodes.map((n) => n.style[k]));
  // mexer à mão em fonte/tamanho solta o estilo de texto (alinhamento não faz parte do estilo)
  const setStyle = (patch: Partial<TextStyle>, merge?: string) =>
    ed.setEach(ids, (n) => {
      const t = n as TextNode;
      const keepsStyle = Object.keys(patch).every((k) => k === 'align' || k === 'verticalAlign');
      const style = { ...t.style, ...patch };
      // o que muda no texto inteiro deixa de ser diferente nos trechos
      const keys = RUN_ATTRS.filter((k) => k in patch);
      const runs = t.runs?.length && keys.length ? clearRunAttr(t.runs, t.text.length, keys, style) : null;
      return { style, ...(runs ? { runs: runs.length ? runs : undefined } : {}), ...(n.styles?.text && !keepsStyle ? detachPatch(n, 'text') : {}) };
    }, 'Texto', merge);
  const textStyle = linkedStyle(ed, nodes, 'text');
  const fonts = ed.host?.fonts;
  const family = st('family');
  const families = useMemo(() => fonts?.sortedFamilies().map((f) => f.family) ?? ['Inter'], [fonts, fonts?.families.size]);
  const faces = typeof family === 'string' ? fonts?.families.get(family)?.faces ?? [] : [];
  const weights = [...new Set(faces.filter((f) => !f.italic).map((f) => f.weight))].sort((a, b) => a - b);
  const WN: Record<number, string> = { 100: 'Fina', 200: 'Extraleve', 300: 'Leve', 350: 'Semileve', 400: 'Regular', 500: 'Média', 600: 'Seminegrito', 700: 'Negrito', 800: 'Extranegrito', 900: 'Black' };
  const missing = typeof family === 'string' && fonts && !fonts.has(family);
  return (
    <Section title="Texto" actions={<StyleButton nodes={nodes} slot="text" />}>
      {textStyle && <StyleRow nodes={nodes} slot="text" style={textStyle} />}
      <div className="row">
        <input
          className="select grow"
          list="zaliel-fonts"
          key={String(family)}
          defaultValue={family === MIXED ? '' : String(family ?? '')}
          placeholder={family === MIXED ? 'Misto' : 'Fonte'}
          style={{ backgroundImage: 'none', paddingRight: 8 }}
          onBlur={(e) => e.target.value && e.target.value !== family && setStyle({ family: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <datalist id="zaliel-fonts">
          {families.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      {missing && <div className="label" style={{ color: 'var(--warn)', marginTop: 4 }}>Fonte não instalada neste computador — exibindo com Inter.</div>}
      <div className="grid2">
        <Select
          value={st('weight') as Maybe<number>}
          options={(weights.length ? weights : [100, 200, 300, 400, 500, 600, 700, 800, 900]).map((w) => ({ value: w, label: WN[w] ?? String(w) }))}
          onChange={(v) => setStyle({ weight: v })}
        />
        <NumberField lead="Aa" title="Tamanho" min={1} value={st('size') as Maybe<number>} onChange={(v, o) => setStyle({ size: v }, o.merge)} />
        <NumberField lead="↕" title="Altura da linha (vazio = automática)" min={0} placeholder="Auto" value={(() => {
          const v = st('lineHeight');
          return v === 'auto' || v === undefined ? undefined : (v as Maybe<number>);
        })()} onChange={(v, o) => setStyle({ lineHeight: v || 'auto' }, o.merge)} />
        <NumberField lead="↔" title="Espaçamento entre letras" step={0.1} value={(st('letterSpacing') ?? 0) as Maybe<number>} onChange={(v, o) => setStyle({ letterSpacing: v }, o.merge)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Seg<string>
          value={(st('align') ?? 'left') as string}
          onChange={(v) => setStyle({ align: v as TextStyle['align'] })}
          options={[
            { value: 'left', label: <AlignLeft size={13} />, tip: 'Esquerda' },
            { value: 'center', label: <AlignCenter size={13} />, tip: 'Centro' },
            { value: 'right', label: <AlignRight size={13} />, tip: 'Direita' },
            { value: 'justify', label: <AlignJustify size={13} />, tip: 'Justificado' },
          ]}
        />
        <Seg<string>
          value={(st('verticalAlign') ?? 'top') as string}
          onChange={(v) => setStyle({ verticalAlign: v as TextStyle['verticalAlign'] })}
          options={[
            { value: 'top', label: <ArrowUpToLine size={13} />, tip: 'Topo' },
            { value: 'middle', label: <FoldVertical size={13} />, tip: 'Meio' },
            { value: 'bottom', label: <ArrowDownToLine size={13} />, tip: 'Base' },
          ]}
        />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <Seg<string>
          value={common(nodes.map((n) => n.autoResize))}
          onChange={(v) => ed.setProp(ids, 'autoResize', v)}
          options={[
            { value: 'width', label: 'Auto', tip: 'Largura automática' },
            { value: 'height', label: 'Altura', tip: 'Largura fixa, altura automática' },
            { value: 'none', label: 'Fixo', tip: 'Tamanho fixo' },
          ]}
        />
        <span className="grow" />
        <IconBtn on={st('italic') === true} icon={<i style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600 }}>I</i>} tip="Itálico" onClick={() => setStyle({ italic: st('italic') === true ? undefined : true })} />
        <IconBtn on={st('decoration') === 'underline'} icon={<Underline size={13} />} tip="Sublinhado" onClick={() => setStyle({ decoration: st('decoration') === 'underline' ? 'none' : 'underline' })} />
        <IconBtn on={st('decoration') === 'strikethrough'} icon={<Strikethrough size={13} />} tip="Tachado" onClick={() => setStyle({ decoration: st('decoration') === 'strikethrough' ? 'none' : 'strikethrough' })} />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <Select
          className="grow"
          value={(st('case') ?? 'none') as Maybe<string>}
          options={[{ value: 'none', label: 'Como digitado' }, { value: 'upper', label: 'MAIÚSCULAS' }, { value: 'lower', label: 'minúsculas' }, { value: 'title', label: 'Iniciais Maiúsculas' }]}
          onChange={(v) => setStyle({ case: v === 'none' ? undefined : (v as TextStyle['case']) })}
        />
      </div>
      {nodes.every((n) => n.textPath) && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="label" style={{ width: 70, flex: 'none' }}>No caminho</span>
            <NumberField
              className="grow"
              lead="⇥"
              title="Onde o texto começa (% do caminho)"
              unit="%"
              min={0}
              max={100}
              value={common(nodes.map((n) => n.textPath?.start ?? 0)) as Maybe<number>}
              onChange={(v, o) => ed.setEach(ids, (n) => ({ textPath: { ...(n as TextNode).textPath!, start: Math.max(0, Math.min(100, v)) } }), 'Texto no caminho', o.merge)}
            />
            <IconBtn on={nodes.every((n) => n.textPath?.flip)} icon={<FlipVertical2 size={13} />} tip="Letras do outro lado do caminho" onClick={() => ed.setEach(ids, (n) => ({ textPath: { ...(n as TextNode).textPath!, flip: !(n as TextNode).textPath!.flip || undefined } }), 'Texto no caminho')} />
          </div>
          <button className="btn small ghost" style={{ marginTop: 6 }} onClick={() => ed.releaseTextPath()}>Soltar do caminho</button>
        </>
      )}
    </Section>
  );
}

function PaintSection({ nodes, kind }: { nodes: SceneNode[]; kind: 'fills' | 'strokes' }) {
  const ed = useEditor('doc');
  const ids = nodes.map((n) => n.id);
  const [open, setOpen] = useState<{ i: number; rect: DOMRect } | null>(null);
  const lists = nodes.map((n) => (kind === 'fills' ? n.fills ?? [] : n.strokes ?? []));
  const same = common(lists.map((l) => JSON.stringify(l))) !== MIXED;
  const list = same ? (lists[0] as (Paint | Stroke)[]) : [];
  const title = kind === 'fills' ? 'Preenchimento' : 'Contorno';
  const update = (fn: (l: (Paint | Stroke)[]) => (Paint | Stroke)[], merge?: string) => ed.setPaints(ids, kind, (l) => fn(l as (Paint | Stroke)[]), merge);
  const add = () =>
    update((l) => [
      ...(same ? l : []),
      kind === 'fills' ? ({ type: 'solid', color: l.length ? '#1d1c1a' : nodes[0].type === 'text' ? '#1d1c1a' : '#d9d4ca' } as Paint) : ({ paint: { type: 'solid', color: '#1d1c1a' }, width: 1, align: nodes.every((n) => n.type === 'line' || n.type === 'path') ? 'center' : 'inside' } as Stroke),
    ]);
  const paintOf = (x: Paint | Stroke): Paint => (kind === 'fills' ? (x as Paint) : (x as Stroke).paint);
  const withPaint = (x: Paint | Stroke, p: Paint): Paint | Stroke => (kind === 'fills' ? p : { ...(x as Stroke), paint: p });
  const slot = kind === 'fills' ? 'fill' : 'stroke';
  const style = linkedStyle(ed, nodes, slot);
  // espessura por lado só existe em caixas (frame, retângulo, componente, instância)
  const boxes = kind === 'strokes' && nodes.every(acceptsStrokeSides);

  return (
    <Section
      title={title}
      empty={same && !list.length && !style}
      actions={
        <>
          {(same && list.length > 0) || style ? <StyleButton nodes={nodes} slot={slot} /> : null}
          <IconBtn icon={<Plus size={14} />} tip={`Adicionar ${title.toLowerCase()}`} onClick={add} />
        </>
      }
    >
      {style && <StyleRow nodes={nodes} slot={slot} style={style} />}
      {!same && (
        <div className="row">
          <span className="muted grow">Vários valores</span>
          <button className="btn small" onClick={() => update(() => clone(lists[0]) as (Paint | Stroke)[])}>Unificar</button>
        </div>
      )}
      {[...list].map((x, i) => {
        const p = paintOf(x);
        // com estilo de cor ligado, só os detalhes do contorno ficam editáveis aqui
        if (style && kind === 'fills') return null;
        const hidden = p.visible === false || (kind === 'strokes' && (x as Stroke).visible === false);
        const label = p.type === 'solid' ? (p.variable ? findVariable(ed.doc, p.variable)?.variable.name ?? 'variável' : p.color.slice(1, 7).toUpperCase()) : p.type === 'image' ? 'Imagem' : p.type === 'linear' ? 'Linear' : p.type === 'radial' ? 'Radial' : 'Angular';
        return (
          <div key={i}>
            {!(style && kind === 'strokes') && <div className={`paint-row ${hidden ? 'hidden' : ''}`}>
              <div className="field">
                <span className="lead">
                  <button className="swatch" onClick={(e) => setOpen({ i, rect: e.currentTarget.getBoundingClientRect() })} aria-label="Editar cor">
                    <i style={{ background: paintCss(p, ed.doc) }} />
                  </button>
                </span>
                {p.type === 'solid' && !p.variable ? (
                  <input
                    key={p.color}
                    defaultValue={label}
                    onBlur={(e) => {
                      const v = e.target.value.replace('#', '').trim();
                      if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
                        const hex = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
                        update((l) => l.map((y, j) => (j === i ? withPaint(y, { ...p, color: `#${hex.toLowerCase()}${p.color.slice(7)}` }) : y)));
                      } else e.target.value = label;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="grow" style={{ paddingLeft: 2, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={(e) => setOpen({ i, rect: e.currentTarget.getBoundingClientRect() })}>
                    {p.type === 'solid' && p.variable ? <span className="var-chip"><Variable size={10} /> {label}</span> : label}
                  </span>
                )}
                <span style={{ width: 60, flex: 'none', borderLeft: '1px solid var(--line)', height: '100%', display: 'flex' }}>
                  <NumberField className="seamless" value={Math.round((p.opacity ?? 1) * 100)} unit="%" min={0} max={100} onChange={(v, o) => update((l) => l.map((y, j) => (j === i ? withPaint(y, { ...p, opacity: v >= 100 ? undefined : v / 100 }) : y)), o.merge)} />
                </span>
              </div>
              <IconBtn icon={hidden ? <EyeOff size={13} /> : <Eye size={13} />} tip={hidden ? 'Mostrar' : 'Ocultar'} onClick={() => update((l) => l.map((y, j) => (j === i ? withPaint(y, { ...p, visible: hidden ? undefined : false }) : y)))} />
              <IconBtn icon={<Minus size={13} />} tip="Remover" onClick={() => update((l) => l.filter((_, j) => j !== i))} />
            </div>}
            {kind === 'strokes' && (
              <div className="grid2" style={{ marginTop: 4, marginBottom: 6 }}>
                <NumberField lead="≡" title="Espessura" min={0} value={(x as Stroke).width} onChange={(v, o) => update((l) => l.map((y, j) => (j === i ? withWidth(y as Stroke, v) : y)), o.merge)} />
                <Select
                  value={(x as Stroke).align}
                  options={[{ value: 'inside', label: 'Por dentro' }, { value: 'center', label: 'Centralizado' }, { value: 'outside', label: 'Por fora' }]}
                  onChange={(v) => update((l) => l.map((y, j) => (j === i ? { ...(y as Stroke), align: v as Stroke['align'] } : y)))}
                />
                <Select
                  value={(x as Stroke).dash?.length ? 'dash' : 'solid'}
                  options={[{ value: 'solid', label: 'Contínuo' }, { value: 'dash', label: 'Tracejado' }]}
                  onChange={(v) => update((l) => l.map((y, j) => (j === i ? { ...(y as Stroke), dash: v === 'dash' ? [4, 4] : undefined } : y)))}
                />
                <Select
                  value={(x as Stroke).cap ?? 'butt'}
                  options={[{ value: 'butt', label: 'Ponta reta' }, { value: 'round', label: 'Ponta redonda' }, { value: 'square', label: 'Ponta quadrada' }]}
                  onChange={(v) => update((l) => l.map((y, j) => (j === i ? { ...(y as Stroke), cap: v === 'butt' ? undefined : (v as Stroke['cap']) } : y)))}
                />
                {boxes && (
                  <Select
                    value={sidesMode(x as Stroke)}
                    options={SIDE_MODES}
                    onChange={(v) => update((l) => l.map((y, j) => (j === i ? withSidesMode(y as Stroke, v as SidesMode) : y)))}
                  />
                )}
              </div>
            )}
            {kind === 'strokes' && boxes && sidesMode(x as Stroke) === 'custom' && (
              <div className="grid2" style={{ marginTop: -2, marginBottom: 6 }}>
                {SIDE_FIELDS.map(([side, lead, tip]) => (
                  <NumberField
                    key={side}
                    lead={lead}
                    title={tip}
                    min={0}
                    value={(x as Stroke).sides?.[side] ?? (x as Stroke).width}
                    onChange={(v, o) => update((l) => l.map((y, j) => (j === i ? withSide(y as Stroke, side, v) : y)), o.merge)}
                  />
                ))}
              </div>
            )}
            {open?.i === i && (
              <PaintPicker anchor={open.rect} paint={p} allowImage={kind === 'fills'} onClose={() => setOpen(null)} onChange={(np, merge) => update((l) => l.map((y, j) => (j === i ? withPaint(y, np) : y)), merge)} />
            )}
          </div>
        );
      })}
    </Section>
  );
}

type SidesMode = 'all' | keyof StrokeSides | 'custom';
const SIDE_MODES: { value: SidesMode; label: string }[] = [
  { value: 'all', label: 'Todos os lados' },
  { value: 'top', label: 'Só em cima' },
  { value: 'bottom', label: 'Só embaixo' },
  { value: 'left', label: 'Só à esquerda' },
  { value: 'right', label: 'Só à direita' },
  { value: 'custom', label: 'Personalizado' },
];
const SIDE_FIELDS: [keyof StrokeSides, string, string][] = [
  ['top', '↑', 'Espessura em cima'],
  ['bottom', '↓', 'Espessura embaixo'],
  ['left', '←', 'Espessura à esquerda'],
  ['right', '→', 'Espessura à direita'],
];
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

/** Como os lados do contorno aparecem no seletor: todos, um lado só ou personalizado. */
function sidesMode(s: Stroke): SidesMode {
  // "sides" gravado com os 4 lados iguais continua como personalizado (é o que o usuário escolheu editar)
  const d = s.sides;
  if (!d) return 'all';
  const on = SIDE_NAMES.filter((k) => d[k] > 0);
  return on.length === 1 && d[on[0]] === s.width ? on[0] : 'custom';
}

function withSidesMode(s: Stroke, mode: SidesMode): Stroke {
  const { sides, ...rest } = s;
  const w = s.width || 1;
  if (mode === 'all') return { ...rest, width: w };
  if (mode === 'custom') return { ...rest, width: w, sides: sides ? { ...sides } : { top: w, right: w, bottom: w, left: w } };
  return { ...rest, width: w, sides: { top: 0, right: 0, bottom: 0, left: 0, [mode]: w } };
}

/** Espessura geral: com lados, os lados que têm contorno acompanham. */
function withWidth(s: Stroke, v: number): Stroke {
  if (!s.sides) return { ...s, width: v };
  const d = s.sides;
  return { ...s, width: v, sides: { top: d.top ? v : 0, right: d.right ? v : 0, bottom: d.bottom ? v : 0, left: d.left ? v : 0 } };
}

function withSide(s: Stroke, side: keyof StrokeSides, v: number): Stroke {
  const d = s.sides ?? { top: s.width, right: s.width, bottom: s.width, left: s.width };
  const sides = { ...d, [side]: v };
  return { ...s, width: Math.max(sides.top, sides.right, sides.bottom, sides.left), sides };
}

const EFFECT_NAMES: Record<Effect['type'], string> = { 'drop-shadow': 'Sombra externa', 'inner-shadow': 'Sombra interna', 'layer-blur': 'Desfoque da camada', 'background-blur': 'Desfoque do fundo' };

function EffectsSection({ nodes }: { nodes: SceneNode[] }) {
  const ed = useEditor('doc');
  const ids = nodes.map((n) => n.id);
  const lists = nodes.map((n) => n.effects ?? []);
  const same = common(lists.map((l) => JSON.stringify(l))) !== MIXED;
  const list = same ? lists[0] : [];
  const [color, setColor] = useState<{ i: number; rect: DOMRect } | null>(null);
  const update = (fn: (l: Effect[]) => Effect[], merge?: string) => ed.setEach(ids, (n) => ({ effects: fn(clone(n.effects ?? [])), ...(n.styles?.effect ? detachPatch(n, 'effect') : {}) }), 'Efeitos', merge);
  const add = () => update((l) => [...(same ? l : []), { type: 'drop-shadow', color: '#00000040', x: 0, y: 4, blur: 12 }]);
  const style = linkedStyle(ed, nodes, 'effect');
  return (
    <Section
      title="Efeitos"
      empty={same && !list.length}
      actions={
        <>
          {same && (list.length > 0 || style) ? <StyleButton nodes={nodes} slot="effect" /> : null}
          <IconBtn icon={<Plus size={14} />} tip="Adicionar efeito" onClick={add} />
        </>
      }
    >
      {style && <StyleRow nodes={nodes} slot="effect" style={style} />}
      {!same && <div className="muted">Vários valores</div>}
      {!style && list.map((fx, i) => {
        const set = (patch: Partial<Effect>, merge?: string) => update((l) => l.map((e, j) => (j === i ? ({ ...e, ...patch } as Effect) : e)), merge);
        const hidden = fx.visible === false;
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div className="row">
              <Select<Effect['type']>
                className="grow"
                value={fx.type}
                options={Object.entries(EFFECT_NAMES).map(([value, label]) => ({ value: value as Effect['type'], label }))}
                onChange={(t) =>
                  update((l) => l.map((e, j) => (j === i ? (t === 'drop-shadow' || t === 'inner-shadow' ? { type: t, color: 'color' in e ? e.color : '#00000040', x: 'x' in e ? e.x : 0, y: 'y' in e ? e.y : 4, blur: 'blur' in e ? e.blur : 12 } : { type: t, radius: 'radius' in e ? e.radius : 8 }) : e)))
                }
              />
              <IconBtn icon={hidden ? <EyeOff size={13} /> : <Eye size={13} />} tip={hidden ? 'Mostrar' : 'Ocultar'} onClick={() => set({ visible: hidden ? undefined : false })} />
              <IconBtn icon={<Minus size={13} />} tip="Remover" onClick={() => update((l) => l.filter((_, j) => j !== i))} />
            </div>
            {fx.type === 'drop-shadow' || fx.type === 'inner-shadow' ? (
              <div className="grid2" style={{ marginTop: 6 }}>
                <NumberField lead="X" value={fx.x} onChange={(v, o) => set({ x: v }, o.merge)} />
                <NumberField lead="Y" value={fx.y} onChange={(v, o) => set({ y: v }, o.merge)} />
                <NumberField lead="◌" title="Desfoque" min={0} value={fx.blur} onChange={(v, o) => set({ blur: v }, o.merge)} />
                {fx.type === 'drop-shadow' ? <NumberField lead="⊕" title="Espalhamento" value={fx.spread ?? 0} onChange={(v, o) => set({ spread: v || undefined }, o.merge)} /> : <span />}
                <label className="field" style={{ gridColumn: '1 / -1' }}>
                  <span className="lead">
                    <button className="swatch" onClick={(e) => setColor({ i, rect: e.currentTarget.getBoundingClientRect() })} aria-label="Cor da sombra">
                      <i style={{ background: paintCss({ type: 'solid', color: fx.color }) }} />
                    </button>
                  </span>
                  <span className="grow">{fx.color.toUpperCase()}</span>
                </label>
                {color?.i === i && (
                  <PaintPicker anchor={color.rect} allowImage={false} paint={{ type: 'solid', color: fx.color }} onClose={() => setColor(null)} onChange={(p, merge) => p.type === 'solid' && set({ color: p.color }, merge)} />
                )}
              </div>
            ) : (
              <div className="grid2" style={{ marginTop: 6 }}>
                <NumberField lead="◌" title="Intensidade" min={0} value={(fx as { radius: number }).radius} onChange={(v, o) => set({ radius: v } as Partial<Effect>, o.merge)} />
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function ExportSection() {
  const ed = useEditor('selection');
  const [scale, setScale] = useState(2);
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp' | 'svg' | 'pdf'>('png');
  return (
    <Section title="Exportar" collapsible defaultOpen={false}>
      <div className="grid2">
        <Select value={scale} options={[0.5, 1, 1.5, 2, 3, 4].map((s) => ({ value: s, label: `${s}×` }))} onChange={setScale} />
        <Select value={format} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }, { value: 'pdf', label: 'PDF' }]} onChange={setFormat} />
      </div>
      <button className="btn block" style={{ marginTop: 8 }} onClick={() => ed.exportSelection(format, scale)}>
        <Download size={13} /> Exportar {ed.selection.length > 1 ? `${ed.selection.length} camadas` : 'seleção'}
      </button>
      {format === 'pdf' && <div className="label" style={{ marginTop: 6 }}>Uma página por camada, no tamanho dela. A escala define a nitidez.</div>}
    </Section>
  );
}

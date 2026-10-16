// Grades de layout de frames: colunas, linhas e grade quadrada.
import { useState } from 'react';
import { Plus, Minus, Eye, EyeOff, Columns3, Rows3, Grid3x3 } from 'lucide-react';
import { clone, defaultGrid, type ContainerNode, type LayoutGrid } from '@zaliel/core';
import { useEditor } from './hooks';
import { IconBtn, NumberField, Section, Select, common, MIXED } from './controls';
import { PaintPicker, paintCss } from './ColorPicker';

const TYPE_ICON: Record<LayoutGrid['type'], React.ReactNode> = { columns: <Columns3 size={13} />, rows: <Rows3 size={13} />, grid: <Grid3x3 size={13} /> };

export function LayoutGridSection({ nodes }: { nodes: ContainerNode[] }) {
  const ed = useEditor('doc', 'ui');
  const ids = nodes.map((n) => n.id);
  const lists = nodes.map((n) => n.grids ?? []);
  const same = common(lists.map((l) => JSON.stringify(l))) !== MIXED;
  const list = same ? lists[0] : [];
  const [color, setColor] = useState<{ i: number; rect: DOMRect } | null>(null);
  const update = (fn: (l: LayoutGrid[]) => LayoutGrid[], merge?: string) =>
    ed.setEach(ids, (n) => {
      const next = fn(clone((n as ContainerNode).grids ?? []));
      return { grids: next.length ? next : undefined };
    }, 'Grade de layout', merge);
  const add = () => update((l) => [...(same ? l : []), defaultGrid(l.length ? 'rows' : 'columns')]);
  return (
    <Section title="Grade de layout" empty={same && !list.length} actions={<IconBtn icon={<Plus size={14} />} tip="Adicionar grade" onClick={add} />}>
      {!same && <div className="muted">Vários valores</div>}
      {!ed.settings.layoutGrids && list.length > 0 && (
        <div className="label" style={{ color: 'var(--warn)', marginBottom: 6 }}>
          As grades estão ocultas. <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => ed.setSettings({ layoutGrids: true })}>Mostrar</a>
        </div>
      )}
      {list.map((g, i) => {
        const set = (patch: Partial<LayoutGrid>, merge?: string) => update((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)), merge);
        const hidden = g.visible === false;
        const fixed = g.type === 'grid' || g.alignment !== 'stretch';
        return (
          <div key={i} style={{ marginBottom: 10 }}>
            <div className="row">
              <span className="prop-kind">{TYPE_ICON[g.type]}</span>
              <Select<LayoutGrid['type']>
                className="grow"
                value={g.type}
                options={[{ value: 'columns', label: 'Colunas' }, { value: 'rows', label: 'Linhas' }, { value: 'grid', label: 'Grade' }]}
                onChange={(t) => update((l) => l.map((x, j) => (j === i ? { ...defaultGrid(t), color: x.color, visible: x.visible } : x)))}
              />
              <button className="swatch" onClick={(e) => setColor({ i, rect: e.currentTarget.getBoundingClientRect() })} aria-label="Cor da grade" style={{ flex: 'none' }}>
                <i style={{ background: paintCss({ type: 'solid', color: g.color }) }} />
              </button>
              <IconBtn icon={hidden ? <EyeOff size={13} /> : <Eye size={13} />} tip={hidden ? 'Mostrar' : 'Ocultar'} onClick={() => set({ visible: hidden ? undefined : false })} />
              <IconBtn icon={<Minus size={13} />} tip="Remover" onClick={() => update((l) => l.filter((_, j) => j !== i))} />
            </div>
            <div className="grid2" style={{ marginTop: 6 }}>
              {g.type !== 'grid' && <NumberField lead="Nº" title={g.type === 'columns' ? 'Colunas' : 'Linhas'} min={1} max={200} value={g.count} onChange={(v, o) => set({ count: Math.round(v) }, o.merge)} />}
              {fixed && <NumberField lead="▭" title={g.type === 'grid' ? 'Tamanho da célula' : 'Largura de cada uma'} min={1} value={g.size} onChange={(v, o) => set({ size: v }, o.merge)} />}
              {g.type !== 'grid' && <NumberField lead="↔" title="Espaço entre (gutter)" min={0} value={g.gutter} onChange={(v, o) => set({ gutter: v }, o.merge)} />}
              {g.type !== 'grid' && <NumberField lead="⇤" title="Margem" min={0} value={g.margin} onChange={(v, o) => set({ margin: v }, o.merge)} />}
              {g.type !== 'grid' && (
                <Select<LayoutGrid['alignment']>
                  value={g.alignment}
                  title="Alinhamento"
                  options={[{ value: 'stretch', label: 'Esticar' }, { value: 'start', label: g.type === 'columns' ? 'Esquerda' : 'Topo' }, { value: 'center', label: 'Centro' }, { value: 'end', label: g.type === 'columns' ? 'Direita' : 'Base' }]}
                  onChange={(v) => set({ alignment: v })}
                />
              )}
            </div>
            {color?.i === i && (
              <PaintPicker anchor={color.rect} allowImage={false} paint={{ type: 'solid', color: g.color }} onClose={() => setColor(null)} onChange={(p, merge) => p.type === 'solid' && set({ color: p.color }, merge)} />
            )}
          </div>
        );
      })}
    </Section>
  );
}

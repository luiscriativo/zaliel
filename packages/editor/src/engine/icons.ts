// Ícones de bibliotecas de ícones como vetores, para a importação. Os desenhos do
// Lucide já vêm no aplicativo (o mesmo pacote dos ícones da interface): cada ícone é
// desenhado como SVG estático e convertido em caminho. Nada é baixado.
import { svgShapeToPath, type IconShape } from '@zaliel/core';
import { loadChunk } from '../chunks';

const pascal = (s: string) => s.replace(/(^|[-_\s]+)([a-z0-9])/gi, (_m, _p, c: string) => c.toUpperCase());

/** Prepara os ícones usados num arquivo e devolve quem desenha cada um. */
export async function loadIconShapes(list: { library: string; name: string }[]): Promise<(library: string, name: string) => IconShape | null> {
  const shapes = new Map<string, IconShape>();
  const lucide = list.filter((i) => /lucide/i.test(i.library));
  if (lucide.length) {
    const [mod, server, react] = await loadChunk(() => Promise.all([import('lucide-react'), import('react-dom/server'), import('react')]));
    const all = mod as unknown as Record<string, unknown>;
    const icons = (mod as unknown as { icons: Record<string, unknown> }).icons;
    const parser = new DOMParser();
    for (const it of lucide) {
      if (shapes.has(it.name)) continue;
      const comp = all[pascal(it.name)] ?? icons[pascal(it.name)] ?? all[`${pascal(it.name)}Icon`];
      if (!comp) continue;
      const svg = server.renderToStaticMarkup(react.createElement(comp as React.ComponentType<{ size: number }>, { size: 24 }));
      const el = parser.parseFromString(svg, 'image/svg+xml').documentElement;
      const parts: string[] = [];
      for (const child of Array.from(el.children)) {
        const attrs: Record<string, string> = {};
        for (const a of Array.from(child.attributes)) attrs[a.name] = a.value;
        const d = svgShapeToPath(child.tagName.toLowerCase(), attrs);
        // cada <path> começa do zero: um "m" minúsculo no início seria relativo ao fim do anterior
        if (d) parts.push(/^\s*m/.test(d) ? `M0 0 ${d}` : d);
      }
      if (parts.length) shapes.set(it.name, { d: parts.join(' '), size: 24, stroke: true, strokeWidth: 2 });
    }
  }
  // overrides de ícone às vezes não repetem a biblioteca: o nome basta para o Lucide
  return (library, name) => (/lucide/i.test(library) ? shapes.get(name) ?? null : null);
}

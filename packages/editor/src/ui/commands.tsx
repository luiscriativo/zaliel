// Comandos do editor: um lugar só para menus, atalhos de teclado e menu de contexto.
import type { ReactNode } from 'react';
import {
  Copy, Scissors, Clipboard, CopyPlus, Trash2, Group, Ungroup, Frame, Component, Unlink, Rows3, Eye, Lock,
  FilePlus, FolderOpen, Save, ImagePlus, Download, ZoomIn, ZoomOut, Maximize2, Scan, Keyboard, Info, RefreshCw, Settings, Undo2, Redo2, Grid3x3, Magnet, Variable, AppWindow, X,
  FileInput, History, Search, MessageCircle, Image as ImageIcon, Code, LayoutTemplate, PencilLine, FolderDown, FlipHorizontal2, FlipVertical2, SquaresUnite, SquaresSubtract, SquaresIntersect, SquaresExclude, PenTool, Spline, Ruler, LayoutGrid, Play, FileText, Layers2, SquarePlus,
} from 'lucide-react';
import type { Editor, Tool } from '../editor';
import { isMac } from './hooks';

export interface Command {
  id: string;
  label: string;
  keys?: string[]; // combinações: "Mod+Shift+G", "Delete", "Shift+0"
  icon?: ReactNode;
  run: (ed: Editor) => void;
  enabled?: (ed: Editor) => boolean;
  checked?: (ed: Editor) => boolean;
  /** Rótulo que depende da seleção (ex.: "Ocultar" ou "Mostrar"). */
  labelFor?: (ed: Editor) => string;
}

// camadas de verdade (não as de dentro de instâncias, que não dá para agrupar, mover etc.)
const hasSel = (ed: Editor) => ed.selectedNodes().length > 0;
const one = (ed: Editor) => ed.selection.length === 1 && ed.selectedNodes().length === 1;
const canUngroup = (ed: Editor) => ed.selectedNodes().some((n) => n.type === 'group' || n.type === 'frame' || n.type === 'boolean');
const canComponent = (ed: Editor) => hasSel(ed) && ed.selectedNodes().every((n) => n.type !== 'component' && n.type !== 'component-set');
const hasLayout = (ed: Editor) => ed.selectedNodes().some((n) => 'layout' in n && !!n.layout);
const hasParent = (ed: Editor) => one(ed) && ed.model.index.parentId(ed.selection[0]) !== ed.pageId;
/** A seleção pode subir (ou descer) na ordem das camadas? */
const canMove = (dir: 1 | -1) => (ed: Editor) =>
  ed.selectedNodes().some((n) => {
    const list = ed.model.index.siblings(ed.model.index.parentId(n.id) ?? '') ?? [];
    const i = list.findIndex((s) => s.id === n.id);
    return dir > 0 ? i < list.length - 1 : i > 0;
  });
const allHidden = (ed: Editor) => ed.selectedNodes().every((n) => n.visible === false);
const allLocked = (ed: Editor) => ed.selectedNodes().every((n) => n.locked);
// converter em vetor: só faz sentido se houver alguma forma que ainda não é vetor
// converter em vetor: formas e textos (o texto vira o contorno das letras)
const canFlatten = (ed: Editor) => {
  const sel = ed.selectedNodes();
  return sel.length > 0 && unlocked(ed) && sel.every((n) => shapes.includes(n.type) || n.type === 'text') && (sel.length > 1 || sel[0].type !== 'path');
};
const hasKids = (ed: Editor) => ed.selectedNodes().some((n) => 'children' in n && n.type !== 'boolean' && n.children.length > 0);
const isInst = (ed: Editor) => ed.selectedNodes().some((n) => n.type === 'instance');
const doc = (ed: Editor) => !ed.home;
const shapes = ['rect', 'ellipse', 'polygon', 'star', 'line', 'path', 'boolean'];
const isShape = (ed: Editor) => ed.selection.length > 0 && ed.selectedNodes().every((n) => shapes.includes(n.type));
// operações booleanas: duas ou mais formas (ou trocar a operação de uma booleana que já existe)
const canBool = (ed: Editor) => (ed.selectedNodes().length > 1 && isShape(ed)) || (one(ed) && ed.selectedNodes()[0]?.type === 'boolean');
const unlocked = (ed: Editor) => ed.selectedNodes().every((n) => !n.locked);
// combinar: dois ou mais componentes soltos (com um só, o caminho é "Adicionar variante")
const allComponents = (ed: Editor) => ed.selectedNodes().length > 1 && ed.selectedNodes().every((n) => n.type === 'component') && !ed.setFor(ed.selection[0]);
const variantTarget = (ed: Editor) => one(ed) && ['component', 'component-set'].includes(ed.selectedNodes()[0]?.type ?? '');

export const COMMANDS: Command[] = [
  // Arquivo
  { id: 'file.new', label: 'Novo arquivo', keys: ['Mod+N'], icon: <FilePlus size={14} />, run: (ed) => ed.newDocument() },
  { id: 'file.newWindow', label: 'Nova janela', keys: ['Mod+Shift+N'], icon: <AppWindow size={14} />, run: (ed) => ed.platform.newWindow() },
  { id: 'file.open', label: 'Abrir…', keys: ['Mod+O'], icon: <FolderOpen size={14} />, run: (ed) => ed.open() },
  { id: 'file.importDesign', label: 'Importar arquivo…', keys: ['Mod+Alt+O'], icon: <FileInput size={14} />, run: (ed) => ed.importDesign() },
  { id: 'file.save', label: 'Salvar', keys: ['Mod+S'], icon: <Save size={14} />, run: (ed) => ed.save(), enabled: doc },
  { id: 'file.saveAs', label: 'Salvar como…', keys: ['Mod+Shift+S'], run: (ed) => ed.save(true), enabled: doc },
  { id: 'file.import', label: 'Importar imagens…', keys: ['Mod+Shift+K'], icon: <ImagePlus size={14} />, run: (ed) => ed.importImages(), enabled: doc },
  { id: 'file.exportPng', label: 'Exportar seleção como PNG (2×)', keys: ['Mod+Shift+E'], icon: <Download size={14} />, run: (ed) => ed.exportSelection('png', 2), enabled: hasSel },
  { id: 'file.exportSvg', label: 'Exportar seleção como SVG', run: (ed) => ed.exportSelection('svg'), enabled: hasSel },
  { id: 'file.exportBatch', label: 'Exportar várias telas…', keys: ['Mod+Shift+Alt+E'], icon: <FolderDown size={14} />, run: (ed) => ed.openDialog('exportBatch'), enabled: doc },
  { id: 'file.exportPdf', label: 'Exportar frames da página em PDF…', icon: <FileText size={14} />, run: (ed) => ed.exportPdf(), enabled: doc },
  { id: 'file.saveVersion', label: 'Histórico de versões…', keys: ['Mod+Alt+H'], icon: <History size={14} />, run: (ed) => ed.openDialog('versions'), enabled: doc },
  { id: 'file.autoSave', label: 'Salvar automaticamente', run: (ed) => ed.setSettings({ autoSave: !ed.settings.autoSave }), checked: (ed) => ed.settings.autoSave },
  { id: 'file.close', label: 'Fechar aba', keys: ['Mod+W'], icon: <X size={14} />, run: (ed) => ed.closeDocument(), enabled: doc },

  // Editar
  { id: 'edit.undo', label: 'Desfazer', keys: ['Mod+Z'], icon: <Undo2 size={14} />, run: (ed) => ed.undo(), enabled: (ed) => doc(ed) && ed.model.past.length > 0 },
  { id: 'edit.redo', label: 'Refazer', keys: ['Mod+Shift+Z', 'Mod+Y'], icon: <Redo2 size={14} />, run: (ed) => ed.redo(), enabled: (ed) => doc(ed) && ed.model.future.length > 0 },
  { id: 'edit.cut', label: 'Recortar', keys: ['Mod+X'], icon: <Scissors size={14} />, run: (ed) => ed.copy(true), enabled: hasSel },
  { id: 'edit.copy', label: 'Copiar', keys: ['Mod+C'], icon: <Copy size={14} />, run: (ed) => ed.copy(), enabled: hasSel },
  { id: 'edit.paste', label: 'Colar', keys: ['Mod+V'], icon: <Clipboard size={14} />, run: (ed) => ed.paste(), enabled: doc },
  { id: 'edit.copyPng', label: 'Copiar como PNG', keys: ['Mod+Shift+C'], icon: <ImageIcon size={14} />, run: (ed) => ed.copyAs('png'), enabled: one },
  { id: 'edit.copySvg', label: 'Copiar como SVG', icon: <Code size={14} />, run: (ed) => ed.copyAs('svg'), enabled: one },
  { id: 'edit.duplicate', label: 'Duplicar', keys: ['Mod+D'], icon: <CopyPlus size={14} />, run: (ed) => ed.duplicate(10), enabled: hasSel },
  { id: 'edit.delete', label: 'Excluir', keys: ['Delete', 'Backspace'], icon: <Trash2 size={14} />, run: (ed) => ed.deleteSelection(), enabled: hasSel },
  { id: 'edit.find', label: 'Localizar e substituir…', keys: ['Mod+F'], icon: <Search size={14} />, run: (ed) => ed.openDialog('find'), enabled: doc },
  { id: 'edit.selectAll', label: 'Selecionar tudo', keys: ['Mod+A'], run: (ed) => ed.selectAll(), enabled: doc },

  // Objeto
  { id: 'obj.group', label: 'Agrupar', keys: ['Mod+G'], icon: <Group size={14} />, run: (ed) => ed.wrap('group'), enabled: hasSel },
  { id: 'obj.ungroup', label: 'Desagrupar', keys: ['Mod+Shift+G'], icon: <Ungroup size={14} />, run: (ed) => ed.ungroup(), enabled: canUngroup },
  { id: 'obj.frame', label: 'Colocar em frame', keys: ['Mod+Alt+G'], icon: <Frame size={14} />, run: (ed) => ed.wrap('frame'), enabled: hasSel },
  { id: 'obj.autolayout', label: 'Adicionar auto layout', keys: ['Shift+A'], icon: <Rows3 size={14} />, run: (ed) => ed.addAutoLayout(), enabled: hasSel },
  { id: 'obj.removeAutolayout', label: 'Remover auto layout', keys: ['Shift+Alt+A'], icon: <LayoutTemplate size={14} />, run: (ed) => ed.removeAutoLayout(), enabled: hasLayout },
  { id: 'obj.component', label: 'Criar componente', keys: ['Mod+Alt+K'], icon: <Component size={14} />, run: (ed) => ed.wrap('component'), enabled: canComponent },
  { id: 'obj.rename', label: 'Renomear', keys: ['Mod+R'], icon: <PencilLine size={14} />, run: (ed) => ed.renameLayer(), enabled: one },
  { id: 'obj.selectParent', label: 'Selecionar o pai', keys: ['Shift+Enter'], run: (ed) => ed.selectParent(), enabled: hasParent },
  { id: 'obj.selectChildren', label: 'Selecionar filhos', keys: ['Enter'], run: (ed) => ed.selectChildren(), enabled: hasKids },
  { id: 'obj.detach', label: 'Desanexar instância', keys: ['Mod+Alt+B'], icon: <Unlink size={14} />, run: (ed) => ed.detach(), enabled: isInst },
  { id: 'obj.main', label: 'Ir para o componente principal', run: (ed) => ed.goToMainComponent(), enabled: (ed) => one(ed) && isInst(ed) },
  { id: 'obj.variants', label: 'Combinar como variantes', icon: <Layers2 size={14} />, run: (ed) => ed.combineAsVariants(), enabled: allComponents },
  { id: 'obj.addVariant', label: 'Adicionar variante', icon: <SquarePlus size={14} />, run: (ed) => ed.addVariant(), enabled: variantTarget },
  { id: 'obj.union', label: 'Unir seleção', keys: ['Mod+Alt+U'], icon: <SquaresUnite size={14} />, run: (ed) => ed.booleanOperation('union'), enabled: canBool },
  { id: 'obj.subtract', label: 'Subtrair seleção', keys: ['Mod+Alt+S'], icon: <SquaresSubtract size={14} />, run: (ed) => ed.booleanOperation('subtract'), enabled: canBool },
  { id: 'obj.intersect', label: 'Interseção da seleção', keys: ['Mod+Alt+I'], icon: <SquaresIntersect size={14} />, run: (ed) => ed.booleanOperation('intersect'), enabled: canBool },
  { id: 'obj.exclude', label: 'Excluir sobreposição', keys: ['Mod+Alt+X'], icon: <SquaresExclude size={14} />, run: (ed) => ed.booleanOperation('exclude'), enabled: canBool },
  { id: 'obj.flatten', label: 'Converter em vetor', keys: ['Mod+E'], icon: <Spline size={14} />, run: (ed) => ed.flatten(), enabled: canFlatten },
  { id: 'obj.editPoints', label: 'Editar pontos', icon: <PenTool size={14} />, run: (ed) => ed.enterVectorEdit(), enabled: (ed) => one(ed) && isShape(ed) && unlocked(ed) },
  { id: 'obj.textOnPath', label: 'Texto no caminho', icon: <Spline size={14} />, run: (ed) => ed.textOnPath(), enabled: (ed) => ed.canTextOnPath() },
  { id: 'obj.flipH', label: 'Espelhar na horizontal', keys: ['Shift+H'], icon: <FlipHorizontal2 size={14} />, run: (ed) => ed.flip('x'), enabled: hasSel },
  { id: 'obj.flipV', label: 'Espelhar na vertical', keys: ['Shift+V'], icon: <FlipVertical2 size={14} />, run: (ed) => ed.flip('y'), enabled: hasSel },
  { id: 'obj.front', label: 'Trazer para a frente', keys: ['Mod+Shift+]'], run: (ed) => ed.reorder('front'), enabled: canMove(1) },
  { id: 'obj.forward', label: 'Avançar', keys: ['Mod+]'], run: (ed) => ed.reorder('forward'), enabled: canMove(1) },
  { id: 'obj.backward', label: 'Recuar', keys: ['Mod+['], run: (ed) => ed.reorder('backward'), enabled: canMove(-1) },
  { id: 'obj.back', label: 'Enviar para trás', keys: ['Mod+Shift+['], run: (ed) => ed.reorder('back'), enabled: canMove(-1) },
  { id: 'obj.hide', label: 'Mostrar/ocultar', keys: ['Mod+Shift+H'], icon: <Eye size={14} />, run: (ed) => ed.toggle('visible'), enabled: hasSel, labelFor: (ed) => (allHidden(ed) ? 'Mostrar' : 'Ocultar') },
  { id: 'obj.lock', label: 'Bloquear/desbloquear', keys: ['Mod+Shift+L'], icon: <Lock size={14} />, run: (ed) => ed.toggle('locked'), enabled: hasSel, labelFor: (ed) => (allLocked(ed) ? 'Desbloquear' : 'Bloquear') },
  { id: 'obj.alignLeft', label: 'Alinhar à esquerda', keys: ['Alt+A'], run: (ed) => ed.align('left'), enabled: hasSel },
  { id: 'obj.alignRight', label: 'Alinhar à direita', keys: ['Alt+D'], run: (ed) => ed.align('right'), enabled: hasSel },
  { id: 'obj.alignTop', label: 'Alinhar ao topo', keys: ['Alt+W'], run: (ed) => ed.align('top'), enabled: hasSel },
  { id: 'obj.alignBottom', label: 'Alinhar à base', keys: ['Alt+S'], run: (ed) => ed.align('bottom'), enabled: hasSel },
  { id: 'obj.alignH', label: 'Centralizar na horizontal', keys: ['Alt+H'], run: (ed) => ed.align('hcenter'), enabled: hasSel },
  { id: 'obj.alignV', label: 'Centralizar na vertical', keys: ['Alt+V'], run: (ed) => ed.align('vcenter'), enabled: hasSel },

  // Exibir
  { id: 'view.zoomIn', label: 'Aproximar', keys: ['Mod+=', 'Mod+Shift+=', '=', 'Shift+='], icon: <ZoomIn size={14} />, run: (ed) => ed.zoomAt(1.5), enabled: doc },
  { id: 'view.zoomOut', label: 'Afastar', keys: ['Mod+-', '-'], icon: <ZoomOut size={14} />, run: (ed) => ed.zoomAt(1 / 1.5), enabled: doc },
  { id: 'view.zoom100', label: 'Zoom 100%', keys: ['Shift+0', 'Mod+0'], run: (ed) => ed.zoomTo(1), enabled: doc },
  { id: 'view.fit', label: 'Ajustar tudo na tela', keys: ['Shift+1'], icon: <Maximize2 size={14} />, run: (ed) => ed.zoomToFit(false), enabled: doc },
  { id: 'view.selection', label: 'Zoom na seleção', keys: ['Shift+2'], icon: <Scan size={14} />, run: (ed) => ed.zoomToSelection(), enabled: hasSel },
  { id: 'view.pixelGrid', label: 'Grade de pixels', keys: ["Shift+'"], icon: <Grid3x3 size={14} />, run: (ed) => ed.setSettings({ pixelGrid: !ed.settings.pixelGrid }), checked: (ed) => ed.settings.pixelGrid },
  { id: 'view.snapping', label: 'Encaixe inteligente', icon: <Magnet size={14} />, run: (ed) => ed.setSettings({ snapping: !ed.settings.snapping }), checked: (ed) => ed.settings.snapping },
  { id: 'view.rulers', label: 'Réguas', keys: ['Shift+R'], icon: <Ruler size={14} />, run: (ed) => ed.setSettings({ rulers: !ed.settings.rulers }), checked: (ed) => ed.settings.rulers },
  { id: 'view.layoutGrids', label: 'Grades de layout', keys: ['Mod+Shift+4'], icon: <LayoutGrid size={14} />, run: (ed) => ed.setSettings({ layoutGrids: !ed.settings.layoutGrids }), checked: (ed) => ed.settings.layoutGrids },
  { id: 'view.comments', label: 'Mostrar comentários', keys: ['Shift+C'], icon: <MessageCircle size={14} />, run: (ed) => ed.toggleComments(), checked: (ed) => ed.showComments, enabled: doc },
  { id: 'view.clearGuides', label: 'Remover todas as guias', run: (ed) => ed.setGuides([], 'Remover guias'), enabled: (ed) => doc(ed) && !!ed.page.guides?.length },
  { id: 'view.present', label: 'Apresentar protótipo', keys: ['Mod+Alt+Enter'], icon: <Play size={14} />, run: (ed) => ed.present(), enabled: doc },
  { id: 'view.variables', label: 'Variáveis…', keys: ['Mod+Alt+V'], icon: <Variable size={14} />, run: (ed) => ed.openDialog('variables'), enabled: doc },

  // Ajuda
  { id: 'help.shortcuts', label: 'Atalhos de teclado', keys: ['Mod+/'], icon: <Keyboard size={14} />, run: (ed) => ed.openDialog('shortcuts') },
  { id: 'help.updates', label: 'Verificar atualizações…', icon: <RefreshCw size={14} />, run: (ed) => ed.openDialog('updates') },
  { id: 'help.about', label: 'Sobre o Zaliel', icon: <Info size={14} />, run: (ed) => ed.openDialog('about') },
  { id: 'app.settings', label: 'Preferências…', keys: ['Mod+,'], icon: <Settings size={14} />, run: (ed) => ed.openDialog('settings') },
];

export const TOOL_KEYS: Record<string, Tool> = { v: 'move', h: 'hand', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', l: 'line', t: 'text', p: 'pen', c: 'comment' };

export const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function cmd(id: string): Command {
  return byId.get(id)!;
}

/** "Mod+Shift+G" → "Ctrl+Shift+G" (Windows/Linux) ou "⌘⇧G" (Mac). */
export function keyLabel(combo?: string): string {
  if (!combo) return '';
  const parts = combo.split('+').filter(Boolean);
  if (isMac) {
    const map: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Delete: '⌫', Backspace: '⌫' };
    return parts.map((p) => map[p] ?? p.toUpperCase()).join('');
  }
  const map: Record<string, string> = { Mod: 'Ctrl', Delete: 'Del' };
  return parts.map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+');
}

/** Combinação de um evento de teclado no mesmo formato dos comandos. */
export function comboOf(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  let k = e.key;
  // com Shift/Alt o "key" muda (ex.: Shift+0 vira ")"); usa o código físico
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (e.code === 'BracketRight') k = ']';
  else if (e.code === 'BracketLeft') k = '[';
  else if (e.code === 'Slash') k = '/';
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Quote') k = "'";
  else if (e.code === 'Equal') k = '=';
  else if (e.code === 'Minus') k = '-';
  if (k.length === 1) k = k.toUpperCase();
  return [...mods, k].join('+');
}

export function findCommand(combo: string): Command | undefined {
  const norm = (s: string) => s.split('+').filter(Boolean).map((p) => (p.length === 1 ? p.toUpperCase() : p)).join('+');
  return COMMANDS.find((c) => c.keys?.some((k) => norm(k) === combo));
}

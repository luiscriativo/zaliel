// Comandos do editor: um lugar só para menus, atalhos de teclado e menu de contexto.
import type { ReactNode } from 'react';
import {
  Copy, Scissors, Clipboard, CopyPlus, Trash2, Group, Ungroup, Frame, Component, Unlink, Rows3, Eye, Lock,
  FilePlus, FolderOpen, Save, ImagePlus, Download, ZoomIn, ZoomOut, Maximize2, Scan, Keyboard, Info, RefreshCw, Settings, Undo2, Redo2, Grid3x3, Magnet, Variable, AppWindow, X,
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
}

const hasSel = (ed: Editor) => ed.selection.length > 0;
const one = (ed: Editor) => ed.selection.length === 1;
const isInst = (ed: Editor) => ed.selectedNodes().some((n) => n.type === 'instance');
const doc = (ed: Editor) => !ed.home;

export const COMMANDS: Command[] = [
  // Arquivo
  { id: 'file.new', label: 'Novo arquivo', keys: ['Mod+N'], icon: <FilePlus size={14} />, run: async (ed) => (await ed.confirmDiscard()) && ed.newDocument() },
  { id: 'file.newWindow', label: 'Nova janela', keys: ['Mod+Shift+N'], icon: <AppWindow size={14} />, run: (ed) => ed.platform.newWindow() },
  { id: 'file.open', label: 'Abrir…', keys: ['Mod+O'], icon: <FolderOpen size={14} />, run: (ed) => ed.open() },
  { id: 'file.save', label: 'Salvar', keys: ['Mod+S'], icon: <Save size={14} />, run: (ed) => ed.save(), enabled: doc },
  { id: 'file.saveAs', label: 'Salvar como…', keys: ['Mod+Shift+S'], run: (ed) => ed.save(true), enabled: doc },
  { id: 'file.import', label: 'Importar imagens…', keys: ['Mod+Shift+K'], icon: <ImagePlus size={14} />, run: (ed) => ed.importImages(), enabled: doc },
  { id: 'file.exportPng', label: 'Exportar seleção como PNG (2×)', keys: ['Mod+Shift+E'], icon: <Download size={14} />, run: (ed) => ed.exportSelection('png', 2), enabled: hasSel },
  { id: 'file.exportSvg', label: 'Exportar seleção como SVG', run: (ed) => ed.exportSelection('svg'), enabled: hasSel },
  { id: 'file.close', label: 'Fechar arquivo', keys: ['Mod+W'], icon: <X size={14} />, run: (ed) => ed.closeDocument(), enabled: doc },

  // Editar
  { id: 'edit.undo', label: 'Desfazer', keys: ['Mod+Z'], icon: <Undo2 size={14} />, run: (ed) => ed.undo(), enabled: (ed) => doc(ed) && ed.model.past.length > 0 },
  { id: 'edit.redo', label: 'Refazer', keys: ['Mod+Shift+Z', 'Mod+Y'], icon: <Redo2 size={14} />, run: (ed) => ed.redo(), enabled: (ed) => doc(ed) && ed.model.future.length > 0 },
  { id: 'edit.cut', label: 'Recortar', keys: ['Mod+X'], icon: <Scissors size={14} />, run: (ed) => ed.copy(true), enabled: hasSel },
  { id: 'edit.copy', label: 'Copiar', keys: ['Mod+C'], icon: <Copy size={14} />, run: (ed) => ed.copy(), enabled: hasSel },
  { id: 'edit.paste', label: 'Colar', keys: ['Mod+V'], icon: <Clipboard size={14} />, run: (ed) => ed.paste(), enabled: doc },
  { id: 'edit.duplicate', label: 'Duplicar', keys: ['Mod+D'], icon: <CopyPlus size={14} />, run: (ed) => ed.duplicate(10), enabled: hasSel },
  { id: 'edit.delete', label: 'Excluir', keys: ['Delete', 'Backspace'], icon: <Trash2 size={14} />, run: (ed) => ed.deleteSelection(), enabled: hasSel },
  { id: 'edit.selectAll', label: 'Selecionar tudo', keys: ['Mod+A'], run: (ed) => ed.selectAll(), enabled: doc },

  // Objeto
  { id: 'obj.group', label: 'Agrupar', keys: ['Mod+G'], icon: <Group size={14} />, run: (ed) => ed.wrap('group'), enabled: hasSel },
  { id: 'obj.ungroup', label: 'Desagrupar', keys: ['Mod+Shift+G'], icon: <Ungroup size={14} />, run: (ed) => ed.ungroup(), enabled: hasSel },
  { id: 'obj.frame', label: 'Colocar em frame', keys: ['Mod+Alt+G'], icon: <Frame size={14} />, run: (ed) => ed.wrap('frame'), enabled: hasSel },
  { id: 'obj.autolayout', label: 'Adicionar auto layout', keys: ['Shift+A'], icon: <Rows3 size={14} />, run: (ed) => ed.addAutoLayout(), enabled: hasSel },
  { id: 'obj.component', label: 'Criar componente', keys: ['Mod+Alt+K'], icon: <Component size={14} />, run: (ed) => ed.wrap('component'), enabled: hasSel },
  { id: 'obj.detach', label: 'Desanexar instância', keys: ['Mod+Alt+B'], icon: <Unlink size={14} />, run: (ed) => ed.detach(), enabled: isInst },
  { id: 'obj.main', label: 'Ir para o componente principal', run: (ed) => ed.goToMainComponent(), enabled: (ed) => one(ed) && isInst(ed) },
  { id: 'obj.front', label: 'Trazer para a frente', keys: ['Mod+Shift+]'], run: (ed) => ed.reorder('front'), enabled: hasSel },
  { id: 'obj.forward', label: 'Avançar', keys: ['Mod+]'], run: (ed) => ed.reorder('forward'), enabled: hasSel },
  { id: 'obj.backward', label: 'Recuar', keys: ['Mod+['], run: (ed) => ed.reorder('backward'), enabled: hasSel },
  { id: 'obj.back', label: 'Enviar para trás', keys: ['Mod+Shift+['], run: (ed) => ed.reorder('back'), enabled: hasSel },
  { id: 'obj.hide', label: 'Mostrar/ocultar', keys: ['Mod+Shift+H'], icon: <Eye size={14} />, run: (ed) => ed.toggle('visible'), enabled: hasSel },
  { id: 'obj.lock', label: 'Bloquear/desbloquear', keys: ['Mod+Shift+L'], icon: <Lock size={14} />, run: (ed) => ed.toggle('locked'), enabled: hasSel },
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
  { id: 'view.variables', label: 'Variáveis…', keys: ['Mod+Alt+V'], icon: <Variable size={14} />, run: (ed) => ed.openDialog('variables'), enabled: doc },

  // Ajuda
  { id: 'help.shortcuts', label: 'Atalhos de teclado', keys: ['Mod+/'], icon: <Keyboard size={14} />, run: (ed) => ed.openDialog('shortcuts') },
  { id: 'help.updates', label: 'Verificar atualizações…', icon: <RefreshCw size={14} />, run: (ed) => ed.openDialog('updates') },
  { id: 'help.about', label: 'Sobre o Zaliel', icon: <Info size={14} />, run: (ed) => ed.openDialog('about') },
  { id: 'app.settings', label: 'Preferências…', keys: ['Mod+,'], icon: <Settings size={14} />, run: (ed) => ed.openDialog('settings') },
];

export const TOOL_KEYS: Record<string, Tool> = { v: 'move', h: 'hand', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', l: 'line', t: 'text', p: 'pen' };

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

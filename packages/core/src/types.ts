// Modelo do documento .zal — é exatamente o que vai para o arquivo em JSON.
// Coordenadas de cada nó são relativas ao nó pai.

export type NodeType =
  | 'frame'
  | 'group'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'star'
  | 'path'
  | 'text'
  | 'component'
  | 'component-set'
  | 'boolean'
  | 'instance';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Cor em hexadecimal `#rrggbb` ou `#rrggbbaa`. */
export type Hex = string;

export interface GradientStop {
  offset: number; // 0..1
  color: Hex;
}

/** Pontos do gradiente em coordenadas normalizadas da caixa do nó (0..1). */
export interface GradientHandles {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export type Paint =
  | { type: 'solid'; color: Hex; opacity?: number; visible?: boolean; variable?: string; blendMode?: BlendMode }
  | {
      type: 'linear' | 'radial' | 'angular';
      stops: GradientStop[];
      handles?: GradientHandles;
      opacity?: number;
      visible?: boolean;
      blendMode?: BlendMode;
    }
  | {
      type: 'image';
      asset: string; // chave em document.assets
      scaleMode: 'fill' | 'fit' | 'stretch' | 'tile';
      opacity?: number;
      visible?: boolean;
      blendMode?: BlendMode;
    };

export interface Stroke {
  paint: Paint;
  width: number;
  align: 'inside' | 'center' | 'outside';
  dash?: number[];
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  visible?: boolean;
}

export type Effect =
  | {
      type: 'drop-shadow' | 'inner-shadow';
      color: Hex;
      x: number;
      y: number;
      blur: number;
      spread?: number;
      visible?: boolean;
    }
  | { type: 'layer-blur' | 'background-blur'; radius: number; visible?: boolean };

/** Auto layout (flexbox) de um container. */
export interface AutoLayout {
  direction: 'horizontal' | 'vertical';
  gap: number;
  padding: [number, number, number, number]; // top, right, bottom, left
  /** Alinhamento no eixo principal. */
  justify: 'start' | 'center' | 'end' | 'space-between';
  /** Alinhamento no eixo cruzado. */
  align: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  wrap?: boolean;
  /** Espaço entre linhas quando há quebra. */
  crossGap?: number;
  reverseZIndex?: boolean;
}

export type SizingMode = 'fixed' | 'hug' | 'fill';

export interface Sizing {
  horizontal: SizingMode;
  vertical: SizingMode;
}

export interface Constraints {
  horizontal: 'left' | 'right' | 'left-right' | 'center' | 'scale';
  vertical: 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';
}

export interface TextStyle {
  family: string;
  weight: number; // 100..900
  italic?: boolean;
  size: number;
  lineHeight?: number | 'auto'; // em px
  letterSpacing?: number; // em px
  align?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  decoration?: 'none' | 'underline' | 'strikethrough';
  case?: 'none' | 'upper' | 'lower' | 'title';
}

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // graus, em torno do centro
  /** Espelhado na horizontal / vertical (em torno do centro, antes da rotação). */
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  blendMode?: BlendMode;
  fills?: Paint[];
  strokes?: Stroke[];
  effects?: Effect[];
  /** Raio uniforme ou [sup-esq, sup-dir, inf-dir, inf-esq]. */
  cornerRadius?: number | [number, number, number, number];
  /** Tamanho do filho dentro de um auto layout. */
  sizing?: Sizing;
  /** Ignora o auto layout do pai e fica em posição absoluta. */
  absolute?: boolean;
  constraints?: Constraints;
  /** Variáveis ligadas a propriedades (ex.: { "opacity": "var-id" }). */
  bindings?: Record<string, string>;
  /** Estilos ligados (o valor também fica gravado no nó). */
  styles?: NodeStyles;
  /** Dentro de um componente: propriedades do componente que controlam este nó. */
  propRefs?: PropRefs;
  /** Protótipo: o que acontece ao interagir com o nó. */
  interactions?: Interaction[];
  /** Campo livre para plugins e outras ferramentas; o editor preserva sem interpretar. */
  meta?: Record<string, unknown>;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export interface ContainerNode extends BaseNode {
  type: 'frame' | 'group' | 'component' | 'component-set' | 'boolean';
  children: SceneNode[];
  clip?: boolean;
  layout?: AutoLayout;
  /** Componente: descrição mostrada na biblioteca. */
  description?: string;
  /** Componente dentro de um conjunto: valor de cada propriedade de variante (ex.: { Estado: "Hover" }). */
  variant?: Record<string, string>;
  /** Componente ou conjunto de variantes: propriedades que as instâncias podem mudar. */
  properties?: ComponentProperty[];
  /** Operação booleana: como os filhos se combinam. */
  booleanOp?: BooleanOp;
  /** Frames: grades de layout (colunas, linhas ou grade quadrada). */
  grids?: LayoutGrid[];
}

// ── Propriedades de componente ───────────────────────────────────────────────

export type ComponentProperty =
  | { id: string; name: string; type: 'boolean'; default: boolean }
  | { id: string; name: string; type: 'text'; default: string }
  | { id: string; name: string; type: 'swap'; default: string; library?: string };

/** Propriedades do componente ligadas a um nó interno. */
export interface PropRefs {
  /** Booleana que mostra/oculta o nó. */
  visible?: string;
  /** Texto que substitui o conteúdo (só em nós de texto). */
  text?: string;
  /** Troca de instância (só em instâncias aninhadas). */
  component?: string;
}

// ── Grades de layout ─────────────────────────────────────────────────────────

export interface LayoutGrid {
  type: 'columns' | 'rows' | 'grid';
  /** Colunas/linhas: quantidade. */
  count: number;
  /** Grade quadrada: tamanho da célula. Colunas/linhas com alinhamento diferente de "stretch": largura de cada uma. */
  size: number;
  gutter: number;
  margin: number;
  alignment: 'stretch' | 'start' | 'center' | 'end';
  color: Hex;
  visible?: boolean;
}

// ── Estilos ──────────────────────────────────────────────────────────────────

export interface NodeStyles {
  fill?: string;
  stroke?: string;
  text?: string;
  effect?: string;
}

export type Style =
  | { id: string; name: string; type: 'color'; paints: Paint[]; description?: string }
  | { id: string; name: string; type: 'text'; text: TextStyle; description?: string }
  | { id: string; name: string; type: 'effect'; effects: Effect[]; description?: string };

// ── Protótipo ────────────────────────────────────────────────────────────────

export type Transition = 'instant' | 'dissolve' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';

export type OverlayPosition = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface Interaction {
  trigger: 'click';
  /** navigate: troca de tela · overlay: abre um frame por cima (modal) · close: fecha a sobreposição · back: volta. */
  action: 'navigate' | 'back' | 'overlay' | 'close';
  /** Frame de destino (id de um frame do topo da página). */
  target?: string;
  transition?: Transition;
  /** Duração da transição em ms. */
  duration?: number;
  /** Como a sobreposição aparece (só com action "overlay"). */
  overlay?: {
    position?: OverlayPosition;
    /** Cor do fundo atrás da sobreposição (#rrggbbaa). Vazio = sem fundo. */
    background?: string;
    /** Fechar ao clicar fora dela. */
    closeOutside?: boolean;
  };
}

export interface Guide {
  /** "x": linha vertical na posição x; "y": linha horizontal na posição y. */
  axis: 'x' | 'y';
  at: number;
}

export interface ShapeNode extends BaseNode {
  type: 'rect' | 'ellipse' | 'line' | 'polygon' | 'star';
  /** polygon/star: número de pontas. */
  points?: number;
  /** star: raio interno 0..1. */
  innerRadius?: number;
}

export interface PathNode extends BaseNode {
  type: 'path';
  /** Caminho SVG em coordenadas locais (0..width, 0..height). */
  d: string;
  fillRule?: 'nonzero' | 'evenodd';
}

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
  style: TextStyle;
  autoResize: 'width' | 'height' | 'none';
  /** Texto que segue um caminho (em vez de linhas). */
  textPath?: TextPath;
}

export interface TextPath {
  /** Caminho SVG no espaço do próprio texto (0..largura, 0..altura). */
  d: string;
  /** Onde o texto começa, em % do comprimento do caminho. */
  start?: number;
  /** Letras do outro lado do caminho (por dentro de um círculo, por exemplo). */
  flip?: boolean;
}

export interface InstanceOverride {
  text?: string;
  fills?: Paint[];
  strokes?: Stroke[];
  visible?: boolean;
  opacity?: number;
  /** Troca de componente aninhado (instance swap). */
  componentId?: string;
  /** Tamanho e comportamento dentro do auto layout, só nesta instância. */
  sizing?: Sizing;
  width?: number;
  height?: number;
  /** Textos: como a caixa acompanha o conteúdo. */
  autoResize?: TextNode['autoResize'];
}

export interface InstanceNode extends BaseNode {
  type: 'instance';
  componentId: string;
  /** Valores das propriedades do componente (id da propriedade → valor). */
  props?: Record<string, boolean | string>;
  /** Id da biblioteca quando o componente vem de outro arquivo. */
  library?: string;
  /** Overrides por id do nó dentro do componente. */
  overrides?: Record<string, InstanceOverride>;
}

export type SceneNode = ContainerNode | ShapeNode | PathNode | TextNode | InstanceNode;

export interface Page {
  id: string;
  name: string;
  background: Hex;
  children: SceneNode[];
  /** Guias arrastadas das réguas. */
  guides?: Guide[];
  /** Protótipo: frame onde a apresentação começa. */
  flowStart?: string;
}

export type VariableType = 'color' | 'number' | 'string' | 'boolean';
export type VariableValue = string | number | boolean | { alias: string };

export interface Variable {
  id: string;
  name: string; // aceita grupos com "/" (ex.: "cores/primária")
  type: VariableType;
  values: Record<string, VariableValue>; // modeId → valor
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: { id: string; name: string }[];
  defaultMode: string;
  variables: Variable[];
}

export interface Asset {
  mime: string;
  /** Conteúdo em base64. */
  data: string;
  width?: number;
  height?: number;
}

/** Biblioteca ligada: cópia dos componentes publicados para o arquivo abrir offline e sozinho. */
export interface LinkedLibrary {
  id: string;
  name: string;
  /** Caminho do arquivo .zal de origem na máquina de quem ligou. */
  path: string;
  /** Hash do conteúdo publicado, para detectar atualizações. */
  hash: string;
  /** Componentes e conjuntos de variantes publicados. */
  components: ContainerNode[];
  variables?: VariableCollection[];
  styles?: Style[];
  assets?: Record<string, Asset>;
}

export interface ZalDocument {
  format: 'zaliel';
  version: number;
  id: string;
  name: string;
  pages: Page[];
  variables: VariableCollection[];
  /** Estilos de cor, texto e efeito. */
  styles?: Style[];
  libraries: LinkedLibrary[];
  assets: Record<string, Asset>;
  /** Preferências do arquivo (grade, página atual, etc.). */
  settings?: {
    currentPage?: string;
    /** Modo de visualização por coleção de variáveis (coleção → modo). */
    modes?: Record<string, string>;
  };
  meta?: Record<string, unknown>;
  /** Comentários deixados no canvas. */
  comments?: DocComment[];
  /** Versões guardadas dentro do arquivo (o histórico). */
  versions?: DocVersion[];
}

/** Resposta dentro de um comentário. */
export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

/** Comentário preso a um ponto de uma página (ou a uma camada, para acompanhar quando ela muda de lugar). */
export interface DocComment {
  id: string;
  pageId: string;
  /** Posição no canvas; com `nodeId`, relativa ao canto da camada. */
  x: number;
  y: number;
  nodeId?: string;
  author: string;
  text: string;
  createdAt: number;
  resolved?: boolean;
  replies?: CommentReply[];
}

/** Uma versão do arquivo: o documento inteiro daquele momento, comprimido (sem imagens e sem o próprio histórico). */
export interface DocVersion {
  id: string;
  name: string;
  createdAt: number;
  /** Criada sozinha ao salvar (as automáticas antigas são descartadas; as com nome ficam). */
  auto?: boolean;
  /** JSON do documento comprimido com gzip, em base64. */
  data: string;
  /** Tamanho do JSON antes de comprimir (bytes). */
  size: number;
  pages: number;
}

export const FORMAT_VERSION = 1;

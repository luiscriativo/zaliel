// Modelo do documento .zal — é exatamente o que vai para o arquivo em JSON.
// Coordenadas de cada nó são relativas ao nó pai (como no Figma e no pen.dev).

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
  /** Campo livre para plugins e outras ferramentas; o editor preserva sem interpretar. */
  meta?: Record<string, unknown>;
}

export interface ContainerNode extends BaseNode {
  type: 'frame' | 'group' | 'component';
  children: SceneNode[];
  clip?: boolean;
  layout?: AutoLayout;
  /** Componente: descrição mostrada na biblioteca. */
  description?: string;
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
}

export interface InstanceOverride {
  text?: string;
  fills?: Paint[];
  visible?: boolean;
  /** Troca de componente aninhado (instance swap). */
  componentId?: string;
}

export interface InstanceNode extends BaseNode {
  type: 'instance';
  componentId: string;
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
  components: ContainerNode[];
  variables?: VariableCollection[];
  assets?: Record<string, Asset>;
}

export interface ZalDocument {
  format: 'zaliel';
  version: number;
  id: string;
  name: string;
  pages: Page[];
  variables: VariableCollection[];
  libraries: LinkedLibrary[];
  assets: Record<string, Asset>;
  /** Preferências do arquivo (grade, página atual, etc.). */
  settings?: {
    currentPage?: string;
    /** Modo de visualização por coleção de variáveis (coleção → modo). */
    modes?: Record<string, string>;
  };
  meta?: Record<string, unknown>;
}

export const FORMAT_VERSION = 1;

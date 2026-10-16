# Formato `.zal` — versão 1

Um arquivo `.zal` é texto **UTF-8 com JSON indentado**. Ele abre em qualquer editor de texto. Arquivos muito grandes (mais de 40 mil camadas) são gravados com o mesmo JSON, só que sem indentação, para caber no limite de tamanho de texto. O schema que valida a leitura fica em `packages/core/src/file.ts`, e os tipos em `packages/core/src/types.ts`.

## Topo

| Campo | Tipo | Descrição |
|---|---|---|
| `format` | `"zaliel"` | Identifica o arquivo. |
| `version` | número | Versão do formato. Uma versão maior que a suportada é recusada com um aviso para atualizar o app. |
| `id` | texto | Id do documento. Também identifica o arquivo quando ele é usado como biblioteca. |
| `name` | texto | Nome do documento. |
| `settings` | objeto | `currentPage` e `modes` (coleção de variáveis → modo exibido). |
| `pages` | lista | Páginas: `id`, `name`, `background` (`#rrggbb`), `children`, `guides` (guias: `{ "axis": "x" \| "y", "at": 120 }`) e `flowStart` (frame onde a apresentação do protótipo começa). |
| `variables` | lista | Coleções de variáveis (veja abaixo). |
| `styles` | lista | Estilos de cor, texto e efeito (veja abaixo). Opcional. |
| `libraries` | lista | Bibliotecas ligadas, com cópia dos componentes. |
| `meta` | objeto | Livre. O editor preserva sem interpretar (útil para outras ferramentas). |
| `comments` | lista | Comentários (veja abaixo). Opcional. |
| `versions` | lista | Histórico de versões (veja abaixo). Opcional. |
| `assets` | objeto | Imagens em base64, por chave. Fica por último no arquivo para não atrapalhar a leitura. |

## Nós

Campos comuns: `id`, `type`, `name`, `x`, `y`, `width`, `height` (relativos ao pai), `rotation` (graus, em torno do centro), `flipX`/`flipY` (espelhado em torno do centro, antes da rotação), `opacity`, `visible`, `locked`, `blendMode`, `fills`, `strokes`, `effects`, `cornerRadius` (número ou `[se, sd, id, ie]`), `sizing` (`{ horizontal, vertical }` com `fixed`/`hug`/`fill`), `absolute`, `constraints`, `styles` (estilos ligados, veja abaixo), `propRefs` (propriedades de componente que controlam o nó), `interactions` (protótipo), `meta`.

| `type` | Campos próprios |
|---|---|
| `frame`, `component` | `children`, `clip`, `layout` (auto layout), `grids` (grades de layout), `description`, `properties` e `variant` (componente) |
| `component-set` | Conjunto de variantes: `children` (só componentes), `properties`, `layout` |
| `boolean` | Operação booleana: `children` (as formas combinadas) e `booleanOp` (`union`, `subtract`, `intersect`, `exclude`) |
| `group` | `children` (a caixa sempre envolve os filhos) |
| `rect`, `ellipse`, `line` | — (a linha usa `width` como comprimento e `rotation` como ângulo) |
| `polygon`, `star` | `points`, `innerRadius` (estrela, 0–1) |
| `path` | `d` (caminho SVG em coordenadas locais), `fillRule` |
| `text` | `text`, `style` (`family`, `weight`, `italic`, `size`, `lineHeight`, `letterSpacing`, `align`, `verticalAlign`, `decoration`, `case`), `autoResize` (`width`/`height`/`none`), `textPath` (texto em caminho: `{ "d": "M0 100 Q100 0 200 100", "start": 10, "flip": false }`, com `d` nas coordenadas do texto e `start` em % do comprimento) |
| `instance` | `componentId`, `library` (opcional), `props` (valor de cada propriedade do componente, por id), `overrides` (por id de nó do componente: `text`, `fills`, `strokes`, `visible`, `opacity`, `componentId`, `sizing`, `width`, `height`, `autoResize`) |

### Auto layout (`layout`)

```json
{ "direction": "horizontal", "gap": 8, "padding": [12, 16, 12, 16], "justify": "space-between", "align": "center", "wrap": false }
```

As posições dos filhos ficam gravadas no arquivo já calculadas. Quem lê o arquivo sem o motor de layout vê o resultado certo.

### Pinturas (`fills`, `strokes[].paint`)

- `{ "type": "solid", "color": "#rrggbb[aa]", "opacity": 1, "variable": "id-opcional" }`
- `{ "type": "linear" | "radial" | "angular", "stops": [{ "offset": 0, "color": "#..." }], "handles": { "from": {x,y}, "to": {x,y} } }` (alças normalizadas de 0 a 1)
- `{ "type": "image", "asset": "chave", "scaleMode": "fill" | "fit" | "stretch" | "tile" }`

### Efeitos

`drop-shadow` e `inner-shadow` (`color`, `x`, `y`, `blur`, `spread`); `layer-blur` e `background-blur` (`radius`).

### Variantes e propriedades de componente

Um `component-set` agrupa componentes que são variantes uns dos outros. Cada variante tem `variant` com o valor de cada eixo, e o nome segue o padrão `Eixo=Valor, Outro=Valor`:

```json
{ "type": "component", "name": "Estado=Hover", "variant": { "Estado": "Hover" } }
```

As propriedades ficam no conjunto (ou no componente solto):

```json
"properties": [
  { "id": "p1", "name": "Rótulo", "type": "text", "default": "Enviar" },
  { "id": "p2", "name": "Mostrar ícone", "type": "boolean", "default": true },
  { "id": "p3", "name": "Ícone", "type": "swap", "default": "id-de-um-componente" }
]
```

Os nós de dentro ligam-se a elas com `propRefs`: `{ "visible": "p2" }`, `{ "text": "p1" }` (texto) ou `{ "component": "p3" }` (instância aninhada). A instância guarda só o que mudou em `props`: `{ "p1": "Comprar", "p2": false }`. Os overrides valem por cima das propriedades.

### Operações booleanas

O nó `boolean` guarda as formas originais (continuam editáveis). O desenho é calculado ao abrir, com as operações de caminho do Skia; "Subtrair" tira da forma de baixo todas as outras.

### Grades de layout (`grids`)

```json
{ "type": "columns", "count": 12, "gutter": 20, "margin": 24, "alignment": "stretch", "size": 64, "color": "#d9583b1a" }
```

`type` pode ser `columns`, `rows` ou `grid` (grade quadrada com células de `size`). Com `alignment` diferente de `stretch`, `size` é a largura de cada coluna/linha. `visible: false` oculta a grade.

### Protótipo (`interactions`)

```json
[{ "trigger": "click", "action": "navigate", "target": "id-do-frame", "transition": "slide-left", "duration": 300 }]
```

`action` é `navigate` (com `target`, um frame do topo da página), `overlay` (abre o frame `target` por cima da tela, como um modal), `close` (fecha a sobreposição de cima) ou `back` (fecha a sobreposição aberta ou volta para a tela anterior). Transições: `instant`, `dissolve`, `slide-left`, `slide-right`, `slide-up`, `slide-down`.

Uma sobreposição pode ter `overlay`:

```json
{ "position": "bottom", "background": "#00000066", "closeOutside": true }
```

`position`: `center`, `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left`, `bottom-right`. `background` vazio deixa a tela de baixo sem escurecer.

## Comentários

```json
{ "id": "c1", "pageId": "p1", "nodeId": "frame-1", "x": 120, "y": 48, "author": "Ana", "text": "Aumentar o contraste", "createdAt": 1760000000000, "resolved": false,
  "replies": [{ "id": "r1", "author": "Bruno", "text": "Feito", "createdAt": 1760000100000 }] }
```

Com `nodeId`, `x`/`y` são relativos ao canto da camada (o comentário acompanha a tela quando ela muda de lugar).

## Histórico de versões

Cada item de `versions` guarda o documento daquele momento: `id`, `name`, `createdAt`, `auto` (versão automática, criada ao salvar), `size`, `pages` e `data` — o JSON do documento sem `versions` e sem `assets`, comprimido com gzip e em base64. As imagens não são repetidas em cada versão: elas ficam uma vez só em `assets`. As versões automáticas mais antigas são descartadas (ficam as 20 mais recentes); as com nome ficam sempre.

## Estilos

```json
[
  { "id": "s1", "name": "Marca/Primária", "type": "color", "paints": [{ "type": "solid", "color": "#b5822f" }] },
  { "id": "s2", "name": "Título", "type": "text", "text": { "family": "Inter", "weight": 700, "size": 32, "lineHeight": 40 } },
  { "id": "s3", "name": "Sombra", "type": "effect", "effects": [{ "type": "drop-shadow", "color": "#00000040", "x": 0, "y": 2, "blur": 8 }] }
]
```

O nó aponta para o estilo em `styles` (`fill`, `stroke`, `text`, `effect`) e também guarda uma cópia do valor, para o arquivo continuar legível sem conhecer estilos. Editar um estilo reescreve os nós ligados; mudar o valor do nó à mão desfaz a ligação.

## Variáveis

```json
{
  "id": "c1", "name": "Tema", "defaultMode": "m1",
  "modes": [{ "id": "m1", "name": "Claro" }, { "id": "m2", "name": "Escuro" }],
  "variables": [{ "id": "v1", "name": "cores/fundo", "type": "color", "values": { "m1": "#ffffff", "m2": "#111111" } }]
}
```

Um valor pode ser um alias: `{ "alias": "id-de-outra-variável" }`.

## Bibliotecas

Cada item de `libraries` guarda `id` (o `id` do arquivo de origem), `name`, `path`, `hash` (do conteúdo publicado), `components`, `variables` e os `assets` usados. Assim o arquivo abre completo mesmo sem acesso ao arquivo da biblioteca.

## Edição por operações

Toda mudança passa por operações aplicadas pelo `Model` de `@zaliel/core`:

```ts
{ op: 'set', id, key: 'style.size', value: 18 }
{ op: 'insert', parent, index, node }
{ op: 'remove', id }
{ op: 'move', id, parent, index }
{ op: 'doc', key: 'variables', value: [...] }   // também 'styles' e 'comments'
{ op: 'asset', key, value }
```

Outras ferramentas podem usar o mesmo `@zaliel/core` para gerar ou alterar arquivos `.zal`, que abrem normalmente no Zaliel.

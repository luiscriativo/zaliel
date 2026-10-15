# Formato `.zal` — versão 1

Um arquivo `.zal` é texto **UTF-8 com JSON indentado**. Ele abre em qualquer editor de texto. O schema que valida a leitura fica em `packages/core/src/file.ts`, e os tipos em `packages/core/src/types.ts`.

## Topo

| Campo | Tipo | Descrição |
|---|---|---|
| `format` | `"zaliel"` | Identifica o arquivo. |
| `version` | número | Versão do formato. Uma versão maior que a suportada é recusada com um aviso para atualizar o app. |
| `id` | texto | Id do documento. Também identifica o arquivo quando ele é usado como biblioteca. |
| `name` | texto | Nome do documento. |
| `settings` | objeto | `currentPage` e `modes` (coleção de variáveis → modo exibido). |
| `pages` | lista | Páginas: `id`, `name`, `background` (`#rrggbb`), `children`. |
| `variables` | lista | Coleções de variáveis (veja abaixo). |
| `libraries` | lista | Bibliotecas ligadas, com cópia dos componentes. |
| `meta` | objeto | Livre. O editor preserva sem interpretar (útil para outras ferramentas). |
| `assets` | objeto | Imagens em base64, por chave. Fica por último no arquivo para não atrapalhar a leitura. |

## Nós

Campos comuns: `id`, `type`, `name`, `x`, `y`, `width`, `height` (relativos ao pai), `rotation` (graus, em torno do centro), `opacity`, `visible`, `locked`, `blendMode`, `fills`, `strokes`, `effects`, `cornerRadius` (número ou `[se, sd, id, ie]`), `sizing` (`{ horizontal, vertical }` com `fixed`/`hug`/`fill`), `absolute`, `constraints`, `meta`.

| `type` | Campos próprios |
|---|---|
| `frame`, `component` | `children`, `clip`, `layout` (auto layout), `description` (componente) |
| `group` | `children` (a caixa sempre envolve os filhos) |
| `rect`, `ellipse`, `line` | — (a linha usa `width` como comprimento e `rotation` como ângulo) |
| `polygon`, `star` | `points`, `innerRadius` (estrela, 0–1) |
| `path` | `d` (caminho SVG em coordenadas locais), `fillRule` |
| `text` | `text`, `style` (`family`, `weight`, `italic`, `size`, `lineHeight`, `letterSpacing`, `align`, `verticalAlign`, `decoration`, `case`), `autoResize` (`width`/`height`/`none`) |
| `instance` | `componentId`, `library` (opcional), `overrides` (por id de nó do componente: `text`, `fills`, `visible`, `componentId`) |

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
{ op: 'doc', key: 'variables', value: [...] }
{ op: 'asset', key, value }
```

Outras ferramentas podem usar o mesmo `@zaliel/core` para gerar ou alterar arquivos `.zal`, que abrem normalmente no Zaliel.

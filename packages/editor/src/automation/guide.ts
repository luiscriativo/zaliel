// Guia para quem automatiza o editor: como o documento funciona e as regras que
// deixam o resultado com cara de trabalho profissional. Escrito em inglês porque é
// lido por ferramentas externas; o conteúdo das telas segue a língua pedida.

export const INSTRUCTIONS = `Zaliel is a desktop UI design editor (frames, auto layout, components with variants, variables with modes, styles, prototype links).
Workflow: 1) get_guidelines (topic "overview" first, then the topic for the task) 2) get_editor_state 3) find_empty_space before new top-level frames 4) batch_design in chunks of 20–60 operations 5) get_screenshot + inspect_layout after each screen and FIX every problem before moving on.
Never leave text clipped, overlapping or with low contrast. Prefer auto layout over absolute positions. Reuse components and variables instead of repeating raw values.`;

const OVERVIEW = `# Zaliel — how the document works

- A document has pages; each page has top-level FRAMES (screens, artboards) and anything else. Coordinates (x, y) are relative to the parent.
- Layer types: frame, group, component, component_set, instance, text, rect, ellipse, line, polygon, star, path (vector), icon (Lucide vector), image, svg (imported as editable vectors).
- AUTO LAYOUT ("layout") turns a frame into a flexbox: {direction: "vertical"|"horizontal", gap, padding: n | [vertical, horizontal] | [top, right, bottom, left], align (cross axis): start|center|end|stretch, justify (main axis): start|center|end|space-between, wrap}.
  Children of an auto layout frame are positioned by the layout (x/y are ignored unless "absolute": true).
- Sizing inside auto layout: width/height can be a number (fixed), "fill" (fill the parent's available space) or "hug" (shrink to content). Frames with layout default to "hug".
  Typical: screen root frame fixed 390x844 (mobile) or 1440x900 (desktop) with vertical layout; sections width "fill"; buttons "hug"; text in cards width "fill" so it wraps.
- Text: {type:"text", text, font, size, weight (400/500/600/700 or names), lineHeight (px or multiplier like 1.4), letterSpacing, align, color}. A text with numeric or "fill" width wraps (autoResize "height"); without width it grows horizontally.
- Paints: "#hex", "rgba(...)", "$variable/name" (binds to a color variable), {type:"linear", angle, stops:["#a","#b"]}, "linear-gradient(135deg, #a, #b)", or {type:"image", src}.
- Strokes: "#ddd" (1px inside), "1px solid #ddd", or {color, width, align: inside|center|outside, dash: [4,4]}.
- Effects: "shadow": "xs"|"sm"|"md"|"lg"|"xl" presets, or effects: [{type:"shadow", color, x, y, blur, spread}, {type:"background-blur", radius}].
- radius: number or [topLeft, topRight, bottomRight, bottomLeft].
- "ref": give any created layer a ref ("card1") and use it later in the same batch_design call (parent: "card1", ids: ["card1"]). Refs are returned with their real ids.
- Everything one batch_design call does is ONE undo step, and if any operation fails nothing is applied (fix the error and send again).

# Quality loop (mandatory)
After building or changing a screen: get_screenshot of the frame (look at it carefully) and inspect_layout. Fix clipped/overflowing text, overlaps, low contrast, inconsistent spacing, misalignment. Only then continue.`;

const DESIGN = `# Visual quality rules

Spacing: use a 4/8 px scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Screen side padding 16–24 (mobile) / 32–80 (desktop). Inside cards 16–24. Related items 8–12 apart, separate groups 24–32 apart.
Typography (mobile): display 32–40/700, title 22–28/700, heading 17–20/600, body 15–16/400 (line height 1.4–1.5), caption 12–13/500. Desktop scales up ~1.25x. Use at most 2 font families; prefer one (Inter is always available — call list_fonts before using others).
Hierarchy: one clear primary action per screen; secondary actions as outline/ghost. Titles darker and heavier; supporting text in a muted color (contrast >= 4.5:1 for text under 18px).
Color: a neutral scale (background, surface, border, text, muted text) + one brand color + semantic colors (success/warning/danger/info). Never pure #000 text on pure #fff for long reading; use near-black like #1a1a1a / #111827.
Radius: be consistent (e.g., 8 for inputs/buttons, 12–16 for cards, 999 for pills/avatars).
Touch targets: >= 44x44 on mobile; buttons 44–48 tall; inputs 44–48 tall with 12–16 horizontal padding.
Alignment: everything aligns to a few vertical lines; same paddings at the same level; equal gaps between repeated items (use auto layout).
Lists/cards: avatar or icon + title + subtitle + trailing value/chevron, in a horizontal layout with align "center" and the text column width "fill".
Navigation: mobile top bar 56 tall, bottom tab bar 64–84 tall with 4–5 items (icon 24 + label 11–12).
Empty space is good: do not cram. Prefer fewer, larger elements.
Realistic content: real-looking names, numbers, dates and copy in the language the user asked for — never "Lorem ipsum" unless asked.
Images: when you have none, use a neutral placeholder (soft gradient or light gray rect with an icon) instead of leaving empty boxes.
Dark mode: backgrounds #0b0b0c–#18181b, surfaces a step lighter, borders subtle (#ffffff14), text #f4f4f5, muted #a1a1aa.`;

const COMPONENTS = `# Components, variants and the library

- Build reusable UI as COMPONENTS on a page named "Componentes" (or "Library"), arranged in a grid with frames/sections, then use INSTANCES on the screens.
- Create directly: {type:"component", name:"Button/Primary", layout:{...}, properties:[{name:"Label", type:"text", default:"Continue"}, {name:"Show icon", type:"boolean", default:true}], children:[{type:"text", text:"Continue", bind:{text:"Label"}}, {type:"icon", icon:"arrow-right", bind:{visible:"Show icon"}}]}
- Variants: {type:"component_set", name:"Button", properties:[...shared props...], children:[{type:"component", variant:{Type:"Primary", Size:"M"}, ...}, {type:"component", variant:{Type:"Secondary", Size:"M"}, ...}]}. Each variant has the same layer names so overrides carry over.
  Or convert existing components with batch_design op "combine_variants".
- Instances: {type:"instance", component:"Button", variant:{Type:"Secondary"}, props:{"Label":"Cancel", "Show icon":false}, width:"fill"} — "component" accepts the component/set name or id. Override inner layers by name path: overrides: {"Label": {text:"Hi"}, "Icon > Vector": {fill:"#fff"}}.
- Change an instance later with op "update" (variant, props, overrides). Detach only when really needed.
- Naming: "Category/Name" (Button/Primary, Input/Text, Card/Product). Property names short and human ("Label", "Icon", "State").
- Build bottom-up: tokens (variables + text styles) → atoms (button, input, badge, avatar, icon button) → molecules (list item, card, top bar, tab bar, modal) → screens using instances only.
- Use variables for colors (create a "Theme" collection with Light/Dark modes) and text styles for the type scale; reference them with "$color/name" and textStyle:"Title".`;

const FROM_CODE = `# Recreating a front-end (HTML/React/Vue/Tailwind) in Zaliel

1. Read the code and extract TOKENS: colors (CSS variables, Tailwind config, repeated hex), font families/sizes/weights, radii, spacing, shadows. Create them first: variables (collection "Theme", modes Light/Dark if the app has both) and text styles. analyze_design can show what an existing drawing already uses.
2. Find REUSABLE COMPONENTS: anything rendered more than once or defined as a component (Button, Input, Card, Badge, Avatar, NavItem, ListRow, Modal, Table row...). Note their props and states → component properties and variants (e.g., Button: Variant=Primary|Secondary|Ghost, Size=S|M|L, State=Default|Disabled).
3. Draw the components on a "Componentes" page with batch_design (component / component_set), each bound to variables and text styles. Screenshot and fix each one.
4. Draw each SCREEN/route as a top-level frame (390x844 mobile or 1440x900 desktop, or the size the app targets) using INSTANCES of the components, with auto layout mirroring the CSS flex/grid structure.
5. Mapping: display:flex → layout; flex-direction column → "vertical"; gap → gap; padding → padding; align-items → align; justify-content → justify; flex:1 / w-full → "fill"; w-fit → "hug"; border-radius → radius; box-shadow → effects; position:absolute → absolute:true with x/y. Tailwind units: 1 = 4px (p-4 = 16, gap-2 = 8, rounded-lg = 8, rounded-xl = 12, text-sm = 14, text-base = 16, text-lg = 18, text-xl = 20, text-2xl = 24).
6. Grids (CSS grid): a vertical frame of horizontal rows, or a horizontal frame with wrap:true and children with fixed widths.
7. Link the screens (link on buttons → navigate; modals → overlay) to make the flow presentable.
8. Organize: one page for components, one page per flow/area for screens, names matching the code (routes / component names).`;

const ICONS = `# Icons, logos and illustrations

- Icons: search_icons("bell") then {type:"icon", icon:"bell", size:20, color:"$text/muted", strokeWidth:2}. Lucide set (~1600 outline icons). Icons are editable vectors.
- Custom icons, logos and illustrations: draw them as SVG and insert with {type:"svg", svg:"<svg viewBox='0 0 64 64'>…</svg>", width:64}. Paths, circles, rects, polygons, groups, transforms, gradients and opacity are converted to editable vector layers. Text inside SVG is not converted — draw letters as paths or use a text layer next to it.
- Logo tips: simple geometric construction (circles, rounded squares, diagonals), 1–2 colors, works in one color, recognizable at 24px. Combine the mark with a wordmark text (weight 600–800, slight negative letterSpacing like -0.5).
- You can also build shapes from primitives and combine them with batch_design op "boolean" (union, subtract, intersect, exclude) and "flatten" to merge into one vector.`;

const PROTOTYPE = `# Prototype

- Link a layer to a screen: in a create/update use link: {to:"screenRef", action:"navigate", transition:"slide-left"} (transitions: instant, dissolve, slide-left, slide-right, slide-up, slide-down).
- Modals/menus/sheets: put the modal as its own top-level frame and link with action "overlay" (position: center|bottom|top|..., background:"#00000066", closeOutside:true). Inside it, a close button with action "close". "back" returns to the previous screen.
- Set the starting screen with pages action "set_flow_start".`;

const VARIABLES = `# Variables and styles

- variables tool: create a collection with modes (e.g., "Theme" with "Light" and "Dark"), then set variables {name:"color/bg", type:"color", values:{Light:"#ffffff", Dark:"#0b0b0c"}}. Group names with "/".
- Use them anywhere a color goes: fill:"$color/bg". Switching the mode (variables action "set_mode") recolors every bound layer.
- styles tool: text styles (name + font/size/weight/lineHeight/letterSpacing), color styles and effect styles. Apply with textStyle:"Title", fillStyle:"Brand", effectStyle:"Card shadow".
- Prefer variables for colors that change with themes; text styles for the type scale.`;

export const GUIDES: Record<string, string> = {
  overview: OVERVIEW,
  design: DESIGN,
  components: COMPONENTS,
  'from-code': FROM_CODE,
  icons: ICONS,
  prototype: PROTOTYPE,
  variables: VARIABLES,
};

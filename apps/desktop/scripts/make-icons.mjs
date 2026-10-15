// Gera o ícone do app (build/icon.png, 1024×1024) a partir de um SVG desenhado aqui.
// O electron-builder converte para .ico (Windows) e .icns (macOS) automaticamente.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, '..', 'build');

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2824"/>
      <stop offset="1" stop-color="#141311"/>
    </linearGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2c486"/>
      <stop offset="0.55" stop-color="#c7a462"/>
      <stop offset="1" stop-color="#9c7a3a"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#bg)"/>
  <rect x="112" y="112" width="800" height="800" rx="168" fill="none" stroke="#c7a462" stroke-opacity="0.28" stroke-width="4"/>
  <g transform="translate(512 512) skewX(-12) translate(-512 -512)" fill="url(#brass)">
    <!-- Z com serifas: barra de cima, diagonal fina-grossa e barra de baixo -->
    <path d="M318 286 H716 L708 330 L408 694 H664 C690 694 704 676 716 640 L734 640 L712 738 H300 L308 694 L606 330 H388 C362 330 350 346 338 378 L320 378 Z"/>
  </g>
  <circle cx="742" cy="722" r="26" fill="#c7a462"/>
</svg>`;

await mkdir(out, { recursive: true });
await sharp(Buffer.from(ICON_SVG)).png().toFile(path.join(out, 'icon.png'));
await sharp(Buffer.from(ICON_SVG)).resize(256, 256).png().toFile(path.join(out, 'icon-256.png'));
console.log('Ícones gerados em', out);

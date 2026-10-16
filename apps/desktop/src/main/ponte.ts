// Ponte stdio → servidor local de automação. Para programas que só sabem iniciar um
// processo e conversar por entrada/saída padrão. Roda com o próprio executável do app:
//   ELECTRON_RUN_AS_NODE=1 Zaliel ponte.js
// Lê ZALIEL_PORT e ZALIEL_TOKEN do ambiente. Uma mensagem JSON por linha, nos dois sentidos.
import { createInterface } from 'node:readline';

const port = Number(process.env.ZALIEL_PORT) || 47950;
const token = process.env.ZALIEL_TOKEN ?? '';
const url = `http://127.0.0.1:${port}/`;

const write = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closing = false;

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: { id?: unknown } | { id?: unknown }[];
  try {
    msg = JSON.parse(text);
  } catch {
    return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } });
  }
  pending++;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: text });
    if (res.status === 202) return;
    const body = await res.text();
    // erro de HTTP (token recusado etc.) vira erro do protocolo, não o corpo cru
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    process.stdout.write(`${body.trim()}\n`);
  } catch (e) {
    // o app está fechado ou a automação está desligada
    const ids = (Array.isArray(msg) ? msg : [msg]).map((m) => m.id).filter((id) => id !== undefined && id !== null);
    const m = (e as Error)?.message ?? '';
    const reason = m.startsWith('HTTP 401') ? 'token recusado (gere a configuração de novo nas preferências)' : m.startsWith('HTTP') ? `resposta inesperada (${m})` : 'o Zaliel não está aberto ou a automação está desligada nas preferências';
    for (const id of ids) write({ jsonrpc: '2.0', id, error: { code: -32000, message: `Sem conexão com o Zaliel: ${reason}.` } });
  } finally {
    pending--;
    if (closing && !pending) process.exit(0);
  }
});

rl.on('close', () => {
  closing = true;
  if (!pending) process.exit(0);
});

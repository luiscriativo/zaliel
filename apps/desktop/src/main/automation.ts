// Servidor local de automação: recebe pedidos JSON-RPC 2.0 por HTTP (só em 127.0.0.1,
// com token) e repassa para a janela do editor, onde as ferramentas rodam.
// Fica desligado até o usuário ligar nas preferências.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface AutomationSettings {
  enabled: boolean;
  port: number;
  token: string;
}

export const DEFAULT_PORT = 47950;

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Versões do protocolo que este servidor entende (a mais nova primeiro). */
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export interface AutomationHandlers {
  /** Lista de ferramentas e instruções (vêm do editor). */
  describe(): Promise<{ tools: unknown[]; instructions: string }>;
  /** Executa uma ferramenta no editor. */
  call(name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }>;
  version: string;
}

export interface AutomationServer {
  port: number;
  close(): Promise<void>;
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function startAutomation(settings: AutomationSettings, h: AutomationHandlers): Promise<AutomationServer> {
  const server = http.createServer((req, res) => {
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    // só a própria máquina, e nunca uma página da web (que mandaria Origin) — protege contra DNS rebinding
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') return send(403, { error: 'host não permitido' });
    if (req.headers.origin) return send(403, { error: 'origem não permitida' });
    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !sameToken(token, settings.token)) return send(401, { error: 'token inválido' });
    if (req.method === 'GET') return send(405, { error: 'use POST' }, { Allow: 'POST' });
    if (req.method === 'DELETE') return send(200, {});
    if (req.method !== 'POST') return send(405, { error: 'use POST' }, { Allow: 'POST' });

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) req.destroy(); // pedidos enormes (imagens em base64 passam bem antes disso)
      else chunks.push(c);
    });
    req.on('end', async () => {
      let msg: Rpc | Rpc[];
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } });
      }
      const list = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(list.map((m) => handle(m, h)))).filter(Boolean);
      if (!out.length) return send(202);
      send(200, Array.isArray(msg) ? out : out[0]);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        port: settings.port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function handle(m: Rpc, h: AutomationHandlers): Promise<unknown> {
  const id = m.id;
  const isNotification = id === undefined || id === null;
  const ok = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } });
  try {
    switch (m.method) {
      case 'initialize': {
        const asked = String(m.params?.protocolVersion ?? '');
        const { instructions } = await h.describe();
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'zaliel', title: 'Zaliel', version: h.version },
          instructions,
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return ok({});
      case 'tools/list': {
        const { tools } = await h.describe();
        return ok({ tools });
      }
      case 'tools/call': {
        const name = String(m.params?.name ?? '');
        const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
        return ok(await h.call(name, args));
      }
      default:
        return fail(-32601, `método desconhecido: ${m.method}`);
    }
  } catch (e) {
    return fail(-32603, String((e as Error)?.message ?? e));
  }
}

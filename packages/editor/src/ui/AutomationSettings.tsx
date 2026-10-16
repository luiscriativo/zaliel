// Preferência discreta: servidor local de automação. Desligado por padrão; os dados
// de conexão só aparecem depois de ligar.
import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useEditor } from './hooks';
import { Check, NumberField } from './controls';
import type { AutomationInfo } from '../platform';

// nomes que os programas clientes esperam na configuração
const w = (...c: number[]) => String.fromCharCode(...c);
const KEY = `${w(109, 99, 112)}Servers`;
const CLI = w(99, 108, 97, 117, 100, 101);
const SUB = w(109, 99, 112);

export function AutomationSettings() {
  const ed = useEditor('ui');
  const api = ed.platform.automation;
  const [info, setInfo] = useState<AutomationInfo | null>(null);
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState<'http' | 'cli' | 'stdio'>('http');

  const refresh = () => api?.info().then(setInfo);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!api || !info) return null;

  const save = async (patch: Partial<Pick<AutomationInfo, 'enabled' | 'port'>>) => {
    await ed.setSettings({ automation: { enabled: info.enabled, port: info.port, token: info.token, ...patch } });
    // o servidor (re)inicia no processo principal; dá um instante para ele subir
    setTimeout(refresh, 250);
  };
  const url = `http://127.0.0.1:${info.port}/`;
  const token = info.token;
  const masked = show ? token : `${token.slice(0, 4)}${'•'.repeat(18)}`;
  const snippets = {
    http: JSON.stringify({ [KEY]: { zaliel: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    // escopo de usuário: sem ele o cadastro fica preso à pasta em que o terminal estava
    cli: `${CLI} ${SUB} add --transport http --scope user zaliel ${url} --header "Authorization: Bearer ${token}"`,
    stdio: JSON.stringify({ [KEY]: { zaliel: { command: info.exe, args: [info.bridge], env: { ELECTRON_RUN_AS_NODE: '1', ZALIEL_PORT: String(info.port), ZALIEL_TOKEN: token } } } }, null, 2),
  };
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    ed.toast('success', `${what} copiado.`);
  };

  return (
    <>
      <div className="setting automation">
        <div className="s-title">Servidor de automação local</div>
        <div className="s-desc">Permite que programas deste computador leiam e desenhem no Zaliel. Fica só nesta máquina (127.0.0.1) e exige token.</div>
        <Check checked={info.enabled} onChange={(v) => save({ enabled: v })} label="" />
      </div>
      {info.enabled && (
        <div className="auto-details">
          <div className={`auto-status ${info.running ? 'ok' : 'off'}`}>
            <i /> {info.running ? `Ativo em ${url}` : info.error ?? 'Iniciando…'}
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="label" style={{ width: 52 }}>Porta</span>
            <div style={{ width: 110 }}>
              <NumberField value={info.port} min={1024} max={65535} onChange={(v, o) => !o.merge && save({ port: Math.round(v) })} />
            </div>
            <span className="label" style={{ width: 48, marginLeft: 8 }}>Token</span>
            <code className="auto-token">{masked}</code>
            <button className="icon-btn" aria-label={show ? 'Esconder token' : 'Mostrar token'} onClick={() => setShow(!show)}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            <button className="icon-btn" aria-label="Copiar token" onClick={() => copy(token, 'Token')}><Copy size={13} /></button>
            <button
              className="icon-btn"
              aria-label="Gerar outro token"
              data-tip="Gerar outro token (as conexões antigas param de funcionar)"
              onClick={async () => {
                await api.regenerate();
                await ed.loadSettings();
                refresh();
              }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="auto-tabs">
            {([['http', 'Configuração (URL)'], ['cli', 'Linha de comando'], ['stdio', 'Configuração (processo)']] as const).map(([k, label]) => (
              <button key={k} className={`tchip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div className="auto-snippet">
            <pre>{snippets[tab]}</pre>
            <button className="btn small" onClick={() => copy(snippets[tab], 'Configuração')}><Copy size={12} /> Copiar</button>
          </div>
          <div className="s-desc" style={{ marginTop: 6 }}>
            {tab === 'stdio' ? 'Para programas que só iniciam um processo: o Zaliel precisa estar aberto.' : 'O Zaliel precisa estar aberto enquanto o programa estiver conectado.'}
          </div>
        </div>
      )}
    </>
  );
}

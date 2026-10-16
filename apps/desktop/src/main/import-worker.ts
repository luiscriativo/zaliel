// Thread de importação: lê e converte arquivos .fig fora da thread principal,
// para a janela não travar com arquivos grandes. Devolve o documento já pronto.
import { parentPort, workerData } from 'node:worker_threads';
import { readForImport } from './importer';
import { figToDocument } from '@zaliel/core';

async function run(file: string) {
  const payload = await readForImport(file);
  if (payload.kind !== 'fig') return { ok: true, payload };
  const result = figToDocument(payload, payload.name);
  // texto compacto: um objeto enorme passa mais rápido entre processos como JSON
  return { ok: true, payload: { kind: 'converted', name: payload.name, json: JSON.stringify(result.doc), report: result.report } };
}

run(workerData.file as string)
  .then((res) => parentPort?.postMessage(res))
  .catch((err) => parentPort?.postMessage({ ok: false, error: String((err as Error)?.message ?? err) }));

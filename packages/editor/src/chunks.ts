// Pedaços do app carregados sob demanda (ícones, importação). Se a build foi refeita com a
// janela aberta, o arquivo que ela conhece pode ter sumido: avisa para recarregar a janela.

export const STALE_BUILD_EVENT = 'zaliel:stale-build';
export const STALE_BUILD_MESSAGE = 'O Zaliel foi atualizado enquanto estava aberto. Recarregue a janela para continuar.';

const MISSING_CHUNK = /dynamically imported module|importing a module script failed|error loading dynamically imported/i;

export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!MISSING_CHUNK.test(String((e as Error)?.message ?? e))) throw e;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(STALE_BUILD_EVENT));
    throw new Error(STALE_BUILD_MESSAGE);
  }
}

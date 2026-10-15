import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, Editor, EditorContext, type HostAssets } from '@zaliel/editor';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import inter100 from '@expo-google-fonts/inter/100Thin/Inter_100Thin.ttf?url';
import inter200 from '@expo-google-fonts/inter/200ExtraLight/Inter_200ExtraLight.ttf?url';
import inter300 from '@expo-google-fonts/inter/300Light/Inter_300Light.ttf?url';
import inter400 from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url';
import inter400i from '@expo-google-fonts/inter/400Regular_Italic/Inter_400Regular_Italic.ttf?url';
import inter500 from '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf?url';
import inter600 from '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?url';
import inter700 from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url';
import inter700i from '@expo-google-fonts/inter/700Bold_Italic/Inter_700Bold_Italic.ttf?url';
import inter800 from '@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf?url';
import inter900 from '@expo-google-fonts/inter/900Black/Inter_900Black.ttf?url';
import { createPlatform } from './platform';

const assets: HostAssets = {
  wasmUrl,
  interFiles: {
    '100': inter100,
    '200': inter200,
    '300': inter300,
    '400': inter400,
    '400-italic': inter400i,
    '500': inter500,
    '600': inter600,
    '700': inter700,
    '700-italic': inter700i,
    '800': inter800,
    '900': inter900,
  },
};

async function boot() {
  const platform = await createPlatform();
  const editor = new Editor(platform);
  // abrir um .zal recebido pelo sistema (duplo clique no Explorer/Finder)
  const pending = await window.zaliel.pendingOpen();
  if (pending) editor.openPath(pending);
  // gancho de testes (só em desenvolvimento)
  if ((await window.zaliel.info()).dev) (window as unknown as { __editor: Editor }).__editor = editor;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <EditorContext.Provider value={editor}>
        <App assets={assets} />
      </EditorContext.Provider>
    </StrictMode>,
  );
}

boot();

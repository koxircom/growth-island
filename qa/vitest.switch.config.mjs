import {fileURLToPath} from 'node:url';
export default {resolve:{alias:{'@':fileURLToPath(new URL('../',import.meta.url))}},esbuild:{jsx:'automatic'},test:{include:['qa/switch-wallet-component.test.tsx','qa/switch-wallet-interaction.test.tsx','qa/home-access-route.test.ts','qa/home-access-component.test.tsx']}};

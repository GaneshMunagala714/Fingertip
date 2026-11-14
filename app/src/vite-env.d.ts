/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGN2SPEAK_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css?inline" {
  const css: string;
  export default css;
}

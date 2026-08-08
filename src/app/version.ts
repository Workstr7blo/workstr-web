// Injected by Vite at build time (see vite.config.ts). Declared here rather than
// in a global .d.ts so the one module that reads it also documents it.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

import { build } from 'esbuild';

// dsh 浏览器加载器提供 React。源码只维护一份，产物不进入 Git。
await build({
  entryPoints: ['src/client.js'], outfile: 'dist/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', external: ['react'],
  banner: { js: 'globalThis.__ModuleLoader__.load({ id: "dsh-state-notifier", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; }});' },
});

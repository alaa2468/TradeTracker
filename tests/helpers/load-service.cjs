const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

module.exports = function loadService(file, cache = new Map()) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const loaded = { exports: {} };
  cache.set(resolved, loaded);
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = name => name.startsWith('.')
    ? module.exports(path.resolve(path.dirname(resolved), name + '.ts'), cache) : require(name);
  new Function('require', 'module', 'exports', code)(localRequire, loaded, loaded.exports);
  return loaded.exports;
};

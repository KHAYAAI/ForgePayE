// Tells Node how to read each build: dist/esm is ES modules, dist/cjs is CommonJS. Without this Node has to guess and warns.
const fs = require('node:fs');
fs.writeFileSync('dist/esm/package.json', '{"type":"module"}\n');
fs.writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');

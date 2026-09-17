const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
const iconSystem=fs.readFileSync(path.join(root,'auris-icon-system.js'),'utf8');
const iconCss=fs.readFileSync(path.join(root,'auris-icon-system.css'),'utf8');
const launcherCss=fs.readFileSync(path.join(root,'auris-app-launcher.css'),'utf8');

test('launcher cards carry their icon key and atlas class in the initial render',()=>{
  assert.ok(core.includes(`data-app-key="'+escapeHtml(module.k)+'" data-nav-key="'+escapeHtml(module.k)+'"`));
  assert.match(core,/auris-app-card-icon[^]*auris-module-icon/);
  assert.match(core,/escapeHtml\(module\.color\|\|'#185FA5'\)/);
});

test('shared icon system decorates launcher cards and positions module artwork',()=>{
  assert.match(iconSystem,/\.auris-app-card\[data-app-key\]/);
  assert.match(iconSystem,/\.auris-app-card-icon > i/);
  assert.match(iconCss,/\[data-nav-key="documents"\] i\.auris-module-icon/);
  assert.match(iconCss,/\[data-nav-key="tools"\] i\.auris-module-icon/);
});

test('launcher icon shell keeps a visible fallback surface',()=>{
  assert.match(launcherCss,/#modules-menu \.auris-app-card-icon\{[^}]*background-color:#185FA5/);
  assert.match(launcherCss,/#modules-menu \.auris-app-card-icon i\{[^}]*display:inline-flex/);
});

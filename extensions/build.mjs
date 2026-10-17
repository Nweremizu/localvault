import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const {version} = JSON.parse(await fs.readFile('package.json', 'utf8'));
const identity = JSON.parse(await fs.readFile('../browser-identity.json', 'utf8'));

for (const target of ['chrome', 'edge', 'firefox']) {
  const outdir = `dist/${target}`;
  await fs.mkdir(outdir, {recursive:true});
  await build({entryPoints:['src/background.ts','src/content.ts','src/popup.ts','src/picker.ts','src/save.ts'], outdir, bundle:true, format:'iife', target:'es2022', sourcemap:false, legalComments:'eof'});
  await fs.copyFile('src/popup.html', path.join(outdir, 'popup.html'));
  await fs.copyFile('src/popup.css', path.join(outdir, 'popup.css'));
  for(const name of ['picker.html','picker.css','save.html','save.css'])await fs.copyFile('src/'+name,path.join(outdir,name));
  for(const size of [16,48,128]) await fs.copyFile(`src/icon${size}.png`, `${outdir}/icon${size}.png`); // from scripts/make-logo.ps1
  const manifest = {
    manifest_version:3, name:'LocalVault — private beta',version,description:'Local passwords with your LocalVault desktop app. Click to fill; approve before saving.',
    permissions:['nativeMessaging','storage','scripting','activeTab'], host_permissions:['https://*/*'],
    web_accessible_resources:[{resources:['picker.html','save.html'],matches:['https://*/*']}],
    action:{default_popup:'popup.html',default_title:'LocalVault'},
    icons:{16:'icon16.png',48:'icon48.png',128:'icon128.png'},
    background:target==='firefox'?{scripts:['background.js']}:{service_worker:'background.js'},
    content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; base-uri 'none'"},
    ...(target==='firefox'?{browser_specific_settings:{gecko:{id:identity.firefoxId,strict_min_version:'142.0',data_collection_permissions:{required:['none']}}}}:{key:identity.chromiumKey})
  };
  await fs.writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest,null,2));
}
await build({entryPoints:['src/forms.ts','src/security.ts'],outdir:'test-built',bundle:true,format:'esm',platform:'node'});

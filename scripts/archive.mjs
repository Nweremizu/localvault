import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const destination=path.join(root,'artifacts/source');
await fs.mkdir(destination,{recursive:true});
const excluded=new Set(['bin','obj','node_modules','artifacts','.tools','.git','.nuget-http-cache','test-built']);
async function copy(folder,relative=''){
  for(const item of await fs.readdir(folder,{withFileTypes:true})){
    if(excluded.has(item.name))continue;
    const rel=path.join(relative,item.name),from=path.join(folder,item.name),to=path.join(destination,rel);
    if(item.isDirectory()){await fs.mkdir(to,{recursive:true});await copy(from,rel);}
    else await fs.copyFile(from,to);
  }
}
await copy(root);
const checks=[];
for(const name of (await fs.readdir(path.join(root,'artifacts'))).sort()){
  if(!/\.(zip|msi)$/.test(name))continue;
  const data=await fs.readFile(path.join(root,'artifacts',name));
  checks.push(crypto.createHash('sha256').update(data).digest('hex')+'  '+name);
}
await fs.writeFile(path.join(root,'artifacts/SHA256SUMS.txt'),checks.join('\n')+'\n');
console.log('Source tree staged and deliverable checksums updated.');

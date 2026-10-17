import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'ui/package.json'),'utf8'));
const executable=path.resolve(root,process.argv[2] ?? `artifacts/${version}/app/LocalVault.Bridge.exe`);
const identity=JSON.parse(await fs.readFile(path.join(root,'browser-identity.json'),'utf8'));
async function invoke(args,input){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const output=[],errors=[];
    const timer=setTimeout(()=>{child.kill();reject(new Error('Bridge check timed out'));},15000);
    child.stdout.on('data',data=>output.push(data));child.stderr.on('data',data=>errors.push(data));
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output:Buffer.concat(output),errors:Buffer.concat(errors)});});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
const invalid=await invoke(['chrome-extension://untrusted/'],Buffer.alloc(0));
assert.equal(invalid.code,1);assert.equal(invalid.output.length,0);assert.equal(invalid.errors.length,0);
console.log('PASS Reject unrecognized native caller without plaintext diagnostics');
const origin=`chrome-extension://${identity.chromiumId}/`;
const huge=Buffer.alloc(4);huge.writeUInt32LE(128*1024+1);
const oversized=await invoke([origin],huge);assert.equal(oversized.code,1);assert.equal(oversized.output.length,0);
console.log('PASS Reject oversized real native input frame');
const body=Buffer.from(JSON.stringify({version:1,id:'fixture-status',operation:'status',token:'A'.repeat(64),client:'spoofed'}));
const length=Buffer.alloc(4);length.writeUInt32LE(body.length);
const status=await invoke([origin],Buffer.concat([length,body]));
assert.equal(status.code,0);assert.equal(status.errors.length,0);assert.equal(status.output.readUInt32LE(0),status.output.length-4);
const response=JSON.parse(status.output.subarray(4));assert.equal(response.id,'fixture-status');assert.equal(response.version,1);assert.equal(response.ok,false);
console.log('PASS Real native binary emits a framed denial for unavailable/unpaired desktop');

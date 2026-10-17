import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'ui/package.json'),'utf8'));
const app=path.resolve(root,process.argv[2] ?? `artifacts/${version}/app`);
const identity=JSON.parse(await fs.readFile(path.join(root,'browser-identity.json'),'utf8'));
await fs.mkdir(app,{recursive:true});
await fs.cp(path.join(root,'extensions/dist'),path.join(app,'extensions'),{recursive:true});
for(const name of ['README.md','DESIGN.md','SECURITY.md','ACCEPTANCE.md','THIRD-PARTY-NOTICES.md','RELEASE-NOTES.md']) await fs.copyFile(path.join(root,name),path.join(app,name));
await fs.cp(path.join(root,'licenses'),path.join(app,'licenses'),{recursive:true});
try { await fs.copyFile(path.join(root,'VALIDATION.md'),path.join(app,'VALIDATION.md')); }
catch(error) { if(error.code!=='ENOENT')throw error; }
for(const browser of ['chrome','edge','firefox']){
  const host={name:'com.localvault.bridge',description:'LocalVault desktop connection',path:'LocalVault.Bridge.exe',type:'stdio',
    ...(browser==='firefox'?{allowed_extensions:[identity.firefoxId]}:{allowed_origins:[`chrome-extension://${identity.chromiumId}/`]})};
  await fs.writeFile(path.join(app,`${browser}-host.json`),JSON.stringify(host,null,2));
}
const xml=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const id=value=>'X'+crypto.createHash('sha256').update(value).digest('hex').slice(0,24);
const guid=value=>{
  const hex=crypto.createHash('sha256').update('LocalVault/v1/'+value).digest('hex').slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const components=[];
async function directory(folder,relative=''){
  const cleanup=id('cleanup:'+relative);components.push(cleanup);
  let content=`<Component Id="${cleanup}" Guid="*"><RemoveFolder Id="${id('remove:'+relative)}" On="uninstall"/><RegistryValue Root="HKCU" Key="Software\\LocalVault\\Folders" Name="${cleanup}" Type="integer" Value="1" KeyPath="yes"/></Component>`;
  for(const name of (await fs.readdir(folder)).sort()){
    const source=path.join(folder,name);const rel=path.join(relative,name);const stat=await fs.stat(source);
    if(stat.isDirectory())content+=`<Directory Id="${id('dir:'+rel)}" Name="${xml(name)}">${await directory(source,rel)}</Directory>`;
    else if(!name.endsWith('.pdb')){
      const component=id('component:'+rel);components.push(component);
      content+=`<Component Id="${component}" Guid="${guid(rel)}"><File Id="${id('file:'+rel)}" Source="${xml(source)}"/><RegistryValue Root="HKCU" Key="Software\\LocalVault\\Files" Name="${component}" Type="integer" Value="1" KeyPath="yes"/></Component>`;
    }
  }
  return content;
}
const tree=await directory(app);
const registry=['Google\\Chrome','Microsoft\\Edge','Mozilla'].map((key,index)=>{
  const browser=['chrome','edge','firefox'][index];
  return `<RegistryValue Root="HKCU" Key="Software\\${key}\\NativeMessagingHosts\\com.localvault.bridge" Type="string" Value="[INSTALLFOLDER]${browser}-host.json" />`;
}).join('');
const wxs=`<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
<Package Name="LocalVault Private Beta" Manufacturer="LocalVault" Version="${version}" UpgradeCode="4E2E6377-7F0E-423A-A263-5F5E8F5F9C29" Scope="perUser" InstallerVersion="500">
<Icon Id="AppIcon" SourceFile="${xml(path.join(root,'src/LocalVault.Desktop/app.ico'))}"/><Property Id="ARPPRODUCTICON" Value="AppIcon"/>
<MajorUpgrade Schedule="afterInstallInitialize" DowngradeErrorMessage="A newer LocalVault version is already installed."/><MediaTemplate EmbedCab="yes" />
<Property Id="WINDOWSBUILD"><RegistrySearch Id="WindowsBuildNumber" Root="HKLM" Key="SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" Name="CurrentBuildNumber" Type="raw" Bitness="always64"/></Property>
<Launch Condition="Installed OR WINDOWSBUILD &gt;= 22000" Message="LocalVault requires Windows 11 (build 22000 or newer)."/>
<StandardDirectory Id="LocalAppDataFolder"><Directory Id="LocalPrograms" Name="Programs"><Directory Id="INSTALLFOLDER" Name="LocalVault">${tree}
<Component Id="BrowserRegistration" Guid="*">${registry}<RegistryValue Root="HKCU" Key="Software\\LocalVault" Name="Installed" Type="integer" Value="1" KeyPath="yes"/></Component>
</Directory></Directory></StandardDirectory>
<StandardDirectory Id="ProgramMenuFolder"><Directory Id="MenuFolder" Name="LocalVault"><Component Id="StartMenuShortcut" Guid="*">
<Shortcut Id="StartLocalVault" Name="LocalVault" Target="[INSTALLFOLDER]LocalVault.exe" WorkingDirectory="INSTALLFOLDER"/>
<Shortcut Id="LocalVaultGuide" Name="LocalVault setup guide" Target="[INSTALLFOLDER]README.md" WorkingDirectory="INSTALLFOLDER"/>
<RemoveFolder Id="RemoveMenuFolder" On="uninstall"/><RegistryValue Root="HKCU" Key="Software\\LocalVault" Name="Menu" Type="integer" Value="1" KeyPath="yes"/>
</Component></Directory></StandardDirectory>
<Feature Id="Main" Title="LocalVault" Level="1">${components.map(component=>`<ComponentRef Id="${component}"/>`).join('')}<ComponentRef Id="BrowserRegistration"/><ComponentRef Id="StartMenuShortcut"/></Feature>
</Package></Wix>`;
await fs.writeFile(path.join(root,'artifacts/installer.wxs'),wxs);
console.log(`Prepared installer with ${components.length} files and per-user browser host registrations.`);

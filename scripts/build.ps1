param([string]$Dotnet = 'dotnet', [switch]$SkipInstaller, [switch]$SkipNuGetAudit, [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$version = ([xml](Get-Content 'Directory.Build.props' -Raw)).Project.PropertyGroup.Version
$uiVersion = (Get-Content 'ui/package.json' -Raw | ConvertFrom-Json).version
$extensionVersion = (Get-Content 'extensions/package.json' -Raw | ConvertFrom-Json).version
if ($uiVersion -ne $version -or $extensionVersion -ne $version) { throw 'Desktop, UI and extension versions must match' }
$publishDirectory = [IO.Path]::GetFullPath((Join-Path $root "artifacts/$version/app"))
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_ROLL_FORWARD = 'LatestMajor'
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
Push-Location extensions
try {
    if (!$SkipInstall) { Invoke-Checked 'npm.cmd' @('ci', '--no-audit', '--no-fund') }
    Invoke-Checked 'npm.cmd' @('run', 'build')
    Invoke-Checked 'npm.cmd' @('test')
} finally { Pop-Location }
Push-Location ui
try {
    if (!$SkipInstall) { Invoke-Checked 'npm.cmd' @('ci', '--no-audit', '--no-fund') }
    Invoke-Checked 'npm.cmd' @('run', 'build')
    Invoke-Checked 'npm.cmd' @('test')
} finally { Pop-Location }
$projects = @('src/LocalVault.Core/LocalVault.Core.csproj','src/LocalVault.Bridge/LocalVault.Bridge.csproj','src/LocalVault.Desktop/LocalVault.Desktop.csproj','tests/LocalVault.Tests/LocalVault.Tests.csproj')
foreach ($project in $projects) {
    $restore = @('restore',$project,'--locked-mode')
    if ($SkipNuGetAudit) { $restore += '-p:NuGetAudit=false' }
    Invoke-Checked $Dotnet $restore
}
Invoke-Checked $Dotnet @('run','--project','tests/LocalVault.Tests','-c','Release','--no-restore')
Invoke-Checked $Dotnet @('publish','src/LocalVault.Desktop','-c','Release','-r','win-x64','--self-contained','true','--no-restore','-p:PublishSingleFile=false','-o',$publishDirectory)
Invoke-Checked $Dotnet @('publish','src/LocalVault.Bridge','-c','Release','-r','win-x64','--self-contained','true','--no-restore','-p:PublishSingleFile=false','-o',$publishDirectory)
Invoke-Checked 'node' @('scripts/package.mjs',$publishDirectory)
if (!$SkipInstaller) {
    if (!(Test-Path '.tools/wix.exe')) {
        Invoke-Checked $Dotnet @('tool','install','wix','--version','6.0.2','--tool-path','.tools','--allow-roll-forward')
    }
    Invoke-Checked (Join-Path $root '.tools/wix.exe') @('build','artifacts/installer.wxs','-arch','x64','-o',"artifacts/LocalVault-$version-win-x64.msi")
}
Write-Output 'Build complete. See artifacts/ for the app and installer. These beta binaries are not code-signed.'

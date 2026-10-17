param([string]$Path, [string]$ExpectedVersion = ([xml](Get-Content (Join-Path $PSScriptRoot '../Directory.Build.props') -Raw)).Project.PropertyGroup.Version)
if (!$Path) { $Path = Join-Path $PSScriptRoot "../artifacts/LocalVault-$ExpectedVersion-win-x64.msi" }
$ErrorActionPreference = 'Stop'
$resolved = [IO.Path]::GetFullPath($Path)
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($resolved, 0)
function Rows([string]$Sql, [int]$Columns) {
    $view = $database.OpenView($Sql)
    [void]$view.Execute()
    while ($record = $view.Fetch()) {
        $result = @()
        for ($index = 1; $index -le $Columns; $index++) { $result += $record.StringData($index) }
        Write-Output -NoEnumerate $result
    }
    [void]$view.Close()
}
function Check([bool]$Condition, [string]$Description) {
    if (!$Condition) { throw "FAILED: $Description" }
    Write-Output "PASS $Description"
}
$properties = @{}
Rows 'SELECT `Property`, `Value` FROM `Property`' 2 | ForEach-Object { $properties[$_[0]] = $_[1] }
Check ($properties['ProductVersion'] -eq $ExpectedVersion) 'MSI product version'
Check ($properties['ALLUSERS'] -ne '1') 'MSI is not a per-machine installation'
$registry = @(Rows 'SELECT `Root`, `Key`, `Value` FROM `Registry`' 3)
Check (@($registry | Where-Object { $_[0] -ne '1' }).Count -eq 0) 'Every installed registry entry uses HKCU'
foreach ($browser in @(@('Google\Chrome','chrome'),@('Microsoft\Edge','edge'),@('Mozilla','firefox'))) {
    $key = 'Software\' + $browser[0] + '\NativeMessagingHosts\com.localvault.bridge'
    Check (@($registry | Where-Object { $_[1] -eq $key -and $_[2] -eq ('[INSTALLFOLDER]' + $browser[1] + '-host.json') }).Count -eq 1) ('Native host registration: ' + $browser[1])
}
$files = @(Rows 'SELECT `FileName` FROM `File`' 1)
Check (@($files | Where-Object { $_[0] -match '\.(lvault|csv|previous)$' }).Count -eq 0) 'Installer contains no vault or CSV data'
Check (@($files | Where-Object { $_[0] -match 'LocalVault\.Bridge\.exe$' }).Count -eq 1) 'Native bridge is packaged'
Check (@($files | Where-Object { $_[0] -match 'LocalVault\.exe$' }).Count -eq 1) 'Desktop executable is packaged'
Write-Output ('Inspected ' + $files.Count + ' MSI files without installing or changing registrations.')

Check ($properties['UpgradeCode'] -eq '{4E2E6377-7F0E-423A-A263-5F5E8F5F9C29}') 'Stable upgrade family'
$sequence = @{}
Rows 'SELECT `Action`, `Sequence` FROM `InstallExecuteSequence`' 2 | ForEach-Object { $sequence[$_[0]] = [int]$_[1] }
Check ($sequence['RemoveExistingProducts'] -gt $sequence['InstallInitialize'] -and $sequence['RemoveExistingProducts'] -lt $sequence['InstallFinalize']) 'Upgrade removal is inside the rollback transaction'
$upgrades = @(Rows 'SELECT `UpgradeCode`, `VersionMax`, `Attributes` FROM `Upgrade`' 3)
Check (@($upgrades | Where-Object { $_[0] -eq $properties['UpgradeCode'] -and $_[1] -eq $ExpectedVersion }).Count -gt 0) 'Previous versions are detected for upgrade'

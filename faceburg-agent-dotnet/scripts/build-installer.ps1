param(
  [string]$IconPath = "C:\SistemaDeVendas\BackupAccess\OneDrive\rbs\logo\logorbs.ico"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dotnet = "C:\Program Files\dotnet\dotnet.exe"
$agentProject = Join-Path $root "src\Faceburg.LocalAgent\Faceburg.LocalAgent.csproj"
$agentDist = Join-Path $root "dist"
$installerProject = Join-Path $root "installer\RbsAgent.Installer\RbsAgent.Installer.csproj"
$installerRoot = Split-Path -Parent $installerProject
$installerPayload = Join-Path $installerRoot "Payload\rbsAgent-payload.zip"
$installerAssets = Join-Path $installerRoot "Assets"
$installerOutput = Join-Path $root "installer\dist"

if (!(Test-Path $dotnet)) {
  $dotnet = "dotnet"
}

if (!(Test-Path $IconPath)) {
  throw "Icone nao encontrado: $IconPath"
}

Get-Process -Name Faceburg.LocalAgent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "name='node.exe' OR name='chrome.exe' OR name='msedge.exe'" |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine.Contains("faceburg-agent-dotnet\dist\whatsapp-sidecar") -or
      $_.CommandLine.Contains("Faceburg\LocalAgent\whatsapp-auth")
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $agentDist) {
  Remove-Item -LiteralPath $agentDist -Recurse -Force
}

& $dotnet publish $agentProject -c Release -r win-x64 --self-contained true -o $agentDist

$sidecar = Join-Path $agentDist "whatsapp-sidecar"
if (Test-Path (Join-Path $sidecar "package.json")) {
  npm install --omit=dev --prefix $sidecar
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodeDir = Join-Path $agentDist "node"
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $nodeDir "node.exe") -Force
} else {
  Write-Warning "node.exe nao encontrado. O WhatsApp exigira Node instalado no computador de destino."
}

Copy-Item -LiteralPath $IconPath -Destination (Join-Path $agentDist "logorbs.ico") -Force
New-Item -ItemType Directory -Path $installerAssets -Force | Out-Null
Copy-Item -LiteralPath $IconPath -Destination (Join-Path $installerAssets "logorbs.ico") -Force

New-Item -ItemType Directory -Path (Split-Path -Parent $installerPayload) -Force | Out-Null
if (Test-Path $installerPayload) {
  Remove-Item -LiteralPath $installerPayload -Force
}
Compress-Archive -Path (Join-Path $agentDist "*") -DestinationPath $installerPayload -CompressionLevel Optimal

if (Test-Path $installerOutput) {
  Remove-Item -LiteralPath $installerOutput -Recurse -Force
}

& $dotnet publish $installerProject `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -p:DebugType=None `
  -p:DebugSymbols=false `
  -o $installerOutput

$setup = Join-Path $installerOutput "rbsAgent-Setup.exe"
if (!(Test-Path $setup)) {
  throw "Instalador nao encontrado em: $setup"
}

$sizeMb = [math]::Round((Get-Item $setup).Length / 1MB, 2)
Write-Host "Instalador criado: $setup"
Write-Host "Tamanho: $sizeMb MB"

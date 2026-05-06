$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dotnet = "C:\Program Files\dotnet\dotnet.exe"
$project = Join-Path $root "src\Faceburg.LocalAgent\Faceburg.LocalAgent.csproj"
$out = Join-Path $root "dist"
$resolvedRoot = [System.IO.Path]::GetFullPath($root)
$resolvedOut = [System.IO.Path]::GetFullPath($out)

if (!(Test-Path $dotnet)) {
  $dotnet = "dotnet"
}

if (!$resolvedOut.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Pasta de saida fora do projeto: $resolvedOut"
}

if (Test-Path $resolvedOut) {
  Remove-Item -LiteralPath $resolvedOut -Recurse -Force
}

& $dotnet publish $project -c Release -r win-x64 --self-contained true -o $resolvedOut

$sidecar = Join-Path $resolvedOut "whatsapp-sidecar"
if (Test-Path (Join-Path $sidecar "package.json")) {
  npm install --omit=dev --prefix $sidecar
}

Write-Host "Publicado em: $resolvedOut"

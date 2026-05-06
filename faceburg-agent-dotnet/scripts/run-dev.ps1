$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dotnet = "C:\Program Files\dotnet\dotnet.exe"
$project = Join-Path $root "src\Faceburg.LocalAgent\Faceburg.LocalAgent.csproj"

if (!(Test-Path $dotnet)) {
  $dotnet = "dotnet"
}

& $dotnet run --project $project

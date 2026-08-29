$ErrorActionPreference = "Stop"

$otpRoot = $PSScriptRoot
$dataRoot = (Resolve-Path (Join-Path $otpRoot "data")).Path
$buildConfig = (Resolve-Path (Join-Path $otpRoot "build-config.json")).Path
$routerConfig = (Resolve-Path (Join-Path $otpRoot "router-config.json")).Path

if (-not (Test-Path -LiteralPath (Join-Path $dataRoot "gtfs_trtc.zip"))) {
  throw "data/gtfs_trtc.zip is missing. Run fetch-data.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $dataRoot "gtfs_tdx_double_taipei.zip"))) {
  throw "data/gtfs_tdx_double_taipei.zip is missing. Run fetch-data.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $dataRoot "taiwan-latest.osm.pbf"))) {
  throw "data/taiwan-latest.osm.pbf is missing. Run fetch-data.ps1 first."
}

docker run --rm `
  --mount "type=bind,source=$dataRoot,target=/var/opentripplanner" `
  --mount "type=bind,source=$buildConfig,target=/var/opentripplanner/build-config.json,readonly" `
  --mount "type=bind,source=$routerConfig,target=/var/opentripplanner/router-config.json,readonly" `
  opentripplanner/opentripplanner:2.9.0 --build --save

if ($LASTEXITCODE -ne 0) {
  throw "OTP graph build failed with exit code $LASTEXITCODE."
}

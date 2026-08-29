param(
  [switch]$Force,
  [string]$TaipeiBusGtfsUrl = $env:TDX_GTFS_TAIPEI_BUS_URL,
  [string]$NewTaipeiBusGtfsUrl = $env:TDX_GTFS_NEWTAIPEI_BUS_URL
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$otpRoot = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $otpRoot "..\..")).Path
$dataRoot = Join-Path $otpRoot "data"
$envFile = Join-Path $projectRoot ".env.local"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw ".env.local was not found. Configure TDX_CLIENT_ID and TDX_CLIENT_SECRET first."
}

$settings = @{}
Get-Content -Encoding utf8 -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    $settings[$matches[1].Trim()] = $matches[2].Trim()
  }
}

if (-not $settings["TDX_CLIENT_ID"] -or -not $settings["TDX_CLIENT_SECRET"]) {
  throw ".env.local is missing TDX_CLIENT_ID or TDX_CLIENT_SECRET."
}

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null

$token = Invoke-RestMethod -Method Post -Uri "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token" -Body @{
  grant_type = "client_credentials"
  client_id = $settings["TDX_CLIENT_ID"]
  client_secret = $settings["TDX_CLIENT_SECRET"]
} -ContentType "application/x-www-form-urlencoded"
$tdxHeaders = @{ Authorization = "Bearer $($token.access_token)" }

function Save-RemoteFile {
  param(
    [Parameter(Mandatory)] [string]$Uri,
    [Parameter(Mandatory)] [string]$Destination,
    [hashtable]$Headers = @{}
  )

  if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    Write-Host "Keeping existing file: $([System.IO.Path]::GetFileName($Destination))"
    return
  }

  $partial = "$Destination.part"
  Invoke-WebRequest -Method Get -Uri $Uri -Headers $Headers -OutFile $partial
  $download = Get-Item -LiteralPath $partial
  if ($download.Length -lt 1024) {
    throw "Downloaded file is too small; existing data was not replaced: $($download.Name)"
  }
  Move-Item -LiteralPath $partial -Destination $Destination -Force
  Write-Host "Downloaded $([System.IO.Path]::GetFileName($Destination)) ($((Get-Item -LiteralPath $Destination).Length) bytes)"
}

Save-RemoteFile -Uri "https://tdx.transportdata.tw/api/gtfs/V3/Map/GTFS/Static/Rail/TRTC" -Destination (Join-Path $dataRoot "gtfs_trtc.zip") -Headers $tdxHeaders
Save-RemoteFile -Uri "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf" -Destination (Join-Path $dataRoot "taiwan-latest.osm.pbf")

if ($TaipeiBusGtfsUrl) {
  Save-RemoteFile -Uri $TaipeiBusGtfsUrl -Destination (Join-Path $dataRoot "gtfs_bus_taipei.zip") -Headers $tdxHeaders
} else {
  Write-Host "TDX_GTFS_TAIPEI_BUS_URL is not set; Taipei bus schedules are not included."
}

if ($NewTaipeiBusGtfsUrl) {
  Save-RemoteFile -Uri $NewTaipeiBusGtfsUrl -Destination (Join-Path $dataRoot "gtfs_bus_newtaipei.zip") -Headers $tdxHeaders
} else {
  Write-Host "TDX_GTFS_NEWTAIPEI_BUS_URL is not set; New Taipei bus schedules are not included."
}

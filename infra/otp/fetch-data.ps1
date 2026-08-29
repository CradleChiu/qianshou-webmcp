param(
  [switch]$Force,
  [switch]$KeepNationalArchive,
  [ValidateRange(1, 6)] [int]$DownloadAttempts = 4,
  [string]$NationalGtfsUrl = $(
    if ($env:TDX_GTFS_NATIONAL_URL) {
      $env:TDX_GTFS_NATIONAL_URL
    } else {
      "https://tdx.transportdata.tw/api/gtfs/V3/Map/GTFS/Static"
    }
  )
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$otpRoot = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $otpRoot "..\..")).Path
$dataRoot = Join-Path $otpRoot "data"
$envFile = Join-Path $projectRoot ".env.local"
$filterScript = Join-Path $otpRoot "filter-double-taipei-bus-gtfs.ps1"

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

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$token = Invoke-RestMethod -Method Post -Uri "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token" -Body @{
  grant_type = "client_credentials"
  client_id = $settings["TDX_CLIENT_ID"]
  client_secret = $settings["TDX_CLIENT_SECRET"]
} -ContentType "application/x-www-form-urlencoded"
$tdxHeaders = @{ Authorization = "Bearer $($token.access_token)" }

function Assert-RemoteFile {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [long]$MinimumBytes = 1024,
    [string[]]$RequiredZipEntries = @()
  )

  $download = Get-Item -LiteralPath $Path
  if ($download.Length -lt $MinimumBytes) {
    throw "Downloaded file is too small: $($download.Length) bytes."
  }

  if ($RequiredZipEntries.Count -eq 0) {
    return
  }

  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    foreach ($entryName in $RequiredZipEntries) {
      if ($null -eq $archive.GetEntry($entryName)) {
        throw "Downloaded archive is missing $entryName."
      }
    }
  }
  finally {
    if ($null -ne $archive) { $archive.Dispose() }
  }
}

function Save-RemoteFile {
  param(
    [Parameter(Mandatory)] [string]$Uri,
    [Parameter(Mandatory)] [string]$Destination,
    [hashtable]$Headers = @{},
    [long]$MinimumBytes = 1024,
    [string[]]$RequiredZipEntries = @()
  )

  if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    Assert-RemoteFile `
      -Path $Destination `
      -MinimumBytes $MinimumBytes `
      -RequiredZipEntries $RequiredZipEntries
    Write-Host "Keeping existing file: $([System.IO.Path]::GetFileName($Destination))"
    return
  }

  $partial = "$Destination.part"
  for ($attempt = 1; $attempt -le $DownloadAttempts; $attempt++) {
    if (Test-Path -LiteralPath $partial) {
      Remove-Item -LiteralPath $partial -Force
    }

    try {
      Write-Host "Downloading $([System.IO.Path]::GetFileName($Destination)) (attempt $attempt/$DownloadAttempts)..."
      Invoke-WebRequest -Method Get -Uri $Uri -Headers $Headers -OutFile $partial
      Assert-RemoteFile `
        -Path $partial `
        -MinimumBytes $MinimumBytes `
        -RequiredZipEntries $RequiredZipEntries

      Move-Item -LiteralPath $partial -Destination $Destination -Force
      Write-Host "Downloaded $([System.IO.Path]::GetFileName($Destination)) ($((Get-Item -LiteralPath $Destination).Length) bytes)"
      return
    }
    catch {
      if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Force
      }
      if ($attempt -eq $DownloadAttempts) {
        throw "Failed to download $Uri after $DownloadAttempts attempts: $($_.Exception.Message)"
      }
      $delaySeconds = @(10, 30, 60, 120, 180)[$attempt - 1]
      Write-Warning "Download attempt $attempt failed: $($_.Exception.Message). Retrying in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

Save-RemoteFile `
  -Uri "https://tdx.transportdata.tw/api/gtfs/V3/Map/GTFS/Static/Rail/TRTC" `
  -Destination (Join-Path $dataRoot "gtfs_trtc.zip") `
  -Headers $tdxHeaders `
  -MinimumBytes 100000 `
  -RequiredZipEntries @("agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt")
Save-RemoteFile `
  -Uri "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf" `
  -Destination (Join-Path $dataRoot "taiwan-latest.osm.pbf") `
  -MinimumBytes 10000000

$doubleTaipeiGtfs = Join-Path $dataRoot "gtfs_tdx_double_taipei.zip"
$nationalArchive = Join-Path $dataRoot "tdx-national-static.zip"

if ((Test-Path -LiteralPath $doubleTaipeiGtfs) -and -not $Force) {
  Assert-RemoteFile `
    -Path $doubleTaipeiGtfs `
    -MinimumBytes 1000000 `
    -RequiredZipEntries @("agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt", "calendar.txt")
  Write-Host "Keeping existing file: $([System.IO.Path]::GetFileName($doubleTaipeiGtfs))"
} else {
  Save-RemoteFile `
    -Uri $NationalGtfsUrl `
    -Destination $nationalArchive `
    -Headers $tdxHeaders `
    -MinimumBytes 10000000 `
    -RequiredZipEntries @("agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt", "calendar.txt")

  & $filterScript `
    -SourceArchive $nationalArchive `
    -DestinationArchive $doubleTaipeiGtfs `
    -Force

  if (-not $KeepNationalArchive) {
    Remove-Item -LiteralPath $nationalArchive -Force
    Write-Host "Removed the national source archive after filtering; rerun with -KeepNationalArchive to retain it."
  }
}

[CmdletBinding()]
param(
  [ValidateRange(0.01, 0.2)] [double]$MarginDegrees = 0.05,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$otpRoot = $PSScriptRoot
$dataRoot = (Resolve-Path (Join-Path $otpRoot "data")).Path
$sourcePath = Join-Path $dataRoot "taiwan-latest.osm.pbf"
$destinationPath = Join-Path $dataRoot "double-taipei.osm.pbf"
$partialPath = Join-Path $dataRoot "double-taipei.osm.part.pbf"
$gtfsPaths = @(
  (Join-Path $dataRoot "gtfs_tdx_double_taipei.zip"),
  (Join-Path $dataRoot "gtfs_trtc.zip")
)

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "data/taiwan-latest.osm.pbf is missing. Run fetch-data.ps1 first."
}
foreach ($gtfsPath in $gtfsPaths) {
  if (-not (Test-Path -LiteralPath $gtfsPath -PathType Leaf)) {
    throw "GTFS archive is missing: $gtfsPath"
  }
}
if ((Test-Path -LiteralPath $destinationPath) -and -not $Force) {
  Write-Host "Keeping existing file: $([System.IO.Path]::GetFileName($destinationPath))"
  exit 0
}

$culture = [System.Globalization.CultureInfo]::InvariantCulture
$minimumLatitude = [double]::PositiveInfinity
$maximumLatitude = [double]::NegativeInfinity
$minimumLongitude = [double]::PositiveInfinity
$maximumLongitude = [double]::NegativeInfinity
$stopCount = 0

foreach ($gtfsPath in $gtfsPaths) {
  $archive = $null
  $reader = $null
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($gtfsPath)
    $entry = $archive.GetEntry("stops.txt")
    if ($null -eq $entry) {
      throw "$gtfsPath does not contain stops.txt."
    }
    $reader = [System.IO.StreamReader]::new(
      $entry.Open(),
      [System.Text.Encoding]::UTF8,
      $true
    )
    $header = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($header)) {
      throw "$gtfsPath has an empty stops.txt."
    }
    $columns = $header.Split(",")
    if (-not ($columns -contains "stop_lat") -or -not ($columns -contains "stop_lon")) {
      throw "$gtfsPath stops.txt is missing stop_lat or stop_lon."
    }

    while (($line = $reader.ReadLine()) -ne $null) {
      $row = $line | ConvertFrom-Csv -Header $columns
      $latitude = [double]::Parse($row.stop_lat, $culture)
      $longitude = [double]::Parse($row.stop_lon, $culture)
      if ($latitude -lt 20 -or $latitude -gt 27 -or $longitude -lt 118 -or $longitude -gt 123) {
        throw "Unexpected GTFS coordinate: $latitude,$longitude"
      }
      $minimumLatitude = [Math]::Min($minimumLatitude, $latitude)
      $maximumLatitude = [Math]::Max($maximumLatitude, $latitude)
      $minimumLongitude = [Math]::Min($minimumLongitude, $longitude)
      $maximumLongitude = [Math]::Max($maximumLongitude, $longitude)
      $stopCount++
    }
  }
  finally {
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $archive) { $archive.Dispose() }
  }
}

if ($stopCount -lt 1) {
  throw "No GTFS stops were found."
}

$minimumLongitude -= $MarginDegrees
$minimumLatitude -= $MarginDegrees
$maximumLongitude += $MarginDegrees
$maximumLatitude += $MarginDegrees
$bbox = @(
  $minimumLongitude.ToString("0.######", $culture),
  $minimumLatitude.ToString("0.######", $culture),
  $maximumLongitude.ToString("0.######", $culture),
  $maximumLatitude.ToString("0.######", $culture)
) -join ","

$imageName = "openai-webmcp-osmium:bookworm"
$toolRoot = Join-Path $otpRoot "osmium"
docker build --tag $imageName $toolRoot
if ($LASTEXITCODE -ne 0) {
  throw "Failed to build the osmium-tool image."
}

if (Test-Path -LiteralPath $partialPath) {
  Remove-Item -LiteralPath $partialPath -Force
}

Write-Host "Cropping OpenStreetMap to GTFS bounds plus $MarginDegrees degree margin: $bbox"
docker run --rm `
  --mount "type=bind,source=$dataRoot,target=/data" `
  $imageName `
  extract `
  --bbox $bbox `
  --strategy complete_ways `
  --overwrite `
  /data/taiwan-latest.osm.pbf `
  --output /data/double-taipei.osm.part.pbf

if ($LASTEXITCODE -ne 0) {
  if (Test-Path -LiteralPath $partialPath) {
    Remove-Item -LiteralPath $partialPath -Force
  }
  throw "OpenStreetMap crop failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $partialPath -PathType Leaf)) {
  throw "OpenStreetMap crop did not produce an output file."
}
$partial = Get-Item -LiteralPath $partialPath
if ($partial.Length -lt 1000000) {
  Remove-Item -LiteralPath $partialPath -Force
  throw "Cropped OpenStreetMap file is unexpectedly small: $($partial.Length) bytes."
}

Move-Item -LiteralPath $partialPath -Destination $destinationPath -Force
$destination = Get-Item -LiteralPath $destinationPath
Write-Host "Created $($destination.Name) with $stopCount GTFS stop rows ($($destination.Length) bytes)."

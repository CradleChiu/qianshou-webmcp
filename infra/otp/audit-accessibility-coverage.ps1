[CmdletBinding()]
param(
  [string]$DataDirectory = (Join-Path $PSScriptRoot "data")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-GtfsCsvEntry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$EntryName
  )

  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entry = $archive.GetEntry($EntryName)
    if ($null -eq $entry) { return @() }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
      $content = $reader.ReadToEnd()
      if ([string]::IsNullOrWhiteSpace($content)) { return @() }
      return @($content | ConvertFrom-Csv)
    }
    finally {
      $reader.Dispose()
    }
  }
  finally {
    $archive.Dispose()
  }
}

function Get-GtfsEntryNames {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
  )

  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    return @($archive.Entries | ForEach-Object { $_.FullName })
  }
  finally {
    $archive.Dispose()
  }
}

function Get-EnumCoverage {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Records,
    [Parameter(Mandatory = $true)]
    [string]$FieldName
  )

  $total = $Records.Count
  $fieldPresent =
    $total -gt 0 -and
    $Records[0].PSObject.Properties.Name -contains $FieldName
  $counts = [ordered]@{}

  if ($fieldPresent) {
    foreach ($group in ($Records | Group-Object -Property $FieldName | Sort-Object Name)) {
      $key = if ([string]::IsNullOrWhiteSpace($group.Name)) { "empty" } else { $group.Name }
      $counts[$key] = $group.Count
    }
  }

  $known = if ($fieldPresent) {
    @($Records | Where-Object { $_.$FieldName -in @("1", "2") }).Count
  }
  else {
    0
  }
  $unknown = $total - $known
  $coveragePercent = if ($total -gt 0) {
    [math]::Round(($known * 100.0) / $total, 1)
  }
  else {
    0.0
  }

  return [ordered]@{
    field = $FieldName
    fieldPresent = $fieldPresent
    total = $total
    known = $known
    unknown = $unknown
    knownCoveragePercent = $coveragePercent
    values = $counts
  }
}

function Get-GtfsCoverage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
  )

  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "GTFS archive not found: $ArchivePath"
  }

  $archiveItem = Get-Item -LiteralPath $ArchivePath
  $entryNames = @(Get-GtfsEntryNames -ArchivePath $ArchivePath)
  $stops = @(Read-GtfsCsvEntry -ArchivePath $ArchivePath -EntryName "stops.txt")
  $trips = @(Read-GtfsCsvEntry -ArchivePath $ArchivePath -EntryName "trips.txt")

  return [ordered]@{
    name = $Name
    file = $archiveItem.Name
    sizeBytes = $archiveItem.Length
    lastModifiedUtc = $archiveItem.LastWriteTimeUtc.ToString("o")
    sha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    files = [ordered]@{
      pathways = $entryNames -contains "pathways.txt"
      levels = $entryNames -contains "levels.txt"
      shapes = $entryNames -contains "shapes.txt"
      feedInfo = $entryNames -contains "feed_info.txt"
    }
    stops = Get-EnumCoverage -Records $stops -FieldName "wheelchair_boarding"
    trips = Get-EnumCoverage -Records $trips -FieldName "wheelchair_accessible"
  }
}

$resolvedDataDirectory = (Resolve-Path -LiteralPath $DataDirectory).Path
$busArchive = Join-Path $resolvedDataDirectory "gtfs_tdx_double_taipei.zip"
$metroArchive = Join-Path $resolvedDataDirectory "gtfs_trtc.zip"
$osmPath = Join-Path $resolvedDataDirectory "double-taipei.osm.pbf"
$routerConfigPath = Join-Path $PSScriptRoot "router-config.json"

$osm = if (Test-Path -LiteralPath $osmPath -PathType Leaf) {
  $item = Get-Item -LiteralPath $osmPath
  [ordered]@{
    file = $item.Name
    sizeBytes = $item.Length
    lastModifiedUtc = $item.LastWriteTimeUtc.ToString("o")
    sha256 = (Get-FileHash -LiteralPath $osmPath -Algorithm SHA256).Hash.ToLowerInvariant()
    tagCoverageMeasured = $false
    limitation = "The current pipeline does not measure per-segment wheelchair, steps, kerb, incline, surface, smoothness, tactile_paving, or audible_signals tag coverage. Missing values are unknown."
  }
}
else {
  [ordered]@{
    file = "double-taipei.osm.pbf"
    missing = $true
    tagCoverageMeasured = $false
    limitation = "The cropped OpenStreetMap PBF is missing, so street-segment coverage cannot be audited."
  }
}

$routerConfig = Get-Content -Raw -LiteralPath $routerConfigPath | ConvertFrom-Json
$wheelchair = $routerConfig.routingDefaults.wheelchairAccessibility
$accessibilityScoreEnabled =
  $routerConfig.routingDefaults.itineraryFilters.accessibilityScore -eq $true

$report = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  scope = "GTFS and OpenStreetMap inputs used by the current Double Taipei OTP graph"
  datasets = @(
    Get-GtfsCoverage -Name "Double Taipei bus" -ArchivePath $busArchive
    Get-GtfsCoverage -Name "Taipei Metro" -ArchivePath $metroArchive
  )
  openStreetMap = $osm
  otp = [ordered]@{
    unknownTripsAllowed = $wheelchair.trip.onlyConsiderAccessible -eq $false
    unknownStopsAllowed = $wheelchair.stop.onlyConsiderAccessible -eq $false
    unknownElevatorsAllowed = $wheelchair.elevator.onlyConsiderAccessible -eq $false
    accessibilityScoreEnabled = $accessibilityScoreEnabled
    interpretation = "OTP penalizes unknown or known-inaccessible elements, but unknown data remains eligible. This is not proof of an accessible end-to-end route."
  }
}

$report | ConvertTo-Json -Depth 10

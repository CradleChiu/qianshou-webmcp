[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$SourceArchive,
  [Parameter(Mandatory)] [string]$DestinationArchive,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourcePath = [System.IO.Path]::GetFullPath($SourceArchive)
$destinationPath = [System.IO.Path]::GetFullPath($DestinationArchive)

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Source GTFS archive was not found: $sourcePath"
}
if ($sourcePath.Equals($destinationPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Source and destination GTFS archives must be different files."
}
if ((Test-Path -LiteralPath $destinationPath) -and -not $Force) {
  Write-Host "Keeping existing file: $([System.IO.Path]::GetFileName($destinationPath))"
  exit 0
}

$destinationDirectory = Split-Path -Parent $destinationPath
New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null

$requiredFiles = [ordered]@{
  "agency.txt" = 1
  "routes.txt" = 1
  "stops.txt" = 2
  "trips.txt" = 1
  "stop_times.txt" = 2
  "calendar.txt" = 1
}
$optionalFiles = @("calendar_dates.txt", "frequencies.txt")
$prefixes = @("TPE", "NWT")
$partialPath = "$destinationPath.part"

if (Test-Path -LiteralPath $partialPath) {
  Remove-Item -LiteralPath $partialPath -Force
}

$sourceZip = $null
$outputStream = $null
$destinationZip = $null
$counts = [ordered]@{}

try {
  $sourceZip = [System.IO.Compression.ZipFile]::OpenRead($sourcePath)
  $outputStream = [System.IO.File]::Open(
    $partialPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  $destinationZip = [System.IO.Compression.ZipArchive]::new(
    $outputStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $true,
    [System.Text.Encoding]::UTF8
  )

  $files = @($requiredFiles.Keys) + $optionalFiles
  foreach ($fileName in $files) {
    $sourceEntry = $sourceZip.GetEntry($fileName)
    if ($null -eq $sourceEntry) {
      if ($requiredFiles.Contains($fileName)) {
        throw "TDX national GTFS is missing required file: $fileName"
      }
      continue
    }

    $destinationEntry = $destinationZip.CreateEntry(
      $fileName,
      [System.IO.Compression.CompressionLevel]::Optimal
    )
    $sourceReader = [System.IO.StreamReader]::new(
      $sourceEntry.Open(),
      [System.Text.Encoding]::UTF8,
      $true
    )
    $destinationWriter = [System.IO.StreamWriter]::new(
      $destinationEntry.Open(),
      [System.Text.UTF8Encoding]::new($false)
    )

    $count = 0
    try {
      $header = $sourceReader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($header)) {
        throw "$fileName does not contain a header row."
      }
      $destinationWriter.WriteLine($header)

      while (($line = $sourceReader.ReadLine()) -ne $null) {
        foreach ($prefix in $prefixes) {
          if ($line.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            $destinationWriter.WriteLine($line)
            $count++
            break
          }
        }
      }
    }
    finally {
      $destinationWriter.Dispose()
      $sourceReader.Dispose()
    }

    $counts[$fileName] = $count
    if ($requiredFiles.Contains($fileName) -and $count -lt $requiredFiles[$fileName]) {
      throw "$fileName contains only $count Taipei/New Taipei rows."
    }
  }
}
catch {
  if ($null -ne $destinationZip) { $destinationZip.Dispose() }
  if ($null -ne $outputStream) { $outputStream.Dispose() }
  if ($null -ne $sourceZip) { $sourceZip.Dispose() }
  if (Test-Path -LiteralPath $partialPath) {
    Remove-Item -LiteralPath $partialPath -Force
  }
  throw
}
finally {
  if ($null -ne $destinationZip) { $destinationZip.Dispose() }
  if ($null -ne $outputStream) { $outputStream.Dispose() }
  if ($null -ne $sourceZip) { $sourceZip.Dispose() }
}

$validationZip = $null
try {
  $validationZip = [System.IO.Compression.ZipFile]::OpenRead($partialPath)
  foreach ($fileName in $requiredFiles.Keys) {
    if ($null -eq $validationZip.GetEntry($fileName)) {
      throw "Filtered GTFS is missing required file: $fileName"
    }
  }
}
finally {
  if ($null -ne $validationZip) { $validationZip.Dispose() }
}

Move-Item -LiteralPath $partialPath -Destination $destinationPath -Force
Write-Host "Created $([System.IO.Path]::GetFileName($destinationPath))"
foreach ($item in $counts.GetEnumerator()) {
  Write-Host ("  {0}: {1:N0} rows" -f $item.Key, $item.Value)
}

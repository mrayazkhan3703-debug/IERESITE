param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'recovery-targets.ps1')
$approvedRecoveryTargets = Get-IereRecoveryTargets
. (Join-Path $PSScriptRoot 'backup-operations-policy.ps1')
$approvedBackupOperations = Get-IereBackupOperationsPolicy

function ConvertTo-WindowsArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object Text.StringBuilder
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (2 * $slashes + 1)))
      [void]$builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
    [void]$builder.Append($character)
  }
  if ($slashes -gt 0) { [void]$builder.Append(('\' * (2 * $slashes))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Start-ExternalProcess([string]$FilePath, [string[]]$Arguments, [switch]$RedirectBinary, [string]$OutputPath) {
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Could not start $FilePath." }

  if ($RedirectBinary) {
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $file = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $process.StandardOutput.BaseStream.CopyTo($file) }
    finally { $file.Dispose() }
    $process.WaitForExit()
    $stderr = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
      throw "$FilePath failed with exit code $($process.ExitCode); output redacted."
    }
    return
  }

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  if ($process.ExitCode -ne 0) { throw "$FilePath failed with exit code $($process.ExitCode); output redacted." }
  return $stdout.Trim()
}

function Invoke-Docker([string[]]$Arguments) {
  return Start-ExternalProcess -FilePath 'docker' -Arguments $Arguments
}

function Get-ContainerVolume([string]$ContainerId, [string]$Destination) {
  $template = "{{range .Mounts}}{{if eq .Destination `"$Destination`"}}{{.Name}}{{end}}{{end}}"
  $value = Invoke-Docker @('inspect', '--format', $template, $ContainerId)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "No named Docker volume is mounted at $Destination." }
  return $value
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'Set -OutputDirectory; LOCALAPPDATA is unavailable.' }
  $OutputDirectory = Join-Path $env:LOCALAPPDATA 'IERE\backups'
}
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
if ($outputRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or $outputRoot.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backups must be outside the repository so private data cannot be committed accidentally.'
}
if ($outputRoot.Contains(',')) { throw 'Docker bind-mount paths cannot contain commas; choose another output directory.' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
# One backup per staging directory, including manual invocations. Leave the
# reusable lock filename in place; disposing the handle releases ownership.
$backupLock = [IO.File]::Open((Join-Path $outputRoot '.iere-backup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {

$runningOutput = Invoke-Docker @('compose', '--env-file', 'NUL', '--profile', 'test', 'ps', '--status', 'running', '--services')
$running = @($runningOutput -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($service in @('postgres', 'object-storage', 'web', 'worker')) {
  if ($running -notcontains $service) { throw "Required Compose service '$service' must already be running; no services were changed." }
}

$writerServices = @(Get-IereBackupWriterServices -RunningServices $running)
$postgresId = Invoke-Docker @('compose', '--env-file', 'NUL', '--profile', 'test', 'ps', '-q', 'postgres')
$storageId = Invoke-Docker @('compose', '--env-file', 'NUL', '--profile', 'test', 'ps', '-q', 'object-storage')
$resumeIds = @($storageId)
foreach ($writer in $writerServices) {
  $resumeIds += Invoke-Docker @('compose', '--env-file', 'NUL', '--profile', 'test', 'ps', '-q', $writer)
}
$postgresImage = Invoke-Docker @('inspect', '--format', '{{.Config.Image}}', $postgresId)
$postgresImageId = Invoke-Docker @('inspect', '--format', '{{.Image}}', $postgresId)
$storageImage = Invoke-Docker @('inspect', '--format', '{{.Config.Image}}', $storageId)
$storageImageId = Invoke-Docker @('inspect', '--format', '{{.Image}}', $storageId)
$serverVersionNum = Invoke-Docker @('compose', '--env-file', 'NUL', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SHOW server_version_num"')
if ($serverVersionNum -notmatch '^\d+$') { throw 'Could not read the PostgreSQL server version before backup.' }
$postgresVolume = Get-ContainerVolume $postgresId '/var/lib/postgresql/data'
$storageVolume = Get-ContainerVolume $storageId '/data'
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$backupDirectory = Join-Path $outputRoot "local-$runId"
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$incompleteMarker = Join-Path $backupDirectory 'INCOMPLETE.txt'
Set-Content -LiteralPath $incompleteMarker -Value 'Backup did not finish and pass archive validation.' -Encoding ASCII
$databasePath = Join-Path $backupDirectory 'database.dump'
$storagePath = Join-Path $backupDirectory 'object-storage.tar.gz'
$dockerBackupPath = $backupDirectory.Replace('\', '/')
$startedUtc = [DateTime]::UtcNow.ToString('o')
$servicesStopped = $false

try {
  $servicesStopped = $true
  Invoke-Docker (@('compose', '--env-file', 'NUL', '--profile', 'test', 'stop') + $writerServices) | Out-Null

  Start-ExternalProcess -FilePath 'docker' -Arguments @('compose', '--env-file', 'NUL', 'exec', '-T', 'postgres', 'sh', '-c', 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom') -RedirectBinary -OutputPath $databasePath

  Invoke-Docker @('compose', '--env-file', 'NUL', 'stop', 'object-storage') | Out-Null
  $tarCommand = 'tar -czf /backup/object-storage.tar.gz -C /source .'
  Invoke-Docker @('run', '--rm', '--mount', "type=volume,source=$storageVolume,target=/source,readonly", '--mount', "type=bind,source=$dockerBackupPath,target=/backup", $postgresImage, 'sh', '-c', $tarCommand) | Out-Null

  Invoke-Docker @('run', '--rm', '--mount', "type=bind,source=$dockerBackupPath,target=/backup", $postgresImage, 'sh', '-c', 'pg_restore --list /backup/database.dump >/dev/null && tar -tzf /backup/object-storage.tar.gz >/dev/null') | Out-Null
  $databaseHash = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $storageHash = (Get-FileHash -LiteralPath $storagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest = [ordered]@{
    format = 1
    createdAtUtc = $startedUtc
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    source = 'local-docker-compose'
    approvedRecoveryTargets = $approvedRecoveryTargets
    approvedBackupOperations = $approvedBackupOperations
    images = [ordered]@{ postgresImageRef = $postgresImage; postgresImageId = $postgresImageId; seaweedImageRef = $storageImage; seaweedImageId = $storageImageId }
    database = [ordered]@{ file = 'database.dump'; format = 'PostgreSQL custom archive'; serverVersionNum = $serverVersionNum; sha256 = $databaseHash }
    objectStorage = [ordered]@{ file = 'object-storage.tar.gz'; format = 'SeaweedFS /data volume tar.gz'; sha256 = $storageHash }
    quiescedWriters = $writerServices
    consistency = 'All running known local web/worker/review writers were stopped before the database dump; object storage was stopped while archived. This is not a point-in-time guarantee for external/direct writers.'
    restoreDrill = 'Not yet performed'
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backupDirectory 'manifest.json') -Encoding UTF8
  Remove-Item -LiteralPath $incompleteMarker -Force
  Write-Output "Backup created and archive-validated: $backupDirectory"
}
finally {
  if ($servicesStopped) {
    $restartFailures = @()
    foreach ($containerId in $resumeIds) {
      try { Invoke-Docker @('start', $containerId) | Out-Null }
      catch { $restartFailures += $containerId }
    }
    if ($restartFailures.Count -gt 0) { throw 'One or more existing services failed to restart; operator attention required.' }
    Write-Output 'Restarted only previously running object-storage and writer containers; no dependency migration or recreation.'
  }
}
} finally { $backupLock.Dispose() }

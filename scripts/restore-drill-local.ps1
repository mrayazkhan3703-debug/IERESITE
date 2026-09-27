param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'recovery-targets.ps1')
$approvedRecoveryTargets = Get-IereRecoveryTargets

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

function Invoke-Docker([string[]]$Arguments) {
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = 'docker'
  $startInfo.WorkingDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start Docker.' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  if ($process.ExitCode -ne 0) { throw "Docker command failed ($($process.ExitCode)): $stderr" }
  return $stdout.Trim()
}

$backupPath = [IO.Path]::GetFullPath($BackupDirectory)
$manifestPath = Join-Path $backupPath 'manifest.json'
$incompletePath = Join-Path $backupPath 'INCOMPLETE.txt'
if (Test-Path -LiteralPath $incompletePath) { throw 'The backup is marked INCOMPLETE and cannot be used.' }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'manifest.json is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -ne 1 -or $manifest.source -ne 'local-docker-compose') { throw 'Unsupported backup manifest.' }

$databasePath = Join-Path $backupPath 'database.dump'
$storagePath = Join-Path $backupPath 'object-storage.tar.gz'
foreach ($file in @(@{ Path = $databasePath; Hash = $manifest.database.sha256 }, @{ Path = $storagePath; Hash = $manifest.objectStorage.sha256 })) {
  if (-not (Test-Path -LiteralPath $file.Path -PathType Leaf)) { throw "Backup artifact is missing: $([IO.Path]::GetFileName($file.Path))" }
  $actualHash = (Get-FileHash -LiteralPath $file.Path -Algorithm SHA256).Hash
  if (-not $file.Hash -or $actualHash -ine $file.Hash) { throw "Backup hash verification failed: $([IO.Path]::GetFileName($file.Path))" }
}

$postgresImage = [string]$manifest.images.postgresImageId
$postgresImageRef = [string]$manifest.images.postgresImageRef
$storageImage = [string]$manifest.images.seaweedImageId
if ($postgresImage -notmatch '^sha256:[0-9a-f]{64}$' -or $storageImage -notmatch '^sha256:[0-9a-f]{64}$' -or [string]$manifest.database.serverVersionNum -notmatch '^\d+$') {
  throw 'The manifest is missing database version or local image metadata.'
}
try { Invoke-Docker @('image', 'inspect', $postgresImage) | Out-Null }
catch {
  if ([string]::IsNullOrWhiteSpace($postgresImageRef)) { throw 'The exact PostgreSQL image is unavailable and the manifest has no local image reference.' }
  Invoke-Docker @('image', 'inspect', $postgresImageRef) | Out-Null
  $postgresImage = $postgresImageRef
}
Invoke-Docker @('image', 'inspect', $storageImage) | Out-Null
$sourcePostgresMajor = [int]([string]$manifest.database.serverVersionNum).Substring(0, 2)
$restoreImageVersion = Invoke-Docker @('run', '--rm', '--network', 'none', '--entrypoint', 'postgres', $postgresImage, '--version')
if ($restoreImageVersion -notmatch "\b$sourcePostgresMajor\.") { throw "Restore image PostgreSQL major does not match backup major $sourcePostgresMajor." }

$dockerBackupPath = $backupPath.Replace('\', '/')
$token = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$databaseContainer = "iere-restore-db-$token"
$storageContainer = "iere-restore-objects-$token"
$databaseVolume = "iere-restore-db-$token"
$objectVolume = "iere-restore-objects-$token"
$existingContainersOutput = Invoke-Docker @('ps', '-a', '--format', '{{.Names}}')
$existingVolumesOutput = Invoke-Docker @('volume', 'ls', '--format', '{{.Name}}')
$existingContainers = @($existingContainersOutput -split "`r?`n" | ForEach-Object { $_.Trim() })
$existingVolumes = @($existingVolumesOutput -split "`r?`n" | ForEach-Object { $_.Trim() })
if ($existingContainers -contains $databaseContainer -or $existingContainers -contains $storageContainer -or $existingVolumes -contains $databaseVolume -or $existingVolumes -contains $objectVolume) {
  throw 'A disposable restore resource name already exists; no existing resource was modified.'
}
$runStartedUtc = [DateTime]::UtcNow
$timer = [Diagnostics.Stopwatch]::StartNew()
$databaseVolumeCreated = $false
$objectVolumeCreated = $false
$databaseContainerCreated = $false
$storageContainerCreated = $false
$cleanupFailures = New-Object 'System.Collections.Generic.List[string]'
$result = $null

try {
  $databaseVolume = Invoke-Docker @('volume', 'create', $databaseVolume)
  $databaseVolumeCreated = $true
  $objectVolume = Invoke-Docker @('volume', 'create', $objectVolume)
  $objectVolumeCreated = $true

  Invoke-Docker @('run', '-d', '--name', $databaseContainer, '--network', 'none', '--mount', "type=volume,source=$databaseVolume,target=/var/lib/postgresql/data", '-e', 'POSTGRES_USER=iere_restore', '-e', 'POSTGRES_DB=iere_restore', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', $postgresImage) | Out-Null
  $databaseContainerCreated = $true

  $databaseReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      Invoke-Docker @('exec', $databaseContainer, 'pg_isready', '-U', 'iere_restore', '-d', 'iere_restore') | Out-Null
      $databaseReady = $true
      break
    }
    catch { Start-Sleep -Seconds 2 }
  }
  if (-not $databaseReady) { throw 'Isolated PostgreSQL did not become ready within 120 seconds.' }

  Invoke-Docker @('cp', $databasePath, "${databaseContainer}:/tmp/database.dump") | Out-Null
  Invoke-Docker @('exec', $databaseContainer, 'pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '-U', 'iere_restore', '-d', 'iere_restore', '/tmp/database.dump') | Out-Null
  $databaseCheck = Invoke-Docker @('exec', $databaseContainer, 'psql', '-U', 'iere_restore', '-d', 'iere_restore', '-At', '-c', "SELECT (SELECT count(*) FROM public.`"_prisma_migrations`" ) || '|' || (SELECT count(*) FROM pg_extension WHERE extname IN ('postgis','pg_trgm','vector'));")
  if ($databaseCheck -notmatch '^(\d+)\|(\d+)$') { throw "Unexpected restored database verification result: $databaseCheck" }
  $migrationCount = [int]$Matches[1]
  $extensionCount = [int]$Matches[2]
  if ($migrationCount -lt 1 -or $extensionCount -ne 3) { throw "Restored database check failed (migrations=$migrationCount, expectedExtensions=3, foundExtensions=$extensionCount)." }

  $extractCommand = 'tar -xzf /backup/object-storage.tar.gz -C /restore'
  Invoke-Docker @('run', '--rm', '--network', 'none', '--mount', "type=volume,source=$objectVolume,target=/restore", '--mount', "type=bind,source=$dockerBackupPath,target=/backup,readonly", $postgresImage, 'sh', '-c', $extractCommand) | Out-Null
  Invoke-Docker @('run', '-d', '--name', $storageContainer, '--network', 'none', '--mount', "type=volume,source=$objectVolume,target=/data", $storageImage, 'mini', '-dir=/data') | Out-Null
  $storageContainerCreated = $true

  $storageReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      Invoke-Docker @('exec', $storageContainer, 'curl', '-fsS', 'http://127.0.0.1:8333/healthz') | Out-Null
      $storageReady = $true
      break
    }
    catch { Start-Sleep -Seconds 2 }
  }
  if (-not $storageReady) { throw 'Restored SeaweedFS volume did not serve its local health endpoint within 120 seconds.' }
  $objectFiles = [int](Invoke-Docker @('exec', $storageContainer, 'sh', '-c', 'find /data -type f | wc -l')).Trim()
  if ($objectFiles -lt 1) { throw 'Restored object-storage volume contains no files.' }

  $timer.Stop()
  $result = [ordered]@{
    status = 'PASS'
    backupCreatedAtUtc = $manifest.createdAtUtc
    restoreStartedAtUtc = $runStartedUtc.ToString('o')
    restoreCompletedAtUtc = [DateTime]::UtcNow.ToString('o')
    elapsedSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 2)
    durationScope = 'Scripted restore/provisioning only, not incident-to-service RTO'
    approvedRecoveryTargets = $approvedRecoveryTargets
    databaseMigrationRows = $migrationCount
    requiredPostgresExtensions = $extensionCount
    restoredObjectStorageFileCount = $objectFiles
    rpoTarget = "$($approvedRecoveryTargets.rpoSeconds) seconds (approved target, not achieved RPO)"
    rtoTarget = "$($approvedRecoveryTargets.rtoSeconds) seconds (approved target, not achieved RTO)"
  }
}
finally {
  if ($storageContainerCreated) { try { Invoke-Docker @('rm', '-f', $storageContainer) | Out-Null } catch { $cleanupFailures.Add("container $storageContainer") } }
  if ($databaseContainerCreated) { try { Invoke-Docker @('rm', '-f', $databaseContainer) | Out-Null } catch { $cleanupFailures.Add("container $databaseContainer") } }
  if ($objectVolumeCreated) { try { Invoke-Docker @('volume', 'rm', $objectVolume) | Out-Null } catch { $cleanupFailures.Add("volume $objectVolume") } }
  if ($databaseVolumeCreated) { try { Invoke-Docker @('volume', 'rm', $databaseVolume) | Out-Null } catch { $cleanupFailures.Add("volume $databaseVolume") } }
}

if ($cleanupFailures.Count -gt 0) { throw "Restore passed but disposable cleanup failed; inspect exact resource(s): $($cleanupFailures -join ', ')" }
if ($null -eq $result) { throw 'Restore did not produce verification evidence.' }
$resultPath = Join-Path $backupPath 'restore-drill-result.json'
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8
Write-Output "Restore drill passed. Scripted restore/provisioning: $($result.elapsedSeconds) seconds (not incident RTO). Evidence: $resultPath"

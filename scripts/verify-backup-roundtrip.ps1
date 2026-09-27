param(
  [Parameter(Mandatory=$true)][string]$IdentityFile,
  [Parameter(Mandatory=$true)][string]$ReceiptFile,
  [Parameter(Mandatory=$true)][string]$SourceBackupDirectory,
  [string]$OperationsConfig
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'backup-runner.ps1')
$result=[ordered]@{status='FAILED';reason='RECOVERY_CONFIGURATION_INVALID';identityCopied=$false;identityGenerated=$false;
  realRestorePerformed=$false;scheduledTaskEnabled=$false;achievedRpo='NOT_VERIFIED';achievedRto='NOT_VERIFIED'}
$recoveryDirectory=$null
try {
  $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if (-not $OperationsConfig) { $OperationsConfig=Join-Path $repository 'backup-runner.private.json' }
  $config=Get-IereRunnerConfig -ConfigPath $OperationsConfig -RepositoryRoot $repository
  $identity=Get-IereSafeRunnerPath -Path $IdentityFile -RepositoryRoot $repository -OutsideRepository -RequireFile
  $receipt=Get-IereSafeRunnerPath -Path $ReceiptFile -RepositoryRoot $repository -OutsideRepository -RequireFile
  $source=Get-IereSafeRunnerPath -Path $SourceBackupDirectory -RepositoryRoot $repository -OutsideRepository
  if (-not (Test-Path -LiteralPath $source -PathType Container) -or (Test-Path -LiteralPath (Join-Path $source 'INCOMPLETE.txt'))) { throw 'SOURCE_BACKUP_INVALID' }
  New-IerePrivateRunnerDirectory -Path $config.stateDirectory
  $recoveryDirectory=Join-Path $config.stateDirectory ('recovery-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $recoveryDirectory -ErrorAction Stop | Out-Null
  $result.reason='DOWNLOAD_DECRYPT_OR_ARCHIVE_VERIFICATION_FAILED'
  $restored=Invoke-IereRunnerProcess -Program 'docker' -RepositoryRoot $repository -Arguments @(
    'run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--tmpfs','/var/lib/postgresql/data:rw,nosuid,noexec,size=1m',
    '--mount',"type=bind,source=$($config.adapterConfigFile),target=/config/backup.json,readonly",
    '--mount',"type=bind,source=$($config.credentialFile),target=/credentials/backup-s3.json,readonly",
    '--mount',"type=bind,source=$identity,target=/recovery/existing.agekey,readonly",
    '--mount',"type=bind,source=$receipt,target=/evidence/receipt.json,readonly",
    '--mount',"type=bind,source=$recoveryDirectory,target=/output",
    $config.toolImage,'restore-to-new-directory','--config','/config/backup.json','--receipt','/evidence/receipt.json',
    '--identity','/recovery/existing.agekey','--output-directory','/output/restored')
  if (($restored | ConvertFrom-Json).status -ne 'PASS_SCOPED_RESTORED_ARCHIVES') { throw 'RESTORED_ARCHIVES_NOT_VERIFIED' }
  $restoredDirectory=Join-Path $recoveryDirectory 'restored'
  $result.reason='SOURCE_ARCHIVE_HASH_MISMATCH'
  $checks=@()
  foreach ($file in @('database.dump','object-storage.tar.gz','manifest.json')) {
    $original=Get-IereSafeRunnerPath -Path (Join-Path $source $file) -RepositoryRoot $repository -OutsideRepository -RequireFile
    $recovered=Get-IereSafeRunnerPath -Path (Join-Path $restoredDirectory $file) -RepositoryRoot $repository -OutsideRepository -RequireFile
    $before=(Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant()
    $after=(Get-FileHash -LiteralPath $recovered -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($before -ne $after -or (Get-Item -LiteralPath $original).Length -ne (Get-Item -LiteralPath $recovered).Length) { throw 'SOURCE_ARCHIVE_HASH_MISMATCH' }
    $checks+=@{file=$file;sha256=$after;bytes=(Get-Item -LiteralPath $recovered).Length;sourceByteHashEqual=$true}
  }
  $result.reason='ISOLATED_RESTORE_FAILED'
  Invoke-IereRunnerProcess -Program 'powershell.exe' -RepositoryRoot $repository -Arguments @('-NoProfile','-NonInteractive',
    '-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'restore-drill-local.ps1'),'-BackupDirectory',$restoredDirectory) | Out-Null
  $drill=Get-Content -LiteralPath (Join-Path $restoredDirectory 'restore-drill-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($drill.status -ne 'PASS') { throw 'ISOLATED_RESTORE_FAILED' }
  $result.status='PASS_SCOPED_REAL_BACKUP_ROUNDTRIP';$result.reason='SOURCE_HASH_EQUAL_AND_ISOLATED_RESTORE_VERIFIED'
  $result.realRestorePerformed=$true;$result.archiveChecks=$checks
  $result.databaseMigrationRows=$drill.databaseMigrationRows;$result.requiredPostgresExtensions=$drill.requiredPostgresExtensions
  $result.restoredObjectStorageFileCount=$drill.restoredObjectStorageFileCount;$result.scriptedRestoreSeconds=$drill.elapsedSeconds
  $result.scope='Exact captured archives plus isolated local DB/volume restore; not independent-site/incident recovery or customer-object-level read'
} catch {
  # Preserve only stable stage codes, never Docker/key/provider error content.
} finally {
  if ($recoveryDirectory) {
    try { Write-IereRunnerJson -Path (Join-Path $recoveryDirectory 'roundtrip-result.json') -Value $result }
    catch { $result.status='FAILED';$result.reason='RESULT_LOG_WRITE_FAILED' }
  }
}
$result | ConvertTo-Json -Depth 8 -Compress
if ($result.status -ne 'PASS_SCOPED_REAL_BACKUP_ROUNDTRIP') { exit 1 }

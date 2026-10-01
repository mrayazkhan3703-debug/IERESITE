param(
  [Parameter(Mandatory=$true)][string]$OperationsConfig,
  [Parameter(Mandatory=$true)][string]$RoundtripResult,
  [Parameter(Mandatory=$true)][switch]$OwnerKeyCopyConfirmed
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'backup-runner.ps1')
. (Join-Path $PSScriptRoot 'backup-operations-policy.ps1')
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configuration=Get-IereRunnerConfig -ConfigPath $OperationsConfig -RepositoryRoot $repository
if ($configuration.sourceKind -ne 'hosted-postgres-r2' -or -not $OwnerKeyCopyConfirmed) { throw 'HOSTED_RECOVERY_AND_OWNER_COPY_REQUIRED' }
$resultPath=Get-IereSafeRunnerPath -Path $RoundtripResult -RepositoryRoot $repository -OutsideRepository -RequireFile
if (-not $resultPath.StartsWith($configuration.stateDirectory.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
    (Get-Item -LiteralPath $resultPath).Length -gt 32768) { throw 'SCOPED_RECOVERY_RESULT_REQUIRED' }
$recovery=Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8|ConvertFrom-Json
$sourceConfiguration=Get-Content -LiteralPath $configuration.sourceConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
if ($recovery.sourceId -ne $sourceConfiguration.sourceId) { throw 'RECOVERY_SOURCE_MISMATCH' }
if ($recovery.status -ne 'PASS_SCOPED_REAL_BACKUP_ROUNDTRIP' -or $recovery.source -ne 'hosted-postgres-r2' -or -not $recovery.realRestorePerformed -or
    -not $recovery.deliveryChecks.anonymousDocumentDenied -or $recovery.databaseMigrationRows -lt 1 -or
    $recovery.requiredPostgresExtensions -ne 3 -or @($recovery.archiveChecks).Count -ne 3 -or
    @($recovery.archiveChecks|Where-Object {-not $_.sourceByteHashEqual}).Count -ne 0 -or
    (Get-Item -LiteralPath $resultPath).LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-24)) { throw 'CURRENT_HOSTED_RECOVERY_REQUIRED' }
$policy=Get-IereBackupOperationsPolicy
$taskHasher=[Security.Cryptography.SHA256]::Create()
try { $taskSuffix=([BitConverter]::ToString($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($configuration.stateDirectory.ToLowerInvariant())))).Replace('-','').Substring(0,12).ToLowerInvariant() }
finally { $taskHasher.Dispose() }
$taskName="IERE Hosted Backup $taskSuffix"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'EXISTING_TASK_PRESERVED' }
$dockerVersion=Invoke-IereRunnerProcess -Program 'docker' -RepositoryRoot $repository -Arguments @('info','--format','{{.ServerVersion}}')
if ($dockerVersion -notmatch '^\d+\.\d+\.\d+') { throw 'DOCKER_REQUIRED' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$xml=New-IereBackupTaskXml -Policy $policy -UserSid $sid -RunnerPath (Join-Path $PSScriptRoot 'run-backup-operations.ps1') -WorkingDirectory $repository -StartUtc ([DateTime]::UtcNow.AddMinutes(1)) -OperationsConfig $OperationsConfig
Register-ScheduledTask -TaskName $taskName -Xml $xml -ErrorAction Stop|Out-Null
try {
  $configuration.scheduledExecutionApproved=$true
  $configuration|Add-Member -NotePropertyName ownerKeyCopyConfirmedAtUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
  $configuration|Add-Member -NotePropertyName recoveryEvidenceFile -NotePropertyValue $resultPath -Force
  Write-IereRunnerJson -Path $OperationsConfig -Value $configuration -ReplacePointer
  Enable-ScheduledTask -TaskName $taskName -ErrorAction Stop|Out-Null
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if (-not $task.Settings.Enabled) { throw 'SCHEDULE_NOT_ENABLED' }
  Write-IereRunnerJson -Path (Join-Path $configuration.stateDirectory 'schedule-activation.json') -ReplacePointer -Value @{
    format=1;taskName=$taskName;enabled=$true;intervalMinutes=30;ownerKeyCopyConfirmed=$true;
    activatedAtUtc=[DateTime]::UtcNow.ToString('o');recoveryEvidenceSha256=(Get-FileHash -LiteralPath $resultPath -Algorithm SHA256).Hash.ToLowerInvariant();
    deletion='DISABLED';limitation='Interactive Windows session and Docker required; computer downtime prevents execution';achievedRpo='NOT_VERIFIED';achievedRto='NOT_VERIFIED' }
  Write-Output (@{status='ENABLED_HOSTED_SCHEDULE';taskName=$taskName;intervalMinutes=30;automaticDeletion=$false;achievedRpo='NOT_VERIFIED';achievedRto='NOT_VERIFIED'}|ConvertTo-Json -Compress)
} catch {
  Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue|Out-Null
  throw 'SCHEDULE_ACTIVATION_FAILED_DISABLED'
}

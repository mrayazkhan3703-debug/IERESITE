param(
  [string]$OperationsConfig,
  [switch]$RunOnce,
  [switch]$Scheduled,
  [switch]$Report
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-operations-policy.ps1')
. (Join-Path $PSScriptRoot 'backup-runner.ps1')
try {
  Get-IereBackupOperationsPolicy | Out-Null
  if (@($RunOnce,$Scheduled,$Report | Where-Object { $_ }).Count -gt 1) { throw 'Invalid runner mode' }
  $repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if ([string]::IsNullOrWhiteSpace($OperationsConfig)) { $OperationsConfig=Join-Path $repository 'backup-runner.private.json' }
  $mode = if ($RunOnce) { 'Manual' } elseif ($Scheduled) { 'Scheduled' } elseif ($Report) { 'Report' } else { 'Plan' }
  $result = Invoke-IereBackupRunner -ConfigPath $OperationsConfig -RepositoryRoot $repository -Mode $mode
  $result | ConvertTo-Json -Depth 8 -Compress
  if ($result.status -in @('PLAN_ONLY','VERIFIED_CIPHERTEXT_RUN','PASS_SCOPED_RECEIPT_AGE','SKIPPED_OVERLAP')) { exit 0 }
  exit 2
} catch {
  Write-Output '{"status":"FAILED","reason":"RUNNER_OR_POLICY_INVALID","backupStarted":false,"transferStarted":false,"deletionStarted":false,"scheduledTaskEnabled":false}'
  exit 1
}

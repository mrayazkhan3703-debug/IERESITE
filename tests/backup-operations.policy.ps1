$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/backup-operations-policy.ps1')
$checks = 0
function Assert-BackupPolicy([bool]$Condition) {
  if (-not $Condition) { throw 'Backup operations policy assertion failed.' }
  $script:checks++
}
$policy = Get-IereBackupOperationsPolicy
Assert-BackupPolicy ((Get-IereBackupWriterServices -RunningServices @('web', 'worker')) -join ',' -eq 'web,worker')
Assert-BackupPolicy ((Get-IereBackupWriterServices -RunningServices @('web', 'worker', 'web-test', 'local-monitor')) -join ',' -eq 'web,worker,web-test')
Assert-BackupPolicy ((Get-IereBackupWriterServices -RunningServices @('web', 'worker', 'local-monitor')) -notcontains 'local-monitor')
Assert-BackupPolicy ($policy.intervalMinutes -eq 30)
Assert-BackupPolicy ($policy.retentionDays -eq 30)
Assert-BackupPolicy ($policy.destination.requireOffHost -and $policy.destination.requireEncryption)
Assert-BackupPolicy ($policy.automaticDeletion -eq 'DISABLED_UNTIL_VERIFIED_PROTECTED_COPY')
$now = [DateTime]::SpecifyKind([DateTime]'2026-09-27T00:00:00', [DateTimeKind]::Utc)
$recent = Get-IereBackupRetentionPlan -Policy $policy -CreatedAtUtc $now.AddDays(-29) -NowUtc $now
$due = Get-IereBackupRetentionPlan -Policy $policy -CreatedAtUtc $now.AddDays(-30) -NowUtc $now
Assert-BackupPolicy (-not $recent.retentionDue -and $recent.action -eq 'KEEP')
Assert-BackupPolicy ($due.retentionDue -and $due.action -eq 'RETAIN_PENDING_VERIFIED_PROTECTED_COPY' -and -not $due.deletionAuthorized)
$xml = [xml](New-IereBackupTaskXml -Policy $policy -UserSid 'S-1-5-21-123-456-789-1001' -RunnerPath 'C:\SYNTHETIC Project & Test\scripts\run.ps1' -WorkingDirectory 'C:\SYNTHETIC Project & Test' -StartUtc $now)
Assert-BackupPolicy ($xml.Task.Settings.Enabled -eq 'false')
Assert-BackupPolicy ($xml.Task.Triggers.TimeTrigger.Repetition.Interval -eq 'PT30M')
Assert-BackupPolicy ($null -eq $xml.Task.Triggers.TimeTrigger.Repetition.Duration)
Assert-BackupPolicy ($xml.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew')
Assert-BackupPolicy ($xml.Task.Settings.AllowHardTerminate -eq 'false' -and $xml.Task.Settings.ExecutionTimeLimit -eq 'PT0S')
Assert-BackupPolicy ($xml.Task.Principals.Principal.LogonType -eq 'InteractiveToken' -and $xml.Task.Principals.Principal.RunLevel -eq 'LeastPrivilege')
Assert-BackupPolicy ($xml.Task.Actions.Exec.WorkingDirectory -eq 'C:\SYNTHETIC Project & Test')
Assert-BackupPolicy ($xml.Task.Actions.Exec.Command -eq 'wscript.exe')
Assert-BackupPolicy ($xml.Task.Actions.Exec.Arguments -eq '//B //NoLogo "C:\SYNTHETIC Project & Test\scripts\run-backup-scheduled.vbs" "C:\SYNTHETIC Project & Test\scripts\run.ps1"')
$hostedXml=[xml](New-IereBackupTaskXml -Policy $policy -UserSid 'S-1-5-21-123-456-789-1001' -RunnerPath 'C:\SYNTHETIC\run.ps1' -WorkingDirectory 'C:\SYNTHETIC' -StartUtc $now -OperationsConfig 'C:\Private & Recovery\runner.json')
Assert-BackupPolicy ($hostedXml.Task.Actions.Exec.Arguments -eq '//B //NoLogo "C:\SYNTHETIC\run-backup-scheduled.vbs" "C:\SYNTHETIC\run.ps1" "C:\Private & Recovery\runner.json"')
Assert-BackupPolicy ($hostedXml.Task.Settings.Enabled -eq 'false')
Assert-BackupPolicy ($hostedXml.Task.Actions.Exec.Command -eq 'wscript.exe')
$launcherPath=Join-Path $PSScriptRoot '../scripts/run-backup-scheduled.vbs'
& cscript.exe //B //NoLogo $launcherPath
Assert-BackupPolicy ($LASTEXITCODE -eq 64)
& cscript.exe //B //NoLogo $launcherPath 'C:\nonexistent\runner.ps1' 'C:\nonexistent\config.json'
Assert-BackupPolicy ($LASTEXITCODE -eq 64)
foreach ($field in @('intervalMinutes', 'retentionDays', 'achievement', 'checkpointBeforeMajorChanges')) {
  $invalid = ($policy | ConvertTo-Json -Depth 5 | ConvertFrom-Json)
  if ($field -eq 'achievement') { $invalid.$field = 'VERIFIED' }
  elseif ($field -eq 'checkpointBeforeMajorChanges') { $invalid.$field = $false }
  else { $invalid.$field = 0 }
  $rejected = $false
  try { Get-IereBackupOperationsPolicy -Policy $invalid | Out-Null } catch { $rejected = $true }
  Assert-BackupPolicy $rejected
}
$invalidDestination = ($policy | ConvertTo-Json -Depth 5 | ConvertFrom-Json)
$invalidDestination.destination.status = 'VERIFIED'
$rejected = $false
try { Get-IereBackupOperationsPolicy -Policy $invalidDestination | Out-Null } catch { $rejected = $true }
Assert-BackupPolicy $rejected
foreach ($field in @('provider', 'bucket', 'configurationFile', 'status')) {
  $invalid = ($policy | ConvertTo-Json -Depth 6 | ConvertFrom-Json)
  if ($field -eq 'status') { $invalid.destination.requestedTarget.$field = 'VERIFIED' }
  else { $invalid.destination.requestedTarget.$field = '../invalid' }
  $rejected = $false
  try { Get-IereBackupOperationsPolicy -Policy $invalid | Out-Null } catch { $rejected = $true }
  Assert-BackupPolicy $rejected
}
Write-Output "Backup operations policy checks passed: $checks. No task registration, Docker, archives, credentials, transfer or deletion."

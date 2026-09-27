param([switch]$RegisterDisabled)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-operations-policy.ps1')
. (Join-Path $PSScriptRoot 'recovery-targets.ps1')
$policy = Get-IereBackupOperationsPolicy
$targets = Get-IereRecoveryTargets
if ($policy.intervalMinutes * 60 -ge $targets.rpoSeconds) { throw 'Backup interval must leave margin below the approved RPO.' }
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hasher = [Security.Cryptography.SHA256]::Create()
try { $suffix = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($workspace.ToLowerInvariant())))).Replace('-', '').Substring(0, 12).ToLowerInvariant() }
finally { $hasher.Dispose() }
$taskName = "IERE Local Backup Plan $suffix"
$result = [ordered]@{ taskName = $taskName; intervalMinutes = $policy.intervalMinutes; retentionDays = $policy.retentionDays; enabled = $false; status = 'PLAN_ONLY'; offHost = 'BLOCKED_EXTERNAL'; deletion = 'DISABLED' }
if ($RegisterDisabled) {
  if ($null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { throw 'Existing scheduled task preserved; no replacement performed.' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $xml = New-IereBackupTaskXml -Policy $policy -UserSid $sid -RunnerPath (Join-Path $PSScriptRoot 'run-backup-operations.ps1') -WorkingDirectory $workspace -StartUtc ([DateTime]::UtcNow.AddMinutes(1))
  Register-ScheduledTask -TaskName $taskName -Xml $xml -ErrorAction Stop | Out-Null
  $registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if ($registered.Settings.Enabled) {
    Disable-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
    throw 'Task was unexpectedly enabled; disabled for safety, operator review required.'
  }
  $result.status = 'REGISTERED_DISABLED'
}
$result | ConvertTo-Json -Compress

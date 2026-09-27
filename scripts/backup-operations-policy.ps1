# Pure metadata/planning only. No credentials, network, Docker or deletion.
function Get-IereBackupWriterServices {
  param([string[]]$RunningServices)
  $writers = @('web', 'worker')
  if ($RunningServices -contains 'web-test') { $writers += 'web-test' }
  return $writers
}

function Get-IereBackupOperationsPolicy {
  param([object]$Policy)
  if ($null -eq $Policy) {
    $policyPath = Join-Path $PSScriptRoot '../docs/agent/BACKUP_OPERATIONS_POLICY.json'
    if ((Get-Item -LiteralPath $policyPath).Length -gt 4096) { throw 'Backup operations policy exceeds metadata bound.' }
    $Policy = Get-Content -LiteralPath $policyPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  if ($Policy.format -ne 1 -or $Policy.status -ne 'OWNER_APPROVED_OPERATIONS_ONLY' -or
      $Policy.approvedOn -notmatch '^\d{4}-\d{2}-\d{2}$' -or $Policy.checkpointBeforeMajorChanges -ne $true) {
    throw 'Approved backup operations policy required.'
  }
  foreach ($field in @('intervalMinutes', 'retentionDays')) {
    $value = $Policy.$field
    if (($value -isnot [int] -and $value -isnot [long]) -or $value -le 0 -or $value -gt 365) {
      throw 'Backup interval and retention must be bounded positive integers.'
    }
  }
  if ($Policy.destination.requireOffHost -ne $true -or $Policy.destination.requireEncryption -ne $true -or
      $Policy.destination.status -ne 'BLOCKED_EXTERNAL' -or $null -ne $Policy.destination.location -or
      $Policy.destination.keyRecovery -ne 'NOT_CONFIGURED' -or
      $Policy.automaticDeletion -ne 'DISABLED_UNTIL_VERIFIED_PROTECTED_COPY' -or $Policy.achievement -ne 'NOT_VERIFIED') {
    throw 'Protected destination adapter/key recovery is not configured; do not fabricate readiness.'
  }
  $candidate = $Policy.destination.requestedTarget
  if ($null -ne $candidate -and ($candidate.provider -ne 'cloudflare-r2' -or $candidate.region -ne 'auto' -or
      $candidate.bucket -notmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' -or
      $candidate.configurationFile -ne 'backup-config.private.json' -or
      $candidate.status -ne 'OWNER_SUPPLIED_NOT_LIVE_VERIFIED')) {
    throw 'Requested destination metadata is invalid; no live verification or protection inferred.'
  }
  return $Policy
}

function Get-IereBackupRetentionPlan {
  param([DateTime]$CreatedAtUtc, [DateTime]$NowUtc, [object]$Policy)
  $approved = Get-IereBackupOperationsPolicy -Policy $Policy
  if ($CreatedAtUtc.Kind -ne [DateTimeKind]::Utc -or $NowUtc.Kind -ne [DateTimeKind]::Utc -or $CreatedAtUtc -gt $NowUtc) {
    throw 'Retention planning requires ordered UTC timestamps.'
  }
  $due = $CreatedAtUtc.AddDays($approved.retentionDays) -le $NowUtc
  return [ordered]@{
    retentionDays = $approved.retentionDays
    retentionDue = $due
    action = $(if ($due) { 'RETAIN_PENDING_VERIFIED_PROTECTED_COPY' } else { 'KEEP' })
    deletionAuthorized = $false
  }
}

function New-IereBackupTaskXml {
  param([object]$Policy, [string]$UserSid, [string]$RunnerPath, [string]$WorkingDirectory, [DateTime]$StartUtc)
  $approved = Get-IereBackupOperationsPolicy -Policy $Policy
  if ($UserSid -notmatch '^S-1-\d+(?:-\d+)+$' -or $StartUtc.Kind -ne [DateTimeKind]::Utc -or
      $RunnerPath -match '[\r\n"]' -or $WorkingDirectory -match '[\r\n"]' -or
      -not [IO.Path]::IsPathRooted($RunnerPath) -or -not [IO.Path]::IsPathRooted($WorkingDirectory)) {
    throw 'Invalid local task identity/path/time.'
  }
  $runner = [Security.SecurityElement]::Escape($RunnerPath)
  $working = [Security.SecurityElement]::Escape($WorkingDirectory)
  $start = $StartUtc.ToString("yyyy-MM-ddTHH:mm:ss'Z'")
  # Disabled at registration; no live transfer/cadence success is asserted.
  # No hard-kill time limit: killing a quiescing backup can prevent finally cleanup.
  return @"
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>IERE backup plan: $($approved.intervalMinutes) minutes / $($approved.retentionDays) days; disabled pending protected off-host destination and key recovery.</Description></RegistrationInfo>
  <Triggers><TimeTrigger><Repetition><Interval>PT$($approved.intervalMinutes)M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$start</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="CurrentUser"><UserId>$UserSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><Enabled>false</Enabled><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
  <Actions Context="CurrentUser"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$runner&quot; -Scheduled</Arguments><WorkingDirectory>$working</WorkingDirectory></Exec></Actions>
</Task>
"@
}

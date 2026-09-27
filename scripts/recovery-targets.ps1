# Pure policy/metadata helper. No Docker, environment credentials or backup writes.
function Get-IereRecoveryTargets {
  param([object]$Policy)
  if ($null -eq $Policy) {
    $policyPath = Join-Path $PSScriptRoot '../docs/agent/RECOVERY_TARGETS.json'
    if ((Get-Item -LiteralPath $policyPath).Length -gt 4096) { throw 'Recovery policy exceeds metadata bound.' }
    $Policy = Get-Content -LiteralPath $policyPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  if ($Policy.format -ne 1 -or $Policy.status -ne 'OWNER_APPROVED_TARGETS_ONLY') {
    throw 'Recovery policy must contain approved targets, not achieved-recovery claims.'
  }
  foreach ($field in @('rpoSeconds', 'rtoSeconds')) {
    $value = $Policy.$field
    if (($value -isnot [int] -and $value -isnot [long]) -or $value -le 0 -or $value -gt [int]::MaxValue) {
      throw 'Recovery targets must be positive integer seconds.'
    }
  }
  if ($Policy.approvedOn -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'Recovery target approval date is required.' }
  return [ordered]@{
    rpoSeconds = [int]$Policy.rpoSeconds
    rtoSeconds = [int]$Policy.rtoSeconds
    approvedOn = $Policy.approvedOn
    source = 'Explicit user instruction'
    status = 'OWNER_APPROVED_TARGETS_ONLY'
    achievement = 'NOT_VERIFIED_BY_LOCAL_DRILL'
  }
}

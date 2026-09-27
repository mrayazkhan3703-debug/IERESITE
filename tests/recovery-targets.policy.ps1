$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/recovery-targets.ps1')
$checks = 0
function Assert-Policy([bool]$Condition) {
  if (-not $Condition) { throw 'Recovery target policy assertion failed.' }
  $script:checks++
}
$official = Get-IereRecoveryTargets
Assert-Policy ($official.rpoSeconds -eq 3600)
Assert-Policy ($official.rtoSeconds -eq 7200)
Assert-Policy ($official.status -eq 'OWNER_APPROVED_TARGETS_ONLY')
Assert-Policy ($official.achievement -eq 'NOT_VERIFIED_BY_LOCAL_DRILL')
foreach ($invalid in @(
  @{ format = 1; status = 'PASS'; approvedOn = '2026-09-26'; rpoSeconds = 3600; rtoSeconds = 7200 },
  @{ format = 2; status = 'OWNER_APPROVED_TARGETS_ONLY'; approvedOn = '2026-09-26'; rpoSeconds = 3600; rtoSeconds = 7200 },
  @{ format = 1; status = 'OWNER_APPROVED_TARGETS_ONLY'; approvedOn = '2026-09-26'; rpoSeconds = 0; rtoSeconds = 7200 },
  @{ format = 1; status = 'OWNER_APPROVED_TARGETS_ONLY'; approvedOn = '2026-09-26'; rpoSeconds = 3600; rtoSeconds = -1 },
  @{ format = 1; status = 'OWNER_APPROVED_TARGETS_ONLY'; approvedOn = '2026-09-26'; rpoSeconds = '3600'; rtoSeconds = 7200 },
  @{ format = 1; status = 'OWNER_APPROVED_TARGETS_ONLY'; rpoSeconds = 3600; rtoSeconds = 7200 }
)) {
  $rejected = $false
  try { Get-IereRecoveryTargets -Policy ([PSCustomObject]$invalid) | Out-Null } catch { $rejected = $true }
  Assert-Policy $rejected
}
Write-Output "Recovery policy checks passed: $checks. No Docker, archives, credentials or service changes."

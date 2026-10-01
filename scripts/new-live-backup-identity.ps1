param(
  [Parameter(Mandatory=$true)][string]$KeygenPath,
  [string]$RecoveryDirectory = (Join-Path $env:LOCALAPPDATA 'IERE\recovery\live-20261001')
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'backup-runner.ps1')
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$directory=Get-IereSafeRunnerPath -Path $RecoveryDirectory -RepositoryRoot $repository -OutsideRepository
$keygen=Get-IereSafeRunnerPath -Path $KeygenPath -RepositoryRoot $repository -OutsideRepository -RequireFile
if (Test-Path -LiteralPath $directory) { throw 'RECOVERY_DIRECTORY_ALREADY_EXISTS' }
New-IerePrivateRunnerDirectory -Path $directory
$identity=Join-Path $directory 'live-backup.agekey'
$recipient=Join-Path $directory 'recipients.txt'
Invoke-IereRunnerProcess -Program $keygen -Arguments @('-o',$identity) -RepositoryRoot $repository | Out-Null
$public=Invoke-IereRunnerProcess -Program $keygen -Arguments @('-y',$identity) -RepositoryRoot $repository
if ($public -notmatch '^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$') { throw 'INVALID_GENERATED_PUBLIC_RECIPIENT' }
[IO.File]::WriteAllText($recipient,$public+"`n",(New-Object Text.UTF8Encoding($false)))
$acl=Get-Acl -LiteralPath $directory
if (-not $acl.AreAccessRulesProtected) { throw 'RECOVERY_DIRECTORY_NOT_PRIVATE' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($rule in $acl.Access) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'RECOVERY_DIRECTORY_NOT_PRIVATE' }
}
# Only paths and public identity metadata leave this script. Capture never receives the private identity.
[ordered]@{status='GENERATED_PRIVATE_IDENTITY';identityFile=$identity;recipientFile=$recipient;ownerHeldCopy='NOT_CONFIRMED';scheduleEnabled=$false} | ConvertTo-Json -Compress

param(
  [Parameter(Mandatory=$true)][string]$IdentityFile,
  [string]$OperationsConfig,
  [string]$RecipientFile
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'backup-runner.ps1')
$stage='RUNNER_CONFIGURATION'
try {
  $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if (-not $OperationsConfig) { $OperationsConfig=Join-Path $repository 'backup-runner.private.json' }
  $config=Get-IereRunnerConfig -ConfigPath $OperationsConfig -RepositoryRoot $repository
  $stage='EXISTING_IDENTITY_PATH'
  $identity=Get-IereSafeRunnerPath -Path $IdentityFile -RepositoryRoot $repository -OutsideRepository -RequireFile
  if ((Get-Item -LiteralPath $identity).Length -gt 32768) { throw 'INVALID_EXISTING_IDENTITY' }
  if (-not $RecipientFile) { $RecipientFile=Join-Path ([IO.Path]::GetDirectoryName($config.stateDirectory)) 'recipients.txt' }
  $publicPath=Get-IereSafeRunnerPath -Path $RecipientFile -RepositoryRoot $repository -OutsideRepository
  # Derivation ONLY (-y). No generation flag, key copy or uploader/config mount.
  $stage='LOCAL_PUBLIC_DERIVATION'
  $derived=Invoke-IereRunnerProcess -Program 'docker' -RepositoryRoot $repository -Arguments @(
    'run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--tmpfs','/var/lib/postgresql/data:rw,nosuid,noexec,size=1m',
    '--mount',"type=bind,source=$identity,target=/identity/existing.agekey,readonly",'--entrypoint','age-keygen',$config.toolImage,'-y','/identity/existing.agekey')
  $stage='DERIVED_PUBLIC_RECIPIENT_VALIDATION'
  $rows=@($derived -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($rows.Count -lt 1 -or $rows.Count -gt 8 -or @($rows | Where-Object { $_ -notmatch '^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$' }).Count -gt 0) { throw 'INVALID_EXISTING_IDENTITY' }
  $publicText=(@($rows | Sort-Object -Unique) -join "`n")+"`n"
  $stage='EXISTING_PUBLIC_RECIPIENT_COMPARISON'
  if (Test-Path -LiteralPath $publicPath) {
    if ([IO.File]::ReadAllText($publicPath).Replace("`r`n","`n") -ne $publicText) { throw 'RECIPIENT_CONFLICT' }
  } else {
    New-IerePrivateRunnerDirectory -Path ([IO.Path]::GetDirectoryName($publicPath))
    $stream=[IO.File]::Open($publicPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes=[Text.Encoding]::UTF8.GetBytes($publicText); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  }
  $config.recipientFile=$publicPath
  $stage='PUBLIC_ONLY_CONFIGURATION_WRITE'
  Write-IereRunnerJson -Path ([IO.Path]::GetFullPath($OperationsConfig)) -Value $config -ReplacePointer
  # Private identity path/value is never stored in runner/uploader configuration.
  [ordered]@{status='PUBLIC_RECIPIENT_CONFIGURED';recipientFile=$publicPath;identityCopied=$false;
    identityGenerated=$false;networkCalls=0;scheduledTaskEnabled=$false;keyCustody='NOT_INDEPENDENTLY_VERIFIED'} | ConvertTo-Json -Compress
} catch {
  [ordered]@{status='FAILED';reason='EXISTING_IDENTITY_OR_PUBLIC_RECIPIENT_INVALID';stage=$stage;
    identityCopied=$false;identityGenerated=$false;scheduledTaskEnabled=$false} | ConvertTo-Json -Compress
  exit 1
}

$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/backup-runner.ps1')
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testId=[guid]::NewGuid().ToString('N')
$testRoot=Join-Path ([IO.Path]::GetTempPath()) "iere-runner-unit-$testId"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$checks=0
function Assert-Runner([bool]$Condition) { if (-not $Condition) { throw 'Runner unit assertion failed' }; $script:checks++ }
function Save-TestJson([string]$Path,[object]$Value) { [IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false))) }
try {
  $adapter=Join-Path $testRoot 'adapter.json';$credentials=Join-Path $testRoot 'credentials.json';$recipients=Join-Path $testRoot 'recipients.txt'
  Save-TestJson $adapter @{format=1};Save-TestJson $credentials @{fixture='NON_SECRET_UNIT_ONLY'}
  # Official age README public recipient, not a generated key or private identity.
  [IO.File]::WriteAllText($recipients,"age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p`n")
  $config=@{format=1;scheduledExecutionApproved=$false;toolImage=('sha256:'+('a'*64));adapterConfigFile=$adapter;
    credentialFile=$credentials;recipientFile=$null;captureDirectory=(Join-Path $testRoot 'capture');stateDirectory=(Join-Path $testRoot 'state')}
  $configPath=Join-Path $testRoot 'runner.json';Save-TestJson $configPath $config
  $script:runnerCalls=0
  $never={param($program,$arguments,$repo) $script:runnerCalls++;throw 'DO_NOT_RUN'}
  $missing=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Manual -ProcessRunner $never
  Assert-Runner ($missing.reason -eq 'MISSING_PUBLIC_AGE_RECIPIENT' -and -not $missing.backupStarted -and -not $missing.transferStarted)
  Assert-Runner ($script:runnerCalls -eq 0 -and -not (Test-Path -LiteralPath $config.stateDirectory))
  foreach ($path in @('relative', [IO.Path]::GetPathRoot($testRoot), (Join-Path $repository 'private.json'))) {
    $rejected=$false;try { Get-IereSafeRunnerPath -Path $path -RepositoryRoot $repository -OutsideRepository|Out-Null } catch { $rejected=$true }
    Assert-Runner $rejected
  }
  foreach ($field in @('format','toolImage','scheduledExecutionApproved')) {
    $invalid=$config.Clone();$invalid[$field]='invalid';Save-TestJson $configPath $invalid
    $rejected=$false;try { Get-IereRunnerConfig -ConfigPath $configPath -RepositoryRoot $repository|Out-Null } catch { $rejected=$true }
    Assert-Runner $rejected
  }
  $config.recipientFile=$recipients;Save-TestJson $configPath $config
  $plan=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Plan -ProcessRunner $never
  Assert-Runner ($plan.status -eq 'PLAN_ONLY' -and -not $plan.backupStarted -and $script:runnerCalls -eq 0)
  $scheduled=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Scheduled -ProcessRunner $never
  Assert-Runner ($scheduled.status -eq 'BLOCKED_REVIEW' -and $script:runnerCalls -eq 0 -and -not $scheduled.scheduledTaskEnabled)
  $runnerArguments=Get-IereRunnerDockerArguments -Config ([pscustomobject]$config) -Action preflight
  Assert-Runner ($runnerArguments -contains 'none' -and $runnerArguments -notcontains '--env-file' -and @($runnerArguments|Where-Object {$_ -match 'identity|agekey|recovery'}).Count -eq 0)
  $runnerArguments=Get-IereRunnerDockerArguments -Config ([pscustomobject]$config) -Action upload-existing-backup -RunDirectory (Join-Path $testRoot 'run') -BackupDirectory (Join-Path $testRoot 'captured')
  Assert-Runner ($runnerArguments -notcontains 'none' -and @($runnerArguments|Where-Object {$_ -match 'identity|agekey|recovery'}).Count -eq 0)
  $runnerArguments=Get-IereRunnerDockerArguments -Config ([pscustomobject]$config) -Action report -ReceiptFile (Join-Path $testRoot 'receipt.json')
  Assert-Runner ($runnerArguments -contains 'none' -and @($runnerArguments|Where-Object {$_ -match 'credentials/|recipients.txt'}).Count -eq 0)
  $failed=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Manual -ProcessRunner $never
  Assert-Runner ($failed.status -eq 'FAILED' -and $failed.reason -eq 'PREFLIGHT_FAILED' -and -not $failed.backupStarted)
  $failureFile=Get-ChildItem -LiteralPath $config.stateDirectory -Filter result.json -Recurse | Select-Object -First 1
  Assert-Runner ($null -ne $failureFile -and [IO.File]::ReadAllText($failureFile.FullName) -notmatch 'DO_NOT_RUN')
  $held=[IO.File]::Open((Join-Path $config.stateDirectory '.runner.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try { $duplicate=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Manual -ProcessRunner $never
    Assert-Runner ($duplicate.status -eq 'SKIPPED_OVERLAP' -and -not $duplicate.backupStarted) } finally {$held.Dispose()}
  $capture={param($directory) $backup=Join-Path $directory ('local-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $backup|Out-Null
    Save-TestJson (Join-Path $backup 'manifest.json') @{fixture='MOCK_ONLY'};return "Backup created and archive-validated: $backup"}
  $script:runnerActions=@();$script:forceUploadFailure=$false;$script:forceStale=$false
  $mock={param($program,$arguments,$repo)
    Assert-Runner ($program -eq 'docker')
    if ($arguments -contains 'preflight') { $script:runnerActions+='preflight';return '{"status":"PASS_OFFLINE_PREFLIGHT","recipientFingerprint":"MOCK_ONLY"}' }
    if ($arguments -contains 'upload-existing-backup') {
      $script:runnerActions+='upload'
      if ($script:forceUploadFailure) {throw 'SECRET_BEARING_PROVIDER_MESSAGE'}
      $mount=@($arguments|Where-Object {$_ -match 'target=/output$'})[0];$run=($mount -replace '^type=bind,source=','' -replace ',target=/output$','')
      New-Item -ItemType Directory -Path (Join-Path $run 'encrypted')|Out-Null
      Save-TestJson (Join-Path $run 'encrypted/receipt.json') @{fixture='MOCK_ONLY_NO_CRYPTO_OR_STORAGE'}
      return '{"status":"VERIFIED_CIPHERTEXT_ONLY"}'
    }
    $script:runnerActions+='report'
    if ($script:forceStale) {return '{"status":"STALE_RECEIPT","captureWindowAgeSeconds":3601,"retentionDue":false}'}
    return '{"status":"PASS_SCOPED_RECEIPT_AGE","captureWindowAgeSeconds":1,"retentionDue":false}'
  }
  $passed=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Manual -ProcessRunner $mock -CaptureRunner $capture
  Assert-Runner ($passed.status -eq 'VERIFIED_CIPHERTEXT_RUN' -and $passed.backupStarted -and $passed.transferStarted)
  Assert-Runner (($script:runnerActions -join ',') -eq 'preflight,upload,report')
  Assert-Runner (-not $passed.deletionStarted -and -not $passed.scheduledTaskEnabled -and $passed.achievedRpo -eq 'NOT_VERIFIED')
  $pointer=Join-Path $config.stateDirectory 'last-success.json';$pointerHash=(Get-FileHash -LiteralPath $pointer).Hash
  $passedAgain=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Manual -ProcessRunner $mock -CaptureRunner $capture
  Assert-Runner ($passedAgain.status -eq 'VERIFIED_CIPHERTEXT_RUN' -and $passedAgain.runId -ne $passed.runId)
  Assert-Runner ((Get-FileHash -LiteralPath $pointer).Hash -ne $pointerHash)
  $pointerHash=(Get-FileHash -LiteralPath $pointer).Hash
  $script:forceUploadFailure=$true
  $failed=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Manual -ProcessRunner $mock -CaptureRunner $capture
  Assert-Runner ($failed.status -eq 'FAILED' -and $failed.reason -eq 'UPLOAD_FAILED' -and $failed.backupStarted -and $failed.transferStarted)
  Assert-Runner ((Get-FileHash -LiteralPath $pointer).Hash -eq $pointerHash)
  Assert-Runner (($failed|ConvertTo-Json) -notmatch 'SECRET_BEARING_PROVIDER_MESSAGE')
  $script:forceStale=$true
  $report=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Report -ProcessRunner $mock
  Assert-Runner ($report.status -eq 'STALE_RECEIPT' -and $report.captureWindowAgeSeconds -eq 3601 -and -not $report.backupStarted)
  $stored=Get-Content -LiteralPath $pointer -Raw|ConvertFrom-Json
  [IO.File]::AppendAllText($stored.receiptFile,'tampered')
  $report=Invoke-IereBackupRunner -ConfigPath $configPath -RepositoryRoot $repository -Mode Report -ProcessRunner $mock
  Assert-Runner ($report.status -eq 'FAILED' -and $report.reason -eq 'RECEIPT_HASH_MISMATCH')
  Assert-Runner ((ConvertTo-IereRunnerArgument 'C:\Folder With Spaces\') -eq '"C:\Folder With Spaces\\"')
  Write-Output "Runner mocked policy checks passed: $checks. No Docker/network/archive/key generation/application data/task mutation."
} finally {
  $resolved=[IO.Path]::GetFullPath($testRoot)
  $prefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -ne "iere-runner-unit-$testId") {throw 'Unsafe owned test cleanup'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

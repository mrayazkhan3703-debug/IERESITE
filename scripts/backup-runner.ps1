# Orchestration only: no implicit env/credential chain, task activation or pruning.
function Get-IereSafeRunnerPath {
  param([string]$Path, [string]$RepositoryRoot, [switch]$OutsideRepository, [switch]$RequireFile)
  if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path) -or $Path -match '[,\r\n]') { throw 'INVALID_PATH' }
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($full)
  if ($full.TrimEnd('\','/') -eq $root.TrimEnd('\','/')) { throw 'UNSAFE_ROOT_PATH' }
  $repo = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\','/')
  if ($OutsideRepository -and ($full.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) { throw 'OUTPUT_INSIDE_REPOSITORY' }
  $cursor = $full
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'LINKED_PATH' }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }; $cursor = $parent
  }
  if ($RequireFile -and -not (Test-Path -LiteralPath $full -PathType Leaf)) { throw 'MISSING_FILE' }
  return $full
}

function Get-IereRunnerConfig {
  param([string]$ConfigPath, [string]$RepositoryRoot)
  $path = Get-IereSafeRunnerPath -Path $ConfigPath -RepositoryRoot $RepositoryRoot -RequireFile
  if ((Get-Item -LiteralPath $path).Length -gt 16384) { throw 'INVALID_RUNNER_CONFIG' }
  try { $config = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw 'INVALID_RUNNER_CONFIG' }
  if ($config.format -ne 1 -or $config.scheduledExecutionApproved -isnot [bool] -or
      $config.toolImage -notmatch '^sha256:[a-f0-9]{64}$') { throw 'INVALID_RUNNER_CONFIG' }
  $config.adapterConfigFile = Get-IereSafeRunnerPath -Path $config.adapterConfigFile -RepositoryRoot $RepositoryRoot -RequireFile
  $config.credentialFile = Get-IereSafeRunnerPath -Path $config.credentialFile -RepositoryRoot $RepositoryRoot -OutsideRepository -RequireFile
  $config.captureDirectory = Get-IereSafeRunnerPath -Path $config.captureDirectory -RepositoryRoot $RepositoryRoot -OutsideRepository
  $config.stateDirectory = Get-IereSafeRunnerPath -Path $config.stateDirectory -RepositoryRoot $RepositoryRoot -OutsideRepository
  if ($config.captureDirectory.Equals($config.stateDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'INVALID_RUNNER_CONFIG' }
  if ($null -ne $config.recipientFile) {
    $config.recipientFile = Get-IereSafeRunnerPath -Path $config.recipientFile -RepositoryRoot $RepositoryRoot -OutsideRepository -RequireFile
    if ((Get-Item -LiteralPath $config.recipientFile).Length -gt 4096) { throw 'INVALID_PUBLIC_RECIPIENT' }
    $rows = @(Get-Content -LiteralPath $config.recipientFile -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
    if ($rows.Count -lt 1 -or $rows.Count -gt 8 -or @($rows | Where-Object { $_ -notmatch '^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$' }).Count -gt 0) { throw 'INVALID_PUBLIC_RECIPIENT' }
  }
  return $config
}

function New-IerePrivateRunnerDirectory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $Path -AclObject $acl
  }
}

function ConvertTo-IereRunnerArgument {
  param([string]$Value)
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Invoke-IereRunnerProcess {
  param([string]$Program, [string[]]$Arguments, [string]$RepositoryRoot)
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Program; $start.WorkingDirectory = $RepositoryRoot
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-IereRunnerArgument $_ }) -join ' ')
  $process = New-Object Diagnostics.Process; $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw 'PROCESS_FAILED' }
    $out = $process.StandardOutput.ReadToEndAsync(); $err = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $output = $out.Result; $discardedError = $err.Result
    if ($output.Length -gt 65536) { throw 'PROCESS_FAILED' }
    if ($process.ExitCode -ne 0) {
      # Adapter report intentionally exits nonzero for stale receipts.
      try { $stale = $output | ConvertFrom-Json } catch { throw 'PROCESS_FAILED' }
      if ($Program -ne 'docker' -or $stale.status -ne 'STALE_RECEIPT') { throw 'PROCESS_FAILED' }
    }
    return $output.Trim()
  } finally { $process.Dispose() }
}

function Write-IereRunnerJson {
  param([string]$Path, [object]$Value, [switch]$ReplacePointer)
  $text = $Value | ConvertTo-Json -Depth 8 -Compress
  $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.pending'
  $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $bytes = [Text.Encoding]::UTF8.GetBytes($text); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  if ($ReplacePointer -and (Test-Path -LiteralPath $Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
  else { [IO.File]::Move($temporary, $Path) }
}

function Get-IereRunnerDockerArguments {
  param([object]$Config, [string]$Action, [string]$RunDirectory, [string]$BackupDirectory, [string]$ReceiptFile)
  $arguments = @('run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--tmpfs','/var/lib/postgresql/data:rw,nosuid,noexec,size=1m')
  if ($Action -ne 'upload-existing-backup') { $arguments += @('--network','none') }
  $arguments += @('--mount',"type=bind,source=$($Config.adapterConfigFile),target=/config/backup.json,readonly")
  if ($Action -in @('preflight','upload-existing-backup')) {
    $arguments += @('--mount',"type=bind,source=$($Config.credentialFile),target=/credentials/backup-s3.json,readonly",
      '--mount',"type=bind,source=$($Config.recipientFile),target=/config/recipients.txt,readonly")
  }
  if ($Action -eq 'upload-existing-backup') {
    $arguments += @('--mount',"type=bind,source=$BackupDirectory,target=/backup,readonly",'--mount',"type=bind,source=$RunDirectory,target=/output")
  }
  if ($Action -eq 'report') { $arguments += @('--mount',"type=bind,source=$ReceiptFile,target=/evidence/receipt.json,readonly") }
  $arguments += @($Config.toolImage, $Action, '--config', '/config/backup.json')
  if ($Action -eq 'upload-existing-backup') { $arguments += @('--backup-directory','/backup','--output-directory','/output/encrypted') }
  if ($Action -eq 'report') { $arguments += @('--receipt','/evidence/receipt.json') }
  return $arguments
}

function Invoke-IereBackupRunner {
  param([string]$ConfigPath, [string]$RepositoryRoot, [ValidateSet('Plan','Manual','Scheduled','Report')][string]$Mode = 'Plan',
    [scriptblock]$ProcessRunner, [scriptblock]$CaptureRunner)
  $result = [ordered]@{format=1; status='BLOCKED_CONFIGURATION'; mode=$Mode; reason='MISSING_RUNNER_CONFIG';
    backupStarted=$false; transferStarted=$false; deletionStarted=$false; scheduledTaskEnabled=$false;
    achievedRpo='NOT_VERIFIED'; achievedRto='NOT_VERIFIED'; checkedAtUtc=[DateTime]::UtcNow.ToString('o')}
  $lock = $null; $runDirectory = $null; $config = $null
  try {
    $config = Get-IereRunnerConfig -ConfigPath $ConfigPath -RepositoryRoot $RepositoryRoot
    $result.reason = 'MISSING_PUBLIC_AGE_RECIPIENT'
    if ($null -eq $config.recipientFile) { return $result }
    if ($Mode -eq 'Scheduled' -and -not $config.scheduledExecutionApproved) { $result.status='BLOCKED_REVIEW'; $result.reason='SCHEDULED_REVIEW_NOT_APPROVED'; return $result }
    if ($Mode -eq 'Plan') { $result.status='PLAN_ONLY'; $result.reason='EXPLICIT_RUN_REQUIRED'; return $result }
    if ($null -eq $ProcessRunner) { $ProcessRunner = { param($program,$arguments,$repo) Invoke-IereRunnerProcess -Program $program -Arguments $arguments -RepositoryRoot $repo } }
    if ($Mode -eq 'Report') {
      $pointer = Join-Path $config.stateDirectory 'last-success.json'
      if (-not (Test-Path -LiteralPath $pointer)) { $result.status='NO_VERIFIED_RECEIPT'; $result.reason='NO_SUCCESSFUL_RUN'; return $result }
      $last = Get-Content -LiteralPath $pointer -Raw -Encoding UTF8 | ConvertFrom-Json
      $receipt = Get-IereSafeRunnerPath -Path $last.receiptFile -RepositoryRoot $RepositoryRoot -OutsideRepository -RequireFile
      if ((Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash -ine $last.receiptSha256) { throw 'RECEIPT_HASH_MISMATCH' }
      $report = & $ProcessRunner 'docker' (Get-IereRunnerDockerArguments -Config $config -Action 'report' -ReceiptFile $receipt) $RepositoryRoot
      $report = $report | ConvertFrom-Json
      $result.status = $report.status; $result.reason='RECEIPT_REPORT'; $result.captureWindowAgeSeconds=$report.captureWindowAgeSeconds
      $result.retentionDue=$report.retentionDue; return $result
    }
    New-IerePrivateRunnerDirectory -Path $config.stateDirectory
    try { $lock = [IO.File]::Open((Join-Path $config.stateDirectory '.runner.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { $result.status='SKIPPED_OVERLAP'; $result.reason='ANOTHER_RUN_OWNS_LOCK'; return $result }
    $runId = [guid]::NewGuid().ToString('N'); $runDirectory = Join-Path $config.stateDirectory "run-$runId"
    New-Item -ItemType Directory -Path $runDirectory -ErrorAction Stop | Out-Null
    $result.runId=$runId; $result.reason='PREFLIGHT_FAILED'
    $checked = & $ProcessRunner 'docker' (Get-IereRunnerDockerArguments -Config $config -Action 'preflight') $RepositoryRoot
    if (($checked | ConvertFrom-Json).status -ne 'PASS_OFFLINE_PREFLIGHT') { throw 'PREFLIGHT_FAILED' }
    New-IerePrivateRunnerDirectory -Path $config.captureDirectory
    $result.backupStarted=$true; $result.reason='CAPTURE_FAILED'
    if ($null -eq $CaptureRunner) {
      $captured = & $ProcessRunner 'powershell.exe' @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
        (Join-Path $RepositoryRoot 'scripts/backup-local.ps1'),'-OutputDirectory',$config.captureDirectory) $RepositoryRoot
    } else { $captured = & $CaptureRunner $config.captureDirectory }
    $match = [regex]::Match($captured, '(?m)^Backup created and archive-validated: (.+)\r?$')
    if (-not $match.Success) { throw 'CAPTURE_FAILED' }
    $backup = Get-IereSafeRunnerPath -Path $match.Groups[1].Value.Trim() -RepositoryRoot $RepositoryRoot -OutsideRepository -RequireFile:$false
    if (-not $backup.StartsWith($config.captureDirectory.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath (Join-Path $backup 'manifest.json')) -or (Test-Path -LiteralPath (Join-Path $backup 'INCOMPLETE.txt'))) { throw 'CAPTURE_FAILED' }
    $result.transferStarted=$true; $result.reason='UPLOAD_FAILED'
    $upload = & $ProcessRunner 'docker' (Get-IereRunnerDockerArguments -Config $config -Action 'upload-existing-backup' -RunDirectory $runDirectory -BackupDirectory $backup) $RepositoryRoot
    if (($upload | ConvertFrom-Json).status -ne 'VERIFIED_CIPHERTEXT_ONLY') { throw 'UPLOAD_FAILED' }
    $receipt = Join-Path $runDirectory 'encrypted/receipt.json'
    if (-not (Test-Path -LiteralPath $receipt -PathType Leaf)) { throw 'MISSING_VERIFIED_RECEIPT' }
    $result.reason='RECEIPT_REPORT_FAILED'
    $report = & $ProcessRunner 'docker' (Get-IereRunnerDockerArguments -Config $config -Action 'report' -ReceiptFile $receipt) $RepositoryRoot
    if (($report | ConvertFrom-Json).status -ne 'PASS_SCOPED_RECEIPT_AGE') { throw 'RECEIPT_REPORT_FAILED' }
    $result.status='VERIFIED_CIPHERTEXT_RUN'; $result.reason='FULL_READBACK_AND_RECEIPT_VERIFIED'
    $result.recipientFingerprint=($checked | ConvertFrom-Json).recipientFingerprint
    Write-IereRunnerJson -Path (Join-Path $config.stateDirectory 'last-success.json') -ReplacePointer -Value @{
      format=1; runId=$runId; sourceBackupDirectory=$backup; receiptFile=$receipt; receiptSha256=(Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash.ToLowerInvariant(); verifiedAtUtc=[DateTime]::UtcNow.ToString('o') }
    return $result
  } catch {
    $allowed = @('INVALID_PATH','UNSAFE_ROOT_PATH','OUTPUT_INSIDE_REPOSITORY','LINKED_PATH','MISSING_FILE','INVALID_RUNNER_CONFIG',
      'INVALID_PUBLIC_RECIPIENT','PREFLIGHT_FAILED','CAPTURE_FAILED','UPLOAD_FAILED','MISSING_VERIFIED_RECEIPT','RECEIPT_HASH_MISMATCH','RECEIPT_REPORT_FAILED')
    $result.status='FAILED'
    if ($_.Exception.Message -in $allowed) { $result.reason=$_.Exception.Message }
    return $result
  } finally {
    try {
      if ($runDirectory) { Write-IereRunnerJson -Path (Join-Path $runDirectory 'result.json') -Value $result }
    } catch {
      $result.status='FAILED'; $result.reason='RESULT_LOG_WRITE_FAILED'
    } finally { if ($lock) { $lock.Dispose() } }
  }
}

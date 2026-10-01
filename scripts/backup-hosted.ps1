param(
  [Parameter(Mandatory=$true)][string]$SourceConfig,
  [Parameter(Mandatory=$true)][string]$ToolImage,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'backup-runner.ps1')
$repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source=Get-IereSafeRunnerPath -Path $SourceConfig -RepositoryRoot $repository -OutsideRepository -RequireFile
$output=Get-IereSafeRunnerPath -Path $OutputDirectory -RepositoryRoot $repository -OutsideRepository
if ($ToolImage -notmatch '^sha256:[a-f0-9]{64}$') { throw 'PINNED_TOOL_IMAGE_REQUIRED' }
New-IerePrivateRunnerDirectory -Path $output
$name='hosted-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N')
$result=Invoke-IereRunnerProcess -Program 'docker' -RepositoryRoot $repository -Arguments @(
  'run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--tmpfs','/tmp:rw,nosuid,noexec,size=256m', '--tmpfs','/var/lib/postgresql/data:rw,nosuid,noexec,size=1m',
  '--mount',"type=bind,source=$source,target=/config/hosted-source.json,readonly",
  '--mount',"type=bind,source=$output,target=/capture", '--entrypoint','bun',
  $ToolImage,'--no-env-file','scripts/backup-hosted.mjs','/config/hosted-source.json',"/capture/$name")
if (($result | ConvertFrom-Json).status -ne 'PASS_HOSTED_CAPTURE') { throw 'HOSTED_CAPTURE_FAILED' }
$backup=Join-Path $output $name
if (-not (Test-Path -LiteralPath (Join-Path $backup 'manifest.json')) -or (Test-Path -LiteralPath (Join-Path $backup 'INCOMPLETE.txt'))) { throw 'HOSTED_CAPTURE_INCOMPLETE' }
Write-Output "Backup created and archive-validated: $backup"

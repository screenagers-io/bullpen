# Bullpen installer for Windows (PowerShell 5.1+).
#   irm https://raw.githubusercontent.com/screenagers-io/bullpen/main/install.ps1 | iex
# Starts from nothing: installs Herdr (its official installer), Git and Node.js LTS (winget) when they are
# missing, installs Bullpen from GitHub into npm's per-user global folder (no admin rights needed), and puts
# a Bullpen shortcut on the Desktop. Re-run it to update Bullpen.
# Options via env: BULLPEN_REF (default main), BULLPEN_NO_SHORTCUT=1, BULLPEN_NO_HERDR=1.
$ErrorActionPreference = 'Stop'
$Repo = if ($env:BULLPEN_REPO) { $env:BULLPEN_REPO } else { 'screenagers-io/bullpen' }
$Ref  = if ($env:BULLPEN_REF)  { $env:BULLPEN_REF }  else { 'main' }
$MinNode = 18

function Say($msg)  { Write-Host "bullpen " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Fail($msg) { Write-Host "bullpen " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Winget-Install($id, $what) {
  if (-not (Has 'winget')) { Fail "$what is missing and winget is not available. Install $what manually, then run this again." }
  Say "installing $what with winget"
  winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  Refresh-Path
}

$herdrInstalled = $false
if (Has 'herdr') { Say "herdr $((& herdr --version) -replace '^herdr\s*','') is installed" }
elseif ($env:BULLPEN_NO_HERDR) { Say 'skipping Herdr (BULLPEN_NO_HERDR is set)' }
else {
  Say 'Herdr not found; running its installer from https://herdr.dev'
  try { Invoke-Expression (Invoke-RestMethod https://herdr.dev/install.ps1 | Out-String) } catch { Fail "Herdr's installer failed: $($_.Exception.Message). See https://herdr.dev for other install methods." }
  Refresh-Path
  if (-not (Has 'herdr')) { $herdrBin = Join-Path $env:LOCALAPPDATA 'Programs\Herdr\bin'; if (Test-Path (Join-Path $herdrBin 'herdr.exe')) { $env:Path = "$herdrBin;$env:Path" } }
  if (-not (Has 'herdr')) { Fail "Herdr's installer finished but herdr is not on PATH; open a new terminal and run this again." }
  $herdrInstalled = $true
}

if (-not (Has 'git')) { Winget-Install 'Git.Git' 'Git' }
if (-not (Has 'git')) { Fail 'Git was installed but is not on PATH yet; open a new terminal and run this again.' }

$nodeOk = $false
if (Has 'node') { $v = (& node -v) -replace '^v',''; $nodeOk = ([int]($v.Split('.')[0]) -ge $MinNode) }
if (-not $nodeOk) { Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
if (-not (Has 'node')) { Fail 'Node.js was installed but is not on PATH yet; open a new terminal and run this again.' }
Say "using node $(& node -v)"

Say "installing Bullpen from github.com/$Repo#$Ref"
& npm install -g --no-fund --no-audit --loglevel=error "git+https://github.com/$Repo.git#$Ref"
if ($LASTEXITCODE -ne 0) { Fail "npm could not fetch github.com/$Repo. Check your network (and git credentials if the repo is private), then retry." }
Refresh-Path

$npmBin = (& npm prefix -g).Trim()
$cmd = Join-Path $npmBin 'bullpen.cmd'
if (-not (Test-Path $cmd)) { Fail "install finished but $cmd is missing" }
$version = (& $cmd --version).Trim()
Say "installed bullpen $version -> $cmd"

if (-not $env:BULLPEN_NO_SHORTCUT) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'Bullpen.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $cmd
  $s.WorkingDirectory = $env:USERPROFILE
  $s.Description = 'Bullpen: 3D office for your Herdr agents'
  $s.WindowStyle = 7   # minimised console; closing it stops the server
  $s.Save()
  Say "created $lnk"
}

$agents = @('claude','codex','gemini','copilot','cursor-agent','opencode','cline','amp') | Where-Object { Has $_ }
Write-Host ''
Say 'done.'
if ($herdrInstalled) { Say '1. open a new terminal and run:  herdr        (Herdr''s workspace; agents run inside it)' }
else { Say '1. run  herdr  in a terminal if it is not already open' }
Say '2. run:  bullpen        (or  bullpen --demo  to look around without agents)'
if ($agents.Count -eq 0) {
  Say 'no coding-agent CLI found yet. Herdr drives tools like Claude Code, Codex or Gemini CLI; install at least one, e.g.'
  Say '   npm install -g @anthropic-ai/claude-code      (then use Bullpen''s + Agent button)'
} else { Say "agent CLIs found: $($agents -join ' ')" }

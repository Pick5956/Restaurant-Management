$RuntimeLoggingProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function New-RuntimeLogStream {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("backend", "frontend", "tunnel")]
    [string]$Producer,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[a-z0-9-]+$")]
    [string]$RunName
  )

  $logsRoot = Join-Path $RuntimeLoggingProjectRoot "logs"
  $currentDir = Join-Path $logsRoot "$Producer\current"

  New-Item -ItemType Directory -Force -Path $currentDir | Out-Null

  $resolvedLogsRoot = (Resolve-Path $logsRoot).Path.TrimEnd("\")
  $resolvedCurrentDir = (Resolve-Path $currentDir).Path
  $logsPrefix = "$resolvedLogsRoot\"

  if (-not $resolvedCurrentDir.StartsWith($logsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Runtime log path escaped the project logs directory."
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $stdoutPath = Join-Path $resolvedCurrentDir "$timestamp-$Producer-$RunName.out.log"
  $stderrPath = Join-Path $resolvedCurrentDir "$timestamp-$Producer-$RunName.err.log"
  New-Item -ItemType File -Force -Path $stdoutPath, $stderrPath | Out-Null

  [PSCustomObject]@{
    Stdout = $stdoutPath
    Stderr = $stderrPath
  }
}

# Invoke-LoggedNativeProcess runs a native program to completion with its output
# captured to files, and returns its exit code.
#
# It exists because `& prog 1>> out 2>> err` is a trap in Windows PowerShell 5.1:
# every line the program writes to stderr is wrapped in an ErrorRecord
# (NativeCommandError), which under `$ErrorActionPreference = "Stop"` is a
# terminating error. The script dies, and the program dies with it - even though
# the program was healthy and the line was routine.
#
# That is not hypothetical. Go's logger writes its successful "backend listening"
# line to stderr, and Next writes an internal NoFallbackError to stderr for any
# request to a `dynamicParams = false` route it has not prerendered - a plain 404
# that it answers correctly. Either one used to take the whole public site down.
# See docs/wiki/gotchas/windows-powershell-cloudflared-stderr.md.
#
# WorkingDirectory defaults to the current location, which is what both callers
# already Set-Location to before invoking this.
function Invoke-LoggedNativeProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    # Empty is allowed: a binary started with no arguments is a normal call.
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$StdoutPath,

    [Parameter(Mandatory = $true)]
    [string]$StderrPath,

    [string]$WorkingDirectory = $PWD.Path
  )

  $stdoutStream = $null
  $stderrStream = $null
  $process = $null
  try {
    # bufferSize 1 disables FileStream's own buffering. With the 4096-byte
    # default nothing reaches disk until the buffer fills or the stream is
    # disposed, so a long-running server's log file stays 0 bytes for as long as
    # it is healthy - which is exactly when something goes wrong and the log is
    # the first thing anyone opens. Costs an extra write syscall per chunk;
    # these are low-volume operational logs, not a hot path.
    $stdoutStream = New-Object System.IO.FileStream(
      $StdoutPath,
      [System.IO.FileMode]::Append,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::ReadWrite,
      1
    )
    $stderrStream = New-Object System.IO.FileStream(
      $StderrPath,
      [System.IO.FileMode]::Append,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::ReadWrite,
      1
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = $WorkingDirectory

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
      throw "Process could not be started: $FilePath"
    }

    $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)
    $stderrCopy = $process.StandardError.BaseStream.CopyToAsync($stderrStream)
    $process.WaitForExit()
    $stdoutCopy.GetAwaiter().GetResult() | Out-Null
    $stderrCopy.GetAwaiter().GetResult() | Out-Null
    return $process.ExitCode
  } finally {
    if ($process) {
      if (-not $process.HasExited) {
        try {
          $process.Kill()
          $process.WaitForExit()
        } catch {
          # Preserve the original interruption/error while still attempting cleanup.
        }
      }
      $process.Dispose()
    }
    if ($stdoutStream) {
      $stdoutStream.Dispose()
    }
    if ($stderrStream) {
      $stderrStream.Dispose()
    }
  }
}

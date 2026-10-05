param([Parameter(Mandatory=$true)][string]$LockPath)
$ErrorActionPreference = 'Stop'
try {
    # FileShare.None is an OS lock; crash and process exit release it. Never unlink.
    $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    [Console]::Out.WriteLine('locked')
    [Console]::Out.Flush()
    while ([Console]::In.Read() -ne -1) {}
    $stream.Dispose()
} catch { exit 73 }

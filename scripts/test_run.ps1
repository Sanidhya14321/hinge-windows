$proc = Start-Process -FilePath "node_modules\.bin\electron.cmd" -ArgumentList "." -PassThru
Start-Sleep -Seconds 5
if (-not $proc.HasExited) {
    Write-Output "SUCCESS: Hinge (for Windows) started and is running cleanly with PID $($proc.Id)!"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} else {
    Write-Output "ERROR: Process exited prematurely with code $($proc.ExitCode)"
}

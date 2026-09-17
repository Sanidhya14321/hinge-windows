try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Devices.Sensors.HingeAngleSensor, Windows.Devices.Sensors, ContentType = WindowsRuntime] | Out-Null
    Write-Output "WINRT_TYPE_OK"
    $asyncOp = [Windows.Devices.Sensors.HingeAngleSensor]::GetDefaultAsync()
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }
    $task = $asTaskMethod.MakeGenericMethod([Windows.Devices.Sensors.HingeAngleSensor]).Invoke($null, @($asyncOp))
    $task.Wait(1500) | Out-Null
    $sensor = $task.Result
    if ($null -ne $sensor) {
        Write-Output "HARDWARE_SENSOR_FOUND"
    } else {
        Write-Output "NO_HARDWARE_SENSOR"
    }
} catch {
    Write-Output ("SENSOR_PROBE_ERROR: " + $_.Exception.Message)
}

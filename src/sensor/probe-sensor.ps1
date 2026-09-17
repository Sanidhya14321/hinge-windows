try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Sensors.Inclinometer, Windows.Devices.Sensors, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Sensors.HingeAngleSensor, Windows.Devices.Sensors, ContentType = WindowsRuntime]

    # 1. Check for physical Inclinometer (common on convertible laptops like HP x360, Lenovo Yoga, etc.)
    $inc = [Windows.Devices.Sensors.Inclinometer]::GetDefault()
    if ($null -ne $inc) {
        $reading = $inc.GetCurrentReading()
        if ($null -ne $reading) {
            Write-Output "HARDWARE_SENSOR_FOUND"
            Write-Output "TYPE:Inclinometer"
            Write-Output "ANGLE:$([Math]::Round($reading.PitchDegrees, 1))"
            exit 0
        }
    }

    # 2. Check for HingeAngleSensor
    $asyncOp = [Windows.Devices.Sensors.HingeAngleSensor]::GetDefaultAsync()
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }
    $task = $asTaskMethod.MakeGenericMethod([Windows.Devices.Sensors.HingeAngleSensor]).Invoke($null, @($asyncOp))
    $task.Wait(1500) | Out-Null
    $sensor = $task.Result
    if ($null -ne $sensor) {
        Write-Output "HARDWARE_SENSOR_FOUND"
        Write-Output "TYPE:HingeAngleSensor"
        exit 0
    }

    Write-Output "NO_HARDWARE_SENSOR"
} catch {
    Write-Output ("SENSOR_PROBE_ERROR: " + $_.Exception.Message)
}

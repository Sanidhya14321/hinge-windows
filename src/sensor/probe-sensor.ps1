try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Sensors.Accelerometer, Windows.Devices.Sensors, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Sensors.Inclinometer, Windows.Devices.Sensors, ContentType = WindowsRuntime]

    # 1. Accelerometer (Calculates true 0° closed to 180° flat angle)
    $acc = [Windows.Devices.Sensors.Accelerometer]::GetDefault()
    if ($null -ne $acc) {
        $a = $acc.GetCurrentReading()
        if ($null -ne $a) {
            $rad = [Math]::Atan2(-$a.AccelerationZ, -$a.AccelerationY)
            $deg = [Math]::Round($rad * (180.0 / [Math]::PI) + 90.0, 1)
            $deg = [Math]::Max(0.0, [Math]::Min(180.0, $deg))

            Write-Output "HARDWARE_SENSOR_FOUND"
            Write-Output "TYPE:Accelerometer"
            Write-Output "ANGLE:$deg"
            exit 0
        }
    }

    # 2. Inclinometer fallback
    $inc = [Windows.Devices.Sensors.Inclinometer]::GetDefault()
    if ($null -ne $inc) {
        $reading = $inc.GetCurrentReading()
        if ($null -ne $reading) {
            $deg = [Math]::Round(180.0 - [Math]::Abs($reading.PitchDegrees), 1)
            $deg = [Math]::Max(0.0, [Math]::Min(180.0, $deg))
            Write-Output "HARDWARE_SENSOR_FOUND"
            Write-Output "TYPE:Inclinometer"
            Write-Output "ANGLE:$deg"
            exit 0
        }
    }

    Write-Output "NO_HARDWARE_SENSOR"
} catch {
    Write-Output ("SENSOR_PROBE_ERROR: " + $_.Exception.Message)
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Sensors.Accelerometer, Windows.Devices.Sensors, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Sensors.Inclinometer, Windows.Devices.Sensors, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Sensors.HingeAngleSensor, Windows.Devices.Sensors, ContentType = WindowsRuntime]

    # 1. Try Accelerometer (Provides true 0° closed to 180° flat angle)
    $acc = [Windows.Devices.Sensors.Accelerometer]::GetDefault()
    if ($null -ne $acc) {
        $acc.ReportInterval = 16
        [Console]::Out.WriteLine('{"status":"connected","type":"HP x360 Integrated Sensor (Live Hardware)"}')
        [Console]::Out.Flush()

        $lastAngle = -999.0
        while ($true) {
            $a = $acc.GetCurrentReading()
            if ($null -ne $a) {
                # Y is along screen height (negative when upright), Z is normal to screen surface
                # Upright (viewing): Y ≈ -0.94, Z ≈ -0.10 -> Angle ≈ 97°
                # Open flat (180°): Y ≈ 0, Z ≈ -1.0 -> Angle = 180°
                # Closed (0°): Y ≈ 0, Z ≈ +1.0 -> Angle = 0°
                $rad = [Math]::Atan2(-$a.AccelerationZ, -$a.AccelerationY)
                $deg = [Math]::Round($rad * (180.0 / [Math]::PI) + 90.0, 1)
                $deg = [Math]::Max(0.0, [Math]::Min(180.0, $deg))

                if ([Math]::Abs($deg - $lastAngle) -ge 0.1) {
                    [Console]::Out.WriteLine('{"angle":' + $deg + '}')
                    [Console]::Out.Flush()
                    $lastAngle = $deg
                }
            }
            [System.Threading.Thread]::Sleep(12)
        }
        exit 0
    }

    # 2. Fallback: Inclinometer
    $inc = [Windows.Devices.Sensors.Inclinometer]::GetDefault()
    if ($null -ne $inc) {
        $inc.ReportInterval = 16
        [Console]::Out.WriteLine('{"status":"connected","type":"Windows Inclinometer (Live Hardware)"}')
        [Console]::Out.Flush()

        $lastAngle = -999.0
        while ($true) {
            $r = $inc.GetCurrentReading()
            if ($null -ne $r) {
                # Inclinometer Pitch is 0° when flat (180° open), ~83° when upright, 180° when face down (0° closed)
                $deg = [Math]::Round(180.0 - [Math]::Abs($r.PitchDegrees), 1)
                $deg = [Math]::Max(0.0, [Math]::Min(180.0, $deg))
                if ([Math]::Abs($deg - $lastAngle) -ge 0.1) {
                    [Console]::Out.WriteLine('{"angle":' + $deg + '}')
                    [Console]::Out.Flush()
                    $lastAngle = $deg
                }
            }
            [System.Threading.Thread]::Sleep(12)
        }
        exit 0
    }

    Write-Output '{"status":"unavailable","reason":"No hardware sensor found"}'
} catch {
    Write-Output ("{`"status`":`"error`",`"message`":`"" + $_.Exception.Message.Replace('"', '\"') + "`"}")
}

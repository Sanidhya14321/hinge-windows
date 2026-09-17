try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Sensors.Inclinometer, Windows.Devices.Sensors, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Sensors.HingeAngleSensor, Windows.Devices.Sensors, ContentType = WindowsRuntime]

    # 1. Try Inclinometer
    $inc = [Windows.Devices.Sensors.Inclinometer]::GetDefault()
    if ($null -ne $inc) {
        $inc.ReportInterval = 16
        Write-Output '{"status":"connected","type":"Windows Inclinometer (Live Hardware)"}'

        $lastAngle = -999.0
        while ($true) {
            $r = $inc.GetCurrentReading()
            if ($null -ne $r) {
                $deg = [Math]::Round($r.PitchDegrees, 1)
                # Emit update if changed by at least 0.1 degree
                if ([Math]::Abs($deg - $lastAngle) -ge 0.1) {
                    Write-Output ("{`"angle`":" + $deg + "}")
                    $lastAngle = $deg
                }
            }
            Start-Sleep -Milliseconds 16
        }
        exit 0
    }

    # 2. Try HingeAngleSensor
    $asyncOp = [Windows.Devices.Sensors.HingeAngleSensor]::GetDefaultAsync()
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }
    $task = $asTaskMethod.MakeGenericMethod([Windows.Devices.Sensors.HingeAngleSensor]).Invoke($null, @($asyncOp))
    $task.Wait(1500) | Out-Null
    $sensor = $task.Result

    if ($null -ne $sensor) {
        $sensor.ReportInterval = 16
        Write-Output '{"status":"connected","type":"Windows HingeAngleSensor (Live Hardware)"}'
        $lastAngle = -999.0
        while ($true) {
            $r = $sensor.GetCurrentReading()
            if ($null -ne $r) {
                $deg = [Math]::Round($r.AngleInDegrees, 1)
                if ([Math]::Abs($deg - $lastAngle) -ge 0.1) {
                    Write-Output ("{`"angle`":" + $deg + "}")
                    $lastAngle = $deg
                }
            }
            Start-Sleep -Milliseconds 16
        }
        exit 0
    }

    Write-Output '{"status":"unavailable","reason":"No hardware sensor found"}'
} catch {
    Write-Output ("{`"status`":`"error`",`"message`":`"" + $_.Exception.Message.Replace('"', '\"') + "`"}")
}

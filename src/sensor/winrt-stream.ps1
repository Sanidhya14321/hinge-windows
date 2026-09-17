try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Devices.Sensors.HingeAngleSensor, Windows.Devices.Sensors, ContentType = WindowsRuntime] | Out-Null
    
    $asyncOp = [Windows.Devices.Sensors.HingeAngleSensor]::GetDefaultAsync()
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }
    $task = $asTaskMethod.MakeGenericMethod([Windows.Devices.Sensors.HingeAngleSensor]).Invoke($null, @($asyncOp))
    $task.Wait(1500) | Out-Null
    $sensor = $task.Result
    
    if ($null -eq $sensor) {
        Write-Output '{"status":"unavailable","reason":"No hardware hinge sensor"}'
        exit 0
    }
    
    Write-Output '{"status":"connected","type":"Windows.Devices.Sensors.HingeAngleSensor"}'
    
    # Try reading at report intervals
    $action = [System.Action[Windows.Devices.Sensors.HingeAngleSensor, Windows.Devices.Sensors.HingeAngleSensorReadingChangedEventArgs]]{
        param($sender, $args)
        $deg = [Math]::Round($args.Reading.AngleInDegrees, 1)
        Write-Output ("{`"angle`":" + $deg + "}")
    }
    
    Register-ObjectEvent -InputObject $sensor -EventName "ReadingChanged" -Action $action | Out-Null
    
    while ($true) {
        Start-Sleep -Milliseconds 1000
    }
} catch {
    Write-Output ("{`"status`":`"error`",`"message`":`"" + $_.Exception.Message.Replace('"', '\"') + "`"}")
}

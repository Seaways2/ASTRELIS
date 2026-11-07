[CmdletBinding()]
param([switch]$RequireDevice)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$preferredExe = Join-Path $repoRoot "native-host\build\AuralisPluginHost_artefacts\Release\AuralisPluginHost.exe"
$exe = if (Test-Path -LiteralPath $preferredExe) {
  $preferredExe
} else {
  Get-ChildItem -LiteralPath (Join-Path $repoRoot "native-host\build") -Recurse -Filter "AuralisPluginHost.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
$manifestPath = Join-Path $repoRoot "auralis-version.json"
if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { throw "Native host is missing. Run pnpm build:native first." }

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$buildInfoText = & $exe --build-info
if ($LASTEXITCODE -ne 0) { throw "--build-info failed with exit code $LASTEXITCODE" }
$buildInfo = $buildInfoText | ConvertFrom-Json
if ($buildInfo.nativeHostVersion -ne $manifest.nativeHostVersion) {
  throw "Native host version mismatch: expected $($manifest.nativeHostVersion), actual $($buildInfo.nativeHostVersion)"
}
if ($buildInfo.controlProtocolVersion -ne $manifest.controlProtocolVersion) {
  throw "Control protocol mismatch: expected $($manifest.controlProtocolVersion), actual $($buildInfo.controlProtocolVersion)"
}
if ($buildInfo.pcmProtocolVersion -ne $manifest.pcmProtocolVersion) {
  throw "PCM protocol mismatch: expected $($manifest.pcmProtocolVersion), actual $($buildInfo.pcmProtocolVersion)"
}
$fileVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
if ($fileVersion -ne $manifest.nativeHostVersion) {
  throw "Native host file metadata mismatch: expected $($manifest.nativeHostVersion), actual $fileVersion"
}
Write-Output "Native build compatibility: PASS"
Write-Output ($buildInfo | ConvertTo-Json -Compress)

$directTestText = & $exe --hdmi-direct-self-test
if ($LASTEXITCODE -ne 0) { throw "HDMI direct self-test failed: $directTestText" }
Write-Output $directTestText

$powerStateTestText = & $exe --process-power-throttling-self-test
if ($LASTEXITCODE -ne 0) { throw "--process-power-throttling-self-test failed with exit code $LASTEXITCODE" }
$powerStateTest = $powerStateTestText | ConvertFrom-Json
if (-not $powerStateTest.ok) { throw "Power throttling state transition self-test failed." }
Write-Output "Native process power-throttling state transitions: PASS"
Write-Output ($powerStateTest | ConvertTo-Json -Compress)

$lifecycleText = & $exe --playback-lifecycle-self-test
if ($LASTEXITCODE -ne 0) { throw "--playback-lifecycle-self-test failed with exit code $LASTEXITCODE : $lifecycleText" }
if (($lifecycleText -join [Environment]::NewLine) -notmatch "Native file playback lifecycle, bounded read-ahead, and state snapshot IO: PASS") { throw "Native playback lifecycle test failed: $lifecycleText" }
Write-Output "Native file playback, stop, pre-read and plugin-state IO: PASS"
Write-Output $lifecycleText

if ($RequireDevice) {
  $deviceInfoText = & $exe --engine-info
  if ($LASTEXITCODE -ne 0) { throw "--engine-info failed with exit code $LASTEXITCODE" }
  $deviceInfo = $deviceInfoText | ConvertFrom-Json
  if (-not $deviceInfo.ready) { throw "Native audio device is not ready: $($deviceInfo.error)" }
  if (-not $deviceInfo.device -or $deviceInfo.sampleRate -le 0 -or $deviceInfo.bufferSize -le 0) {
    throw "Native device status is incomplete"
  }
  Write-Output "Native device smoke test: PASS"
  Write-Output ($deviceInfo | ConvertTo-Json -Compress)

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $exe
  # Windows PowerShell 5.1 does not expose ProcessStartInfo.ArgumentList.
  $startInfo.Arguments = "--engine"
  $startInfo.WorkingDirectory = Split-Path -Parent $exe
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $startInfo.EnvironmentVariables["AURALIS_ENABLE_TEST_FAULTS"] = "1"
  $engine = [System.Diagnostics.Process]::new()
  $engine.StartInfo = $startInfo
  [void]$engine.Start()

  function Invoke-EngineCommand([hashtable]$Command) {
    $engine.StandardInput.WriteLine(($Command | ConvertTo-Json -Compress -Depth 12))
    $engine.StandardInput.Flush()
    $line = $engine.StandardOutput.ReadLine()
    if (-not $line) { throw "Native engine closed the response stream unexpectedly." }
    return $line | ConvertFrom-Json
  }

  try {
    $statusBefore = Invoke-EngineCommand @{ protocolVersion = [int]$manifest.controlProtocolVersion; requestId = "test-status-before"; type = "device-status" }
    if (-not $statusBefore.ok -or $statusBefore.requestId -ne "test-status-before" -or $statusBefore.responseKind -ne "response") {
      throw "Versioned request/response correlation failed for device-status."
    }
    if ($statusBefore.backend -notin @("wasapi-shared", "wasapi-shared-low-latency", "wasapi-exclusive", "directsound-legacy")) {
      throw "Unexpected active Windows backend: $($statusBefore.backend)"
    }

    $dryRack = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-dry-rack"
      type = "rack"
      plugins = @()
    }
    if (-not $dryRack.ok -or $dryRack.processingMode -ne "dry" -or $dryRack.plugins -ne 0) {
      throw "Empty VST rack did not produce a deterministic dry path."
    }
    $fadeStatus = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-fade-setting"
      type = "fade"
      durationMs = 425
    }
    if (-not $fadeStatus.ok -or $fadeStatus.fadeMs -ne 425 -or $fadeStatus.processingMode -ne "dry") {
      throw "Native Fade changed processing mode or failed to apply."
    }
    $dryStatus = Invoke-EngineCommand @{ protocolVersion = [int]$manifest.controlProtocolVersion; requestId = "test-dry-status"; type = "device-status" }
    if (-not $dryStatus.ok -or $dryStatus.juceTypeName -ne $statusBefore.juceTypeName -or $dryStatus.juceDeviceName -ne $statusBefore.juceDeviceName) {
      throw "VST-off dry-path setup changed the selected output route."
    }
    Write-Output "Native dry path, VST independence, and Fade control: PASS"

    $enumeration = Invoke-EngineCommand @{ protocolVersion = [int]$manifest.controlProtocolVersion; requestId = "test-enumerate"; type = "device-enumerate" }
    if (-not $enumeration.ok -or $enumeration.requestId -ne "test-enumerate" -or @($enumeration.devices).Count -eq 0) {
      throw "Native output enumeration returned no usable devices."
    }
    $activeDevices = @($enumeration.devices | Where-Object { $_.active })
    if ($activeDevices.Count -ne 1) { throw "Expected exactly one active native output, found $($activeDevices.Count)." }
    if (@($enumeration.devices | Where-Object { $_.backend -eq "asio" }).Count -gt 0) {
      throw "ASIO is not a public 2.3.16 backend and must not be enumerated."
    }

    $active = $activeDevices[0]
    $capabilities = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-capabilities"
      type = "device-capabilities"
      juceTypeName = [string]$active.juceTypeName
      juceDeviceName = [string]$active.juceDeviceName
    }
    if (-not $capabilities.ok -or $capabilities.requestId -ne "test-capabilities" -or @($capabilities.availableSampleRates).Count -eq 0) {
      throw "Active output capability query is incomplete."
    }

    $mismatch = Invoke-EngineCommand @{ protocolVersion = 2147483647; requestId = "test-version-mismatch"; type = "device-status" }
    if ($mismatch.ok -or $mismatch.error -ne "CONTROL_PROTOCOL_MISMATCH" -or $mismatch.requestId -ne "test-version-mismatch") {
      throw "Control protocol mismatch was not rejected deterministically."
    }

    $statusAfter = Invoke-EngineCommand @{ protocolVersion = [int]$manifest.controlProtocolVersion; requestId = "test-status-after"; type = "device-status" }
    if (-not $statusAfter.ok -or $statusAfter.juceTypeName -ne $statusBefore.juceTypeName -or $statusAfter.juceDeviceName -ne $statusBefore.juceDeviceName) {
      throw "Read-only discovery changed the active output device."
    }
    Write-Output "Native device protocol and read-only discovery: PASS"
    Write-Output ($enumeration | ConvertTo-Json -Compress -Depth 12)

    $candidate = @{
      backend = [string]$statusBefore.backend
      juceDeviceName = [string]$statusBefore.juceDeviceName
      platformEndpointId = [string]$statusBefore.platformEndpointId
      sampleRateMode = "fixed"
      fixedSampleRate = [double]$statusBefore.sampleRate
      bufferMode = "fixed"
      fixedBufferSize = [int]$statusBefore.bufferSize
      exclusiveFallback = "shared-low-latency"
    }
    $sameApply = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-transaction-same"
      type = "device-apply"
      generation = 1
      candidate = $candidate
    }
    if (-not $sameApply.ok -or -not $sameApply.committed -or
        $sameApply.degraded -or $sameApply.actual.backend -ne $statusBefore.backend) {
      throw "Valid same-device transaction did not commit cleanly: $($sameApply.error)"
    }

    $badRate = $candidate.Clone()
    $badRate.fixedSampleRate = 12345
    $rejectedRate = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-transaction-bad-rate"
      type = "device-apply"
      generation = 2
      candidate = $badRate
    }
    if ($rejectedRate.ok -or $rejectedRate.error -ne "UNSUPPORTED_SAMPLE_RATE") {
      throw "Unsupported fixed rate was not rejected before apply."
    }

    $badBuffer = $candidate.Clone()
    $badBuffer.fixedBufferSize = 12345
    $rejectedBuffer = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-transaction-bad-buffer"
      type = "device-apply"
      generation = 3
      candidate = $badBuffer
    }
    if ($rejectedBuffer.ok -or $rejectedBuffer.error -ne "UNSUPPORTED_BUFFER_SIZE") {
      throw "Unsupported fixed buffer was not rejected before apply."
    }

    $postOpenFailure = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-transaction-post-open-failure"
      type = "device-apply"
      generation = 4
      testFault = "after-open"
      candidate = $candidate
    }
    if ($postOpenFailure.ok -or $postOpenFailure.committed -or
        $postOpenFailure.recovery -ne "previous-route-restored" -or
        $postOpenFailure.actual.backend -ne $statusBefore.backend) {
      throw "Post-open health failure did not restore the previous route."
    }

    $rollbackFailure = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-transaction-rollback-failure"
      type = "device-apply"
      generation = 5
      testFault = "after-open-and-rollback"
      candidate = $candidate
    }
    if ($rollbackFailure.ok -or $rollbackFailure.committed -or -not $rollbackFailure.degraded -or
        $rollbackFailure.recovery -ne "safe-shared-restored" -or
        $rollbackFailure.actual.backend -ne "wasapi-shared") {
      throw "Rollback failure did not recover to safe WASAPI Shared."
    }

    $generation = 10
    foreach ($backend in @("wasapi-shared-low-latency", "wasapi-exclusive", "wasapi-shared")) {
      $modeDevice = @($enumeration.devices | Where-Object {
        $_.backend -eq $backend -and (
          ($active.platformEndpointId -and $_.platformEndpointId -eq $active.platformEndpointId) -or
          (-not $active.platformEndpointId -and $_.juceDeviceName -eq $active.juceDeviceName)
        )
      }) | Select-Object -First 1
      if (-not $modeDevice) { throw "Matching endpoint not enumerated for $backend" }
      $modeCandidate = @{
        backend = $backend
        juceDeviceName = [string]$modeDevice.juceDeviceName
        platformEndpointId = [string]$modeDevice.platformEndpointId
        sampleRateMode = "system"
        bufferMode = "auto"
        exclusiveFallback = "shared-low-latency"
      }
      $modeApply = Invoke-EngineCommand @{
        protocolVersion = [int]$manifest.controlProtocolVersion
        requestId = "test-mode-$generation"
        type = "device-apply"
        generation = $generation
        candidate = $modeCandidate
      }
      if (-not $modeApply.ok -or -not $modeApply.committed -or
          $modeApply.degraded -or $modeApply.actual.backend -ne $backend) {
        throw "$backend transaction failed or silently degraded: $($modeApply.error) / $($modeApply.recovery)"
      }
      $generation++
    }

    foreach ($backend in @("wasapi-shared", "wasapi-shared-low-latency")) {
      $modeDevice = @($enumeration.devices | Where-Object {
        $_.backend -eq $backend -and $_.platformEndpointId -eq $active.platformEndpointId
      }) | Select-Object -First 1
      $continuityCandidate = @{
        backend = $backend
        juceDeviceName = [string]$modeDevice.juceDeviceName
        platformEndpointId = [string]$modeDevice.platformEndpointId
        sampleRateMode = "follow-source"
        bufferMode = "auto"
        exclusiveFallback = "shared-low-latency"
      }
      $continuity = Invoke-EngineCommand @{
        protocolVersion = [int]$manifest.controlProtocolVersion
        requestId = "test-continuity-$generation"
        type = "device-apply"
        generation = $generation
        sourceSampleRateHint = 48000
        candidate = $continuityCandidate
      }
      if (-not $continuity.ok -or $continuity.sampleRateDecision -ne "continuity-resample") {
        throw "$backend did not preserve continuity/resampler policy for Follow Source."
      }
      $generation++
    }

    $requiredRates = @(44100, 48000, 96000)
    $exclusiveDevice = $null
    $exclusiveCapabilities = $null
    foreach ($candidateDevice in @($enumeration.devices | Where-Object { $_.backend -eq "wasapi-exclusive" })) {
      $candidateCapabilities = Invoke-EngineCommand @{
        protocolVersion = [int]$manifest.controlProtocolVersion
        requestId = "test-exclusive-rate-capabilities-$($candidateDevice.juceDeviceName)"
        type = "device-capabilities"
        juceTypeName = [string]$candidateDevice.juceTypeName
        juceDeviceName = [string]$candidateDevice.juceDeviceName
      }
      if (@($requiredRates | Where-Object { $_ -notin @($candidateCapabilities.availableSampleRates) }).Count -eq 0) {
        $exclusiveDevice = $candidateDevice
        $exclusiveCapabilities = $candidateCapabilities
        break
      }
    }
    if (-not $exclusiveDevice) {
      throw "No enumerated Exclusive endpoint truthfully reports the required 44.1/48/96 kHz matrix."
    }
    foreach ($rate in @(44100, 48000, 96000, 44100)) {
      if ($rate -notin @($exclusiveCapabilities.availableSampleRates)) {
        throw "Required Follow Source matrix rate is unavailable on the selected endpoint: $rate Hz"
      }
      $followCandidate = @{
        backend = "wasapi-exclusive"
        juceDeviceName = [string]$exclusiveDevice.juceDeviceName
        platformEndpointId = [string]$exclusiveDevice.platformEndpointId
        sampleRateMode = "follow-source"
        bufferMode = "auto"
        exclusiveFallback = "shared-low-latency"
      }
      $follow = Invoke-EngineCommand @{
        protocolVersion = [int]$manifest.controlProtocolVersion
        requestId = "test-follow-$generation-$rate"
        type = "device-apply"
        generation = $generation
        sourceSampleRateHint = $rate
        candidate = $followCandidate
      }
      if (-not $follow.ok -or $follow.degraded -or $follow.actual.sampleRate -ne $rate -or
          $follow.sampleRateDecision -ne "exclusive-follow-source-reconfigure") {
        throw "Exclusive Follow Source failed at $rate Hz: $($follow.error) / $($follow.sampleRateDecision)"
      }
      $generation++
    }

    $restoreShared = Invoke-EngineCommand @{
      protocolVersion = [int]$manifest.controlProtocolVersion
      requestId = "test-follow-restore-shared"
      type = "device-apply"
      generation = $generation
      candidate = @{
        backend = "wasapi-shared"
        juceDeviceName = [string]$active.juceDeviceName
        platformEndpointId = [string]$active.platformEndpointId
        sampleRateMode = "system"
        bufferMode = "auto"
        exclusiveFallback = "shared-low-latency"
      }
    }
    if (-not $restoreShared.ok -or $restoreShared.actual.backend -ne "wasapi-shared") {
      throw "Follow Source matrix did not restore Shared output."
    }
    $transactionFinal = Invoke-EngineCommand @{ protocolVersion = [int]$manifest.controlProtocolVersion; requestId = "test-transaction-final"; type = "device-status" }
    if (-not $transactionFinal.ok -or $transactionFinal.backend -ne "wasapi-shared" -or
        $transactionFinal.juceDeviceName -ne $statusBefore.juceDeviceName) {
      throw "Transaction matrix did not restore the original Shared endpoint."
    }
    Write-Output "Native Follow Source 44.1 -> 48 -> 96 -> 44.1 and continuity policy matrix: PASS"
    Write-Output "Native WASAPI transaction, rollback, safe fallback, and preflight matrix: PASS"
  } finally {
    $engine.StandardInput.Close()
    if (-not $engine.WaitForExit(5000)) { $engine.Kill() }
    $stderr = $engine.StandardError.ReadToEnd()
    if ($engine.ExitCode -ne 0) { throw "Native engine protocol test failed with exit code $($engine.ExitCode): $stderr" }
  }
}

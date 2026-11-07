cmake_minimum_required(VERSION 3.22)

set(AURALIS_VERSION_MANIFEST "${CMAKE_CURRENT_SOURCE_DIR}/../auralis-version.json")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${AURALIS_VERSION_MANIFEST}")
file(READ "${AURALIS_VERSION_MANIFEST}" AURALIS_VERSION_JSON)
string(JSON AURALIS_NATIVE_HOST_VERSION GET "${AURALIS_VERSION_JSON}" nativeHostVersion)
string(JSON AURALIS_CONTROL_PROTOCOL_VERSION GET "${AURALIS_VERSION_JSON}" controlProtocolVersion)
string(JSON AURALIS_PCM_PROTOCOL_VERSION GET "${AURALIS_VERSION_JSON}" pcmProtocolVersion)

project(AuralisPluginHost VERSION ${AURALIS_NATIVE_HOST_VERSION} LANGUAGES CXX)

add_subdirectory(third_party/JUCE)

juce_add_console_app(AuralisPluginHost
  PRODUCT_NAME "Auralis Plugin Host")

target_sources(AuralisPluginHost PRIVATE
  src/Main.cpp src/PlaybackEngine.cpp src/PlaybackEngine.h src/PlaybackEngineTests.cpp src/AuralisVersion.h
  src/HdmiDirectOutput.cpp src/HdmiDirectOutput.h
  src/AudioSessionProbe.cpp src/AudioSessionProbe.h
  src/DryPathIsolationProbe.cpp src/DryPathIsolationProbe.h
  src/ProcessPowerThrottlingProbe.cpp src/ProcessPowerThrottlingProbe.h
  src/ProcessLoopbackProbe.cpp src/ProcessLoopbackProbe.h
  src/AuralisAudioSource.cpp src/AuralisAudioSource.h
  src/BrowserPcmPipeServer.cpp src/BrowserPcmPipeServer.h src/BrowserPcmProtocol.h
  src/ProcessLoopbackCapture.cpp src/ProcessLoopbackCapture.h
  src/PluginFormatAdapter.cpp src/PluginFormatAdapter.h
  src/PluginCompatibilityPolicy.cpp src/PluginCompatibilityPolicy.h)
target_compile_features(AuralisPluginHost PRIVATE cxx_std_20)
if (MSVC)
  target_compile_options(AuralisPluginHost PRIVATE /utf-8)
endif()
target_compile_definitions(AuralisPluginHost PRIVATE
  NOMINMAX
  AURALIS_NATIVE_HOST_VERSION="${AURALIS_NATIVE_HOST_VERSION}"
  AURALIS_CONTROL_PROTOCOL_VERSION=${AURALIS_CONTROL_PROTOCOL_VERSION}
  AURALIS_PCM_PROTOCOL_VERSION=${AURALIS_PCM_PROTOCOL_VERSION}
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=0
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0)
target_link_libraries(AuralisPluginHost PRIVATE
  juce::juce_audio_processors
  juce::juce_audio_utils
  juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags)
if (WIN32)
  target_link_libraries(AuralisPluginHost PRIVATE Avrt Mmdevapi Ole32 OleAut32 Advapi32 Propsys Uuid Wbemuuid)
endif()

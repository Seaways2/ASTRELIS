#pragma once

#include <juce_core/juce_core.h>

#ifndef AURALIS_NATIVE_HOST_VERSION
#define AURALIS_NATIVE_HOST_VERSION "0.0.0-unknown"
#endif

#ifndef AURALIS_CONTROL_PROTOCOL_VERSION
#define AURALIS_CONTROL_PROTOCOL_VERSION 0
#endif

#ifndef AURALIS_PCM_PROTOCOL_VERSION
#define AURALIS_PCM_PROTOCOL_VERSION 0
#endif

namespace AuralisVersion
{
inline constexpr const char* nativeHost = AURALIS_NATIVE_HOST_VERSION;
inline constexpr int controlProtocol = AURALIS_CONTROL_PROTOCOL_VERSION;
inline constexpr int pcmProtocol = AURALIS_PCM_PROTOCOL_VERSION;

inline void appendTo(juce::DynamicObject& object)
{
    object.setProperty("nativeHostVersion", nativeHost);
    object.setProperty("controlProtocolVersion", controlProtocol);
    object.setProperty("pcmProtocolVersion", pcmProtocol);
}
}

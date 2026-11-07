#pragma once

#include <juce_core/juce_core.h>

int runDryPathIsolationProbe(unsigned int processId, const juce::String& method,
                             int preSeconds, int appliedSeconds, int postSeconds,
                             double requestedSampleRate);

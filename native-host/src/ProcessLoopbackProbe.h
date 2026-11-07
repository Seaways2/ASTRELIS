#pragma once

#include <juce_core/juce_core.h>

int runProcessLoopbackProbe(unsigned int processId, const juce::String& processRole,
                            int durationSeconds, double requestedSampleRate);

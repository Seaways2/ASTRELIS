#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

struct AuralisCompatibilityProbe
{
    juce::var capabilities;
    juce::var decision;
    juce::AudioProcessor::BusesLayout stereoLayout;
    bool eligible = false;
};

AuralisCompatibilityProbe evaluateAuralisStereoInsert(juce::AudioPluginInstance& instance,
                                                       const juce::PluginDescription& description);


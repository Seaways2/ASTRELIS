#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

class PluginFormatAdapter
{
public:
    virtual ~PluginFormatAdapter() = default;
    virtual juce::String formatName() const = 0;
    virtual bool scannerAvailable() const = 0;
    virtual bool runtimeAvailable() const = 0;
    virtual bool matches(const juce::File& module) const = 0;
    virtual bool enumerate(const juce::File& module, juce::OwnedArray<juce::PluginDescription>& descriptions,
                           juce::String& error) = 0;
    virtual std::unique_ptr<juce::AudioPluginInstance> instantiate(const juce::PluginDescription& description,
                                                                   double sampleRate, int blockSize,
                                                                   juce::String& error) = 0;
};

std::unique_ptr<PluginFormatAdapter> createPluginFormatAdapter(const juce::File& module,
                                                                juce::AudioPluginFormatManager& formats);


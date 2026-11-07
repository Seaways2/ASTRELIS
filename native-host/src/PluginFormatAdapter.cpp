#include "PluginFormatAdapter.h"

namespace {
class Vst3PluginFormatAdapter final : public PluginFormatAdapter
{
public:
    explicit Vst3PluginFormatAdapter(juce::AudioPluginFormatManager& manager) : formats(manager) {}

    juce::String formatName() const override { return "VST3"; }
    bool scannerAvailable() const override { return true; }
    bool runtimeAvailable() const override { return true; }
    bool matches(const juce::File& module) const override { return module.hasFileExtension("vst3"); }

    bool enumerate(const juce::File& module, juce::OwnedArray<juce::PluginDescription>& descriptions,
                   juce::String& error) override
    {
        for (auto* format : formats.getFormats())
        {
            if (!format->getName().equalsIgnoreCase("VST3")) continue;
            if (!format->fileMightContainThisPluginType(module.getFullPathName()))
            {
                error = "The VST3 adapter rejected the module path";
                return false;
            }
            format->findAllTypesForFile(descriptions, module.getFullPathName());
            if (descriptions.isEmpty()) error = "The VST3 module exposed no plugin descriptors";
            return !descriptions.isEmpty();
        }
        error = "The JUCE VST3 scanner adapter is not available";
        return false;
    }

    std::unique_ptr<juce::AudioPluginInstance> instantiate(const juce::PluginDescription& description,
                                                           double sampleRate, int blockSize,
                                                           juce::String& error) override
    {
        return formats.createPluginInstance(description, sampleRate, blockSize, error);
    }

private:
    juce::AudioPluginFormatManager& formats;
};

class ClapPluginFormatAdapter final : public PluginFormatAdapter
{
public:
    juce::String formatName() const override { return "CLAP"; }
    bool scannerAvailable() const override { return false; }
    bool runtimeAvailable() const override { return false; }
    bool matches(const juce::File& module) const override { return module.hasFileExtension("clap"); }
    bool enumerate(const juce::File&, juce::OwnedArray<juce::PluginDescription>&, juce::String& error) override
    {
        error = "CLAP adapter contract is registered, but the native CLAP host is not linked";
        return false;
    }
    std::unique_ptr<juce::AudioPluginInstance> instantiate(const juce::PluginDescription&, double, int,
                                                           juce::String& error) override
    {
        error = "CLAP runtime adapter is not available";
        return {};
    }
};
}

std::unique_ptr<PluginFormatAdapter> createPluginFormatAdapter(const juce::File& module,
                                                                juce::AudioPluginFormatManager& formats)
{
    auto vst3 = std::make_unique<Vst3PluginFormatAdapter>(formats);
    if (vst3->matches(module)) return vst3;
    auto clap = std::make_unique<ClapPluginFormatAdapter>();
    if (clap->matches(module)) return clap;
    return {};
}

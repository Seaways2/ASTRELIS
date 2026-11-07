#include "PluginCompatibilityPolicy.h"

namespace {
constexpr double healthProbeSampleRate = 48000.0;
constexpr int healthProbeBlockSize = 512;
constexpr int healthProbeBlocks = 3;
constexpr int healthProbeVersion = 1;
constexpr int compatibilityPolicyVersion = 1;

juce::String layoutName(const juce::AudioChannelSet& layout)
{
    if (layout.isDisabled()) return "DISABLED";
    if (layout == juce::AudioChannelSet::mono()) return "MONO";
    if (layout == juce::AudioChannelSet::stereo()) return "STEREO";
    return layout.getDescription().toUpperCase();
}

juce::Array<juce::var> supportedLayouts(const juce::AudioProcessor::Bus& bus)
{
    juce::Array<juce::var> layouts;
    if (bus.isLayoutSupported(juce::AudioChannelSet::mono())) layouts.add("MONO");
    if (bus.isLayoutSupported(juce::AudioChannelSet::stereo())) layouts.add("STEREO");
    return layouts;
}

bool isSidechainName(const juce::String& name)
{
    const auto lower = name.toLowerCase();
    return lower.contains("sidechain") || lower.contains("side chain") || lower == "sc" || lower.contains("key input");
}

juce::var busToVar(const juce::AudioProcessor::Bus& bus)
{
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("direction", bus.isInput() ? "input" : "output");
    object->setProperty("index", bus.getBusIndex());
    object->setProperty("name", bus.getName());
    object->setProperty("role", bus.isMain() ? "main" : bus.isInput() && isSidechainName(bus.getName()) ? "sidechain" : "aux");
    object->setProperty("enabledByDefault", bus.isEnabledByDefault());
    object->setProperty("defaultLayout", layoutName(bus.getDefaultLayout()));
    object->setProperty("supportedLayouts", juce::var(supportedLayouts(bus)));
    return juce::var(object.release());
}

bool busHasAudio(const juce::AudioProcessor::Bus& bus)
{
    return !bus.getDefaultLayout().isDisabled()
        || bus.isLayoutSupported(juce::AudioChannelSet::mono())
        || bus.isLayoutSupported(juce::AudioChannelSet::stereo());
}

void addReason(juce::Array<juce::var>& reasons, const juce::String& reason)
{
    if (!reasons.contains(reason)) reasons.add(reason);
}

juce::var makeDecision(const juce::Array<juce::var>& reasons, bool eligible)
{
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("profile", "AURALIS_STEREO_INSERT");
    object->setProperty("eligible", eligible);
    object->setProperty("reasons", juce::var(reasons));
    object->setProperty("sampleRate", healthProbeSampleRate);
    object->setProperty("blockSize", healthProbeBlockSize);
    object->setProperty("processBlocks", healthProbeBlocks);
    object->setProperty("probeVersion", healthProbeVersion);
    object->setProperty("policyVersion", compatibilityPolicyVersion);
    return juce::var(object.release());
}
}

AuralisCompatibilityProbe evaluateAuralisStereoInsert(juce::AudioPluginInstance& instance,
                                                       const juce::PluginDescription& description)
{
    AuralisCompatibilityProbe result;
    juce::Array<juce::var> buses;
    int mainInputs = 0, mainOutputs = 0, auxInputs = 0, auxOutputs = 0, sidechainInputs = 0;
    bool hasAudioInput = false, hasAudioOutput = false;

    for (const auto isInput : { true, false })
    {
        for (int index = 0; index < instance.getBusCount(isInput); ++index)
        {
            auto* bus = instance.getBus(isInput, index);
            if (bus == nullptr) continue;
            buses.add(busToVar(*bus));
            const auto hasAudio = busHasAudio(*bus);
            if (isInput) hasAudioInput = hasAudioInput || hasAudio;
            else hasAudioOutput = hasAudioOutput || hasAudio;
            if (bus->isMain()) isInput ? ++mainInputs : ++mainOutputs;
            else if (isInput && isSidechainName(bus->getName())) ++sidechainInputs;
            else isInput ? ++auxInputs : ++auxOutputs;
        }
    }

    auto capabilities = std::make_unique<juce::DynamicObject>();
    capabilities->setProperty("audioInputAvailable", hasAudioInput);
    capabilities->setProperty("audioOutputAvailable", hasAudioOutput);
    capabilities->setProperty("mainInputBuses", mainInputs);
    capabilities->setProperty("mainOutputBuses", mainOutputs);
    capabilities->setProperty("auxInputBuses", auxInputs);
    capabilities->setProperty("auxOutputBuses", auxOutputs);
    capabilities->setProperty("sidechainInputBuses", sidechainInputs);
    capabilities->setProperty("buses", juce::var(buses));
    capabilities->setProperty("midiInput", instance.acceptsMidi());
    capabilities->setProperty("midiOutput", instance.producesMidi());
    capabilities->setProperty("instrument", description.isInstrument);
    capabilities->setProperty("category", description.category);

    juce::Array<juce::var> mainInputLayouts, mainOutputLayouts;
    if (auto* bus = instance.getBus(true, 0)) mainInputLayouts = supportedLayouts(*bus);
    if (auto* bus = instance.getBus(false, 0)) mainOutputLayouts = supportedLayouts(*bus);
    auto channelLayouts = std::make_unique<juce::DynamicObject>();
    channelLayouts->setProperty("mainInput", juce::var(mainInputLayouts));
    channelLayouts->setProperty("mainOutput", juce::var(mainOutputLayouts));
    capabilities->setProperty("supportedChannelLayouts", juce::var(channelLayouts.release()));

    auto formatFlags = std::make_unique<juce::DynamicObject>();
    formatFlags->setProperty("pluginFormat", description.pluginFormatName);
    formatFlags->setProperty("araExtension", description.hasARAExtension);
    formatFlags->setProperty("acceptsMidi", instance.acceptsMidi());
    formatFlags->setProperty("producesMidi", instance.producesMidi());
    capabilities->setProperty("formatSpecificFlags", juce::var(formatFlags.release()));

    auto ara = std::make_unique<juce::DynamicObject>();
    ara->setProperty("supported", description.hasARAExtension);
    ara->setProperty("required", false);
    ara->setProperty("variant", description.hasARAExtension);
    capabilities->setProperty("ara", juce::var(ara.release()));
    result.capabilities = juce::var(capabilities.release());

    juce::Array<juce::var> reasons;
    // Auralis deliberately hosts conventional stereo playback inserts only.
    // ARA descriptors require document/region services that this player does
    // not provide, so keep them visible for diagnostics but out of the rack.
    if (description.hasARAExtension) addReason(reasons, "ARA_NOT_SUPPORTED");
    if (description.isInstrument) addReason(reasons, "INSTRUMENT_NOT_SUPPORTED");
    else if (description.category.containsIgnoreCase("midi") && (!hasAudioInput || !hasAudioOutput))
        addReason(reasons, "MIDI_EFFECT_NOT_SUPPORTED");
    else if (!hasAudioOutput) addReason(reasons, "PLUGIN_HAS_NO_AUDIO_OUTPUT");
    else if (mainInputs == 0) addReason(reasons, "NO_MAIN_AUDIO_INPUT");
    else if (mainOutputs == 0) addReason(reasons, "NO_MAIN_AUDIO_OUTPUT");
    else
    {
        const auto* mainInput = instance.getBus(true, 0);
        const auto* mainOutput = instance.getBus(false, 0);
        const auto inputStereo = mainInput != nullptr && mainInput->isLayoutSupported(juce::AudioChannelSet::stereo());
        const auto outputStereo = mainOutput != nullptr && mainOutput->isLayoutSupported(juce::AudioChannelSet::stereo());
        if (!inputStereo)
            addReason(reasons, mainInput != nullptr && mainInput->isLayoutSupported(juce::AudioChannelSet::mono())
                ? "MONO_INPUT_ONLY" : "STEREO_INPUT_UNSUPPORTED");
        if (!outputStereo)
            addReason(reasons, mainOutput != nullptr && mainOutput->isLayoutSupported(juce::AudioChannelSet::mono())
                ? "MONO_OUTPUT_ONLY" : "STEREO_OUTPUT_UNSUPPORTED");

        if (reasons.isEmpty())
        {
            result.stereoLayout = instance.getBusesLayout();
            bool extraBusRequiresLayout = false;
            for (int index = 0; index < result.stereoLayout.inputBuses.size(); ++index)
            {
                if (index > 0)
                    if (auto* bus = instance.getBus(true, index))
                        extraBusRequiresLayout = extraBusRequiresLayout || !bus->isLayoutSupported(juce::AudioChannelSet::disabled());
                result.stereoLayout.inputBuses.getReference(index) = index == 0
                    ? juce::AudioChannelSet::stereo() : juce::AudioChannelSet::disabled();
            }
            for (int index = 0; index < result.stereoLayout.outputBuses.size(); ++index)
            {
                if (index > 0)
                    if (auto* bus = instance.getBus(false, index))
                        extraBusRequiresLayout = extraBusRequiresLayout || !bus->isLayoutSupported(juce::AudioChannelSet::disabled());
                result.stereoLayout.outputBuses.getReference(index) = index == 0
                    ? juce::AudioChannelSet::stereo() : juce::AudioChannelSet::disabled();
            }
            if (extraBusRequiresLayout) addReason(reasons, "REQUIRES_UNSUPPORTED_BUS_LAYOUT");
            else if (!instance.checkBusesLayoutSupported(result.stereoLayout) || !instance.setBusesLayout(result.stereoLayout))
                addReason(reasons, "STEREO_INSERT_UNSUPPORTED");
        }
    }

    result.eligible = reasons.isEmpty();
    result.decision = makeDecision(reasons, result.eligible);
    return result;
}

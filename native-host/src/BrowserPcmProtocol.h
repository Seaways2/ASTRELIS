#pragma once

#include <cstddef>
#include <cstdint>

namespace AuralisPcmProtocol
{
constexpr uint16_t version = 1;
constexpr uint16_t headerBytes = 56;
constexpr uint16_t channels = 2;
constexpr uint16_t binaryPacketFrames = 1024;
constexpr uint32_t magic = 0x4d435041u; // "APCM" in little-endian byte order.
constexpr uint32_t streamStart = 1u << 0;
constexpr uint32_t streamEnd = 1u << 1;
constexpr uint32_t discontinuity = 1u << 2;
constexpr uint32_t formatChange = 1u << 3;
constexpr uint32_t silence = 1u << 4;
constexpr uint32_t knownFlags = streamStart | streamEnd | discontinuity | formatChange | silence;
constexpr size_t maximumPayloadBytes = 16384u * channels * sizeof(float);

inline uint16_t readU16(const uint8_t* bytes) noexcept
{
    return static_cast<uint16_t>(bytes[0])
        | static_cast<uint16_t>(static_cast<uint16_t>(bytes[1]) << 8);
}

inline uint32_t readU32(const uint8_t* bytes) noexcept
{
    return static_cast<uint32_t>(bytes[0])
        | (static_cast<uint32_t>(bytes[1]) << 8)
        | (static_cast<uint32_t>(bytes[2]) << 16)
        | (static_cast<uint32_t>(bytes[3]) << 24);
}

inline uint64_t readU64(const uint8_t* bytes) noexcept
{
    uint64_t value = 0;
    for (int index = 7; index >= 0; --index)
        value = (value << 8) | static_cast<uint64_t>(bytes[index]);
    return value;
}

struct PacketMetadata
{
    uint32_t flags = 0;
    uint64_t mediaSessionId = 0;
    uint64_t sequence = 0;
    uint64_t sourceFrameCounter = 0;
    uint32_t sampleRate = 0;
    uint16_t channelCount = 0;
    uint16_t frames = 0;
    uint32_t payloadBytes = 0;
    uint64_t producerTimestampUs = 0;
};

inline bool parseHeader(const uint8_t* bytes, PacketMetadata& packet) noexcept
{
    if (readU32(bytes) != magic || readU16(bytes + 4) != version
        || readU16(bytes + 6) != headerBytes) return false;
    packet.flags = readU32(bytes + 8);
    packet.mediaSessionId = readU64(bytes + 12);
    packet.sequence = readU64(bytes + 20);
    packet.sourceFrameCounter = readU64(bytes + 28);
    packet.sampleRate = readU32(bytes + 36);
    packet.channelCount = readU16(bytes + 40);
    packet.frames = readU16(bytes + 42);
    packet.payloadBytes = readU32(bytes + 44);
    packet.producerTimestampUs = readU64(bytes + 48);
    const auto expected = static_cast<uint32_t>(packet.frames) * packet.channelCount * sizeof(float);
    return packet.mediaSessionId > 0 && packet.sequence > 0
        && (packet.flags & ~knownFlags) == 0
        && packet.sampleRate >= 8000 && packet.sampleRate <= 384000
        && packet.channelCount == channels && packet.frames == binaryPacketFrames
        && packet.payloadBytes == expected && packet.payloadBytes <= maximumPayloadBytes;
}
}

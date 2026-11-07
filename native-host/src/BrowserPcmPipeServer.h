#pragma once

#include "BrowserPcmProtocol.h"
#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

class BrowserPcmPipeServer final
{
public:
    using PacketHandler = std::function<bool(const AuralisPcmProtocol::PacketMetadata&, const float*)>;

    explicit BrowserPcmPipeServer(PacketHandler handler);
    ~BrowserPcmPipeServer();
    BrowserPcmPipeServer(const BrowserPcmPipeServer&) = delete;
    BrowserPcmPipeServer& operator=(const BrowserPcmPipeServer&) = delete;

    bool start();
    void stop();
    const std::wstring& pipeName() const noexcept { return name; }
    const std::string& nonce() const noexcept { return sessionNonce; }
    bool isReady() const noexcept { return running.load(std::memory_order_acquire); }
    uint64_t connectionCount() const noexcept { return connections.load(std::memory_order_relaxed); }
    uint64_t readFailureCount() const noexcept { return readFailures.load(std::memory_order_relaxed); }
    uint64_t invalidPacketCount() const noexcept { return invalidPackets.load(std::memory_order_relaxed); }

private:
    void run();
    PacketHandler packetHandler;
    std::wstring name;
    std::string sessionNonce;
    std::thread worker;
    std::atomic<bool> running { false };
    std::atomic<uint64_t> connections { 0 };
    std::atomic<uint64_t> readFailures { 0 };
    std::atomic<uint64_t> invalidPackets { 0 };
    void* stopEvent = nullptr;
    std::atomic<void*> activePipe { nullptr };
};

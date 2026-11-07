#include "BrowserPcmPipeServer.h"

#if defined(_WIN32)
#include <windows.h>
#include <sddl.h>
#include <array>
#include <iomanip>
#include <random>
#include <sstream>

namespace
{
constexpr size_t handshakeBytes = 24;

bool waitOverlapped(HANDLE io, OVERLAPPED& operation, HANDLE stopEvent, DWORD& transferred)
{
    const HANDLE events[] { stopEvent, operation.hEvent };
    const auto wait = WaitForMultipleObjects(2, events, FALSE, INFINITE);
    if (wait != WAIT_OBJECT_0 + 1) {
        CancelIoEx(io, &operation);
        return false;
    }
    return GetOverlappedResult(io, &operation, &transferred, FALSE) != FALSE;
}

bool readExact(HANDLE pipe, HANDLE stopEvent, void* destination, size_t bytes)
{
    auto* output = static_cast<uint8_t*>(destination);
    size_t completed = 0;
    while (completed < bytes) {
        OVERLAPPED operation {};
        operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (operation.hEvent == nullptr) return false;
        DWORD transferred = 0;
        const auto requested = static_cast<DWORD>(bytes - completed);
        const auto immediate = ReadFile(pipe, output + completed, requested, &transferred, &operation);
        bool ok = immediate != FALSE;
        if (!ok && GetLastError() == ERROR_IO_PENDING)
            ok = waitOverlapped(pipe, operation, stopEvent, transferred);
        CloseHandle(operation.hEvent);
        if (!ok || transferred == 0) return false;
        completed += transferred;
    }
    return true;
}

bool writeExact(HANDLE pipe, HANDLE stopEvent, const void* source, size_t bytes)
{
    const auto* input = static_cast<const uint8_t*>(source);
    size_t completed = 0;
    while (completed < bytes) {
        OVERLAPPED operation {};
        operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (operation.hEvent == nullptr) return false;
        DWORD transferred = 0;
        const auto requested = static_cast<DWORD>(bytes - completed);
        const auto immediate = WriteFile(pipe, input + completed, requested, &transferred, &operation);
        bool ok = immediate != FALSE;
        if (!ok && GetLastError() == ERROR_IO_PENDING)
            ok = waitOverlapped(pipe, operation, stopEvent, transferred);
        CloseHandle(operation.hEvent);
        if (!ok || transferred == 0) return false;
        completed += transferred;
    }
    return true;
}

std::string makeNonce()
{
    std::random_device source;
    std::mt19937_64 random(source());
    std::ostringstream text;
    text << std::hex << std::setw(16) << std::setfill('0') << random();
    return text.str();
}
}

BrowserPcmPipeServer::BrowserPcmPipeServer(PacketHandler handler)
    : packetHandler(std::move(handler)), sessionNonce(makeNonce())
{
    name = L"\\\\.\\pipe\\LOCAL\\AuralisPcm-";
    name.append(sessionNonce.begin(), sessionNonce.end());
}

BrowserPcmPipeServer::~BrowserPcmPipeServer() { stop(); }

bool BrowserPcmPipeServer::start()
{
    if (running.exchange(true, std::memory_order_acq_rel)) return true;
    stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (stopEvent == nullptr) {
        running.store(false, std::memory_order_release);
        return false;
    }
    worker = std::thread([this] { run(); });
    return true;
}

void BrowserPcmPipeServer::stop()
{
    if (!running.exchange(false, std::memory_order_acq_rel)) return;
    if (stopEvent != nullptr) SetEvent(static_cast<HANDLE>(stopEvent));
    if (auto* pipe = activePipe.load(std::memory_order_acquire))
        CancelIoEx(static_cast<HANDLE>(pipe), nullptr);
    if (worker.joinable()) worker.join();
    if (stopEvent != nullptr) CloseHandle(static_cast<HANDLE>(stopEvent));
    stopEvent = nullptr;
    activePipe.store(nullptr, std::memory_order_release);
}

void BrowserPcmPipeServer::run()
{
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    ConvertStringSecurityDescriptorToSecurityDescriptorW(
        L"D:P(A;;GA;;;OW)", SDDL_REVISION_1, &descriptor, nullptr);
    SECURITY_ATTRIBUTES security { sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE };
    std::array<uint8_t, AuralisPcmProtocol::headerBytes> header {};
    std::vector<float> payload(AuralisPcmProtocol::maximumPayloadBytes / sizeof(float));

    while (running.load(std::memory_order_acquire)) {
        auto pipe = CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1, 4096, 256 * 1024, 0, descriptor != nullptr ? &security : nullptr);
        if (pipe == INVALID_HANDLE_VALUE) { readFailures.fetch_add(1); break; }
        activePipe.store(pipe, std::memory_order_release);
        OVERLAPPED connect {};
        connect.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        DWORD ignored = 0;
        auto connected = ConnectNamedPipe(pipe, &connect) != FALSE;
        if (!connected) {
            const auto error = GetLastError();
            if (error == ERROR_PIPE_CONNECTED) connected = true;
            else if (error == ERROR_IO_PENDING) connected = waitOverlapped(pipe, connect, static_cast<HANDLE>(stopEvent), ignored);
        }
        CloseHandle(connect.hEvent);
        if (!connected) {
            CloseHandle(pipe);
            activePipe.store(nullptr, std::memory_order_release);
            if (running.load()) readFailures.fetch_add(1);
            continue;
        }

        std::array<uint8_t, handshakeBytes> handshake {};
        const auto handshakeOk = readExact(pipe, static_cast<HANDLE>(stopEvent), handshake.data(), handshake.size())
            && handshake[0] == 'A' && handshake[1] == 'H' && handshake[2] == 'S' && handshake[3] == 'H'
            && AuralisPcmProtocol::readU16(handshake.data() + 4) == 1
            && AuralisPcmProtocol::readU16(handshake.data() + 6) == handshakeBytes
            && std::string(reinterpret_cast<const char*>(handshake.data() + 8), 16) == sessionNonce;
        const char acknowledgement[4] { 'A', 'A', 'C', 'K' };
        if (!handshakeOk || !writeExact(pipe, static_cast<HANDLE>(stopEvent), acknowledgement, sizeof(acknowledgement))) {
            invalidPackets.fetch_add(1);
            DisconnectNamedPipe(pipe);
            CloseHandle(pipe);
            activePipe.store(nullptr, std::memory_order_release);
            continue;
        }
        connections.fetch_add(1, std::memory_order_relaxed);

        while (running.load(std::memory_order_acquire)) {
            if (!readExact(pipe, static_cast<HANDLE>(stopEvent), header.data(), header.size())) break;
            AuralisPcmProtocol::PacketMetadata metadata;
            if (!AuralisPcmProtocol::parseHeader(header.data(), metadata)) {
                invalidPackets.fetch_add(1, std::memory_order_relaxed);
                break; // Byte stream cannot be safely resynchronised after a malformed length.
            }
            if (!readExact(pipe, static_cast<HANDLE>(stopEvent), payload.data(), metadata.payloadBytes)) break;
            if (!packetHandler(metadata, payload.data())) invalidPackets.fetch_add(1, std::memory_order_relaxed);
        }
        if (running.load(std::memory_order_acquire)) readFailures.fetch_add(1, std::memory_order_relaxed);
        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
        activePipe.store(nullptr, std::memory_order_release);
    }
    if (descriptor != nullptr) LocalFree(descriptor);
}

#else
BrowserPcmPipeServer::BrowserPcmPipeServer(PacketHandler handler) : packetHandler(std::move(handler)) {}
BrowserPcmPipeServer::~BrowserPcmPipeServer() { stop(); }
bool BrowserPcmPipeServer::start() { return false; }
void BrowserPcmPipeServer::stop() { running.store(false); }
void BrowserPcmPipeServer::run() {}
#endif

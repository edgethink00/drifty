// Native helper candidate; not bundled/registered in Drifty yet. One visible
// foreground Notepad document only. No display/audio, caller HWND, or shell.
#define NOMINMAX
#include <windows.h>
#include <appmodel.h>
#include <atomic>
#include <algorithm>
#include <cmath>
#include <optional>
#include <bcrypt.h>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <cwctype>
#include <d3d11.h>
#include <dwmapi.h>
#include <fcntl.h>
#include <filesystem>
#include <io.h>
#include <iostream>
#include <mutex>
#include <memory>
#include <sstream>
#include <thread>
#include <uiautomation.h>
#include <vector>
#include <wincodec.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using winrt::Windows::Data::Json::JsonValue;
namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;
// Explicit QA build only. Fixed stage names and monotonic intervals contain
// no surface identifiers, text or pixels. Normal candidates emit no timings.
void qa_timing(char const *stage) {
#ifdef SCREEN_CONTEXT_QA_TIMING
    static auto const origin = Clock::now();
    std::cerr << "screen_context_timing:" << stage << ":"
              << std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - origin).count()
              << '\n';
#else
    (void)stage;
#endif
}
std::atomic<uint64_t> generation{1};
std::atomic<bool> go{false}, parent_alive{true};
DWORD target_pid = 0;

struct Refusal {
    std::string code = "unavailable";
};
void require(bool value) {
    if (!value)
        throw Refusal{};
}
// A stale surface is an expected privacy refusal, distinct from an unavailable
// OS/API. Keep the same admission predicate and use the existing wire code.
void require_unchanged(bool value) {
    if (!value)
        throw Refusal{"changed"};
}
#include "windows_job_power_scope.inc"

std::wstring lower(std::wstring value) {
    for (auto &c : value)
        c = std::towlower(c);
    return value;
}
std::string quote(std::wstring const &value) {
    return to_string(JsonValue::CreateStringValue(value).Stringify());
}
std::string quote(std::string const &value) { return quote(std::wstring(to_hstring(value))); }
std::string object(std::initializer_list<std::pair<std::string, std::string>> values) {
    std::string out = "{";
    for (auto const &[key, value] : values) {
        if (out.size() > 1)
            out += ',';
        out += quote(key) + ":" + value;
    }
    return out + "}";
}
std::string hash(BYTE const *data, size_t size) {
    require(size <= ULONG_MAX);
    BCRYPT_ALG_HANDLE algorithm{};
    require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0);
    BYTE result[32]{};
    auto status = BCryptHash(algorithm, nullptr, 0, const_cast<BYTE *>(data),
                             static_cast<ULONG>(size), result, 32);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    require(status == 0);
    constexpr char hex[] = "0123456789abcdef";
    std::string out;
    for (BYTE value : result) {
        out += hex[value >> 4];
        out += hex[value & 15];
    }
    return out;
}
std::string hash(std::string const &data) {
    return hash(reinterpret_cast<BYTE const *>(data.data()), data.size());
}
template<class String> struct EraseText {
    String &value;
    ~EraseText() { if (!value.empty()) SecureZeroMemory(value.data(), value.size() * sizeof(typename String::value_type)); }
};
void packet(std::string const &data) {
    require(!data.empty() && data.size() <= 16 * 1024);
    uint32_t n = static_cast<uint32_t>(data.size());
    char length[]{char(n >> 24), char(n >> 16), char(n >> 8), char(n)};
    std::cout.write(length, 4);
    std::cout.write(data.data(), data.size());
    std::cout.flush();
    require(bool(std::cout));
}
void pump() {
    MSG msg;
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}
void CALLBACK changed(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG, LONG, DWORD, DWORD) {
    DWORD pid = 0;
    if (hwnd)
        GetWindowThreadProcessId(hwnd, &pid);
    if (event == EVENT_SYSTEM_FOREGROUND || event == EVENT_SYSTEM_DESKTOPSWITCH ||
        pid == target_pid)
        generation.fetch_add(1);
}
struct Hooks {
    HWINEVENTHOOK system{}, objects{};
    Hooks() {
        system = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_DESKTOPSWITCH, nullptr,
                                 changed, 0, 0, WINEVENT_OUTOFCONTEXT);
        objects = SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_TEXTSELECTIONCHANGED, nullptr,
                                  changed, target_pid, 0, WINEVENT_OUTOFCONTEXT);
        require(system && objects);
    }
    ~Hooks() {
        if (system)
            UnhookWinEvent(system);
        if (objects)
            UnhookWinEvent(objects);
    }
};
std::wstring desktopName(HDESK desktop) {
    wchar_t value[256]{};
    DWORD needed = 0;
    require(GetUserObjectInformationW(desktop, UOI_NAME, value, sizeof(value), &needed) &&
            needed <= sizeof(value));
    return value;
}
bool interactive() {
    auto desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!desktop)
        return false;
    bool result = false;
    try {
        result = desktopName(desktop) == L"Default" &&
                 desktopName(GetThreadDesktop(GetCurrentThreadId())) == L"Default";
    } catch (...) {
    }
    CloseDesktop(desktop);
    return result;
}
struct Handle {
    HANDLE h{};
    ~Handle() {
        if (h && h != INVALID_HANDLE_VALUE)
            CloseHandle(h);
    }
};
std::string appIdentity(HANDLE process, bool &packaged) {
    wchar_t path[32768]{};
    DWORD length = 32768;
    require(QueryFullProcessImageNameW(process, 0, path, &length));
    UINT32 size = 0;
    auto status = GetApplicationUserModelId(process, &size, nullptr);
    if (status == ERROR_INSUFFICIENT_BUFFER && size <= 1024) {
        std::vector<wchar_t> id(size);
        require(GetApplicationUserModelId(process, &size, id.data()) == ERROR_SUCCESS);
        require(std::wstring(id.data()) == L"Microsoft.WindowsNotepad_8wekyb3d8bbwe!App");
        // An AUMID by itself is insufficient package identity. Bind the actual
        // process package family, full package and executable location too.
        UINT32 family_size = 0, full_size = 0, root_size = 0;
        require(GetPackageFamilyName(process, &family_size, nullptr) == ERROR_INSUFFICIENT_BUFFER &&
                family_size <= 1024);
        std::vector<wchar_t> family(family_size);
        require(GetPackageFamilyName(process, &family_size, family.data()) == ERROR_SUCCESS &&
                std::wstring(family.data()) == L"Microsoft.WindowsNotepad_8wekyb3d8bbwe");
        require(GetPackageFullName(process, &full_size, nullptr) == ERROR_INSUFFICIENT_BUFFER &&
                full_size <= 1024);
        std::vector<wchar_t> full(full_size);
        require(GetPackageFullName(process, &full_size, full.data()) == ERROR_SUCCESS);
        require(GetPackagePathByFullName(full.data(), &root_size, nullptr) ==
                    ERROR_INSUFFICIENT_BUFFER &&
                root_size <= 32768);
        std::vector<wchar_t> root(root_size);
        require(GetPackagePathByFullName(full.data(), &root_size, root.data()) == ERROR_SUCCESS);
        require(lower(path) == lower(std::wstring(root.data()) + L"\\Notepad\\Notepad.exe"));
        packaged = true;
        return to_string(id.data());
    }
    require(status == APPMODEL_ERROR_NO_APPLICATION);
    wchar_t system[MAX_PATH]{};
    require(GetSystemDirectoryW(system, MAX_PATH) > 0);
    require(lower(path) == lower(std::wstring(system) + L"\\notepad.exe"));
    packaged = false;
    return to_string(lower(path));
}
com_ptr<IUIAutomation> &automationClient() {
    static com_ptr<IUIAutomation> automation = create_instance<IUIAutomation>(CLSID_CUIAutomation);
    return automation;
}
std::string documentToken(HWND window, bool packaged, com_ptr<IUIAutomationElement> *textElement = nullptr) {
    if(textElement) *textElement = nullptr;
    com_ptr<IUIAutomationElement> candidate; size_t candidates = 0;
    // Reuse the COM client connection, never a surface/element/property cache.
    // Every inspection obtains and walks a fresh root with the same node limit.
    // This function is called only on the helper's main MTA thread.
    auto automation = automationClient();
    // Prefetch only this returned element's metadata on each navigation call.
    // Keep the bounded walk; never request/cache an unbounded subtree, text,
    // or a property snapshot from a previous inspection/job.
    com_ptr<IUIAutomationCacheRequest> cache;
    check_hresult(automation->CreateCacheRequest(cache.put()));
    check_hresult(cache->put_TreeScope(TreeScope_Element));
    check_hresult(cache->put_AutomationElementMode(AutomationElementMode_Full));
    check_hresult(cache->AddProperty(UIA_ControlTypePropertyId));
    check_hresult(cache->AddProperty(UIA_IsPasswordPropertyId));
    check_hresult(cache->AddPattern(UIA_SelectionItemPatternId));
    check_hresult(cache->AddProperty(UIA_SelectionItemIsSelectedPropertyId));
    com_ptr<IUIAutomationElement> root;
    check_hresult(automation->ElementFromHandleBuildCache(window, cache.get(), root.put()));
    com_ptr<IUIAutomationTreeWalker> walker;
    check_hresult(automation->get_ControlViewWalker(walker.put()));
    std::vector<com_ptr<IUIAutomationElement>> queue{root};
    std::string selected;
    size_t count = 0, selected_count = 0;
    while (!queue.empty()) {
        auto element = queue.back();
        queue.pop_back();
        require(++count <= 512);
        CONTROLTYPEID type{};
        check_hresult(element->get_CachedControlType(&type));
        if(textElement && type==(packaged ? UIA_DocumentControlTypeId : UIA_EditControlTypeId)) { candidate=element; ++candidates; }
        if (type == UIA_EditControlTypeId || type == UIA_DocumentControlTypeId) {
            BOOL password = TRUE;
            check_hresult(element->get_CachedIsPassword(&password));
            require(!password);
        }
        if (type == UIA_TabItemControlTypeId) {
            com_ptr<IUIAutomationSelectionItemPattern> pattern;
            check_hresult(element->GetCachedPatternAs(UIA_SelectionItemPatternId,
                                                       __uuidof(IUIAutomationSelectionItemPattern),
                                                       pattern.put_void()));
            BOOL is_selected = FALSE;
            check_hresult(pattern->get_CachedIsSelected(&is_selected));
            if (is_selected) {
                ++selected_count;
                SAFEARRAY *runtime = nullptr;
                check_hresult(element->GetRuntimeId(&runtime));
                require(runtime != nullptr);
                LONG first = 0, last = -1;
                HRESULT bounds = SafeArrayGetLBound(runtime, 1, &first);
                if (SUCCEEDED(bounds))
                    bounds = SafeArrayGetUBound(runtime, 1, &last);
                if (FAILED(bounds) || last < first || last - first > 64) {
                    SafeArrayDestroy(runtime);
                    throw Refusal{};
                }
                for (LONG n = first; n <= last; ++n) {
                    int id = 0;
                    auto ok = SafeArrayGetElement(runtime, &n, &id);
                    if (FAILED(ok)) {
                        SafeArrayDestroy(runtime);
                        throw Refusal{};
                    }
                    selected += std::to_string(id) + ":";
                }
                SafeArrayDestroy(runtime);
            }
        }
        com_ptr<IUIAutomationElement> child;
        check_hresult(walker->GetFirstChildElementBuildCache(element.get(), cache.get(), child.put()));
        while (child) {
            require(queue.size() + count < 512);
            queue.push_back(child);
            com_ptr<IUIAutomationElement> next;
            check_hresult(walker->GetNextSiblingElementBuildCache(child.get(), cache.get(), next.put()));
            child = std::move(next);
        }
    }
    if(textElement && candidates==1) *textElement=std::move(candidate);
    require(!packaged || selected_count == 1);
    require(selected_count <= 1);
    wchar_t title[4097]{};
    require(GetWindowTextLengthW(window) > 0 && GetWindowTextLengthW(window) < 4096);
    require(GetWindowTextW(window, title, 4097) > 0);
    return to_string(title) + "\n" + selected;
}
std::optional<std::string> activityTitleDigest(std::wstring const &title) {
    auto whitespace=[](wchar_t c){return (c>=9 && c<=13)||c==32||c==0x85||c==0xA0||c==0x1680||(c>=0x2000 && c<=0x200A)||c==0x2028||c==0x2029||c==0x202F||c==0x205F||c==0x3000;};
    if(title.empty() || std::all_of(title.begin(),title.end(),whitespace) ||
       std::any_of(title.begin(),title.end(),[](wchar_t c){return c<32 || c==127;})) return std::nullopt;
    // Refuse malformed UTF16 before conversion can replace distinct unpaired
    // surrogates with the same replacement character and invent equality.
    for(size_t i=0;i<title.size();++i){
        auto c=static_cast<uint16_t>(title[i]);
        if(c>=0xD800 && c<=0xDBFF){
            if(++i==title.size() || title[i]<0xDC00 || title[i]>0xDFFF) return std::nullopt;
        } else if(c>=0xDC00 && c<=0xDFFF) return std::nullopt;
    }
    try {
        auto bytes=to_string(title); EraseText<std::string> erase{bytes};
        if(bytes.size()>2048) return std::nullopt;
        // Exact UTF8, including the domain NUL; never trim/normalize a title
        // to guess equality with the ordinary tracker snapshot.
        std::string input("drifty-window-title-v1\0",23); EraseText<std::string> eraseInput{input};
        input+=bytes;
        return hash(input);
    } catch (...) { return std::nullopt; }
}
std::optional<std::string> activityWindowTitleDigest(HWND window) {
    // Tracker GetWindowTextW uses a512 UTF16-unit buffer. Refuse truncated or
    // unstable captions; mismatched/trimmed tracker titles simply stay unbound.
    int length=GetWindowTextLengthW(window);
    if(length<=0 || length>=512) return std::nullopt;
    std::wstring title(512,L'\0'); EraseText<std::wstring> erase{title};
    int used=GetWindowTextW(window,title.data(),512);
    if(used!=length || GetWindowTextLengthW(window)!=length) return std::nullopt;
    title.resize(used);
    return activityTitleDigest(title);
}
struct Facts {
    HWND window{};
    uint64_t birth{}, epoch{}, events{};
    std::string app, document, json;
    bool activity_hint{};
    std::optional<std::string> title_digest;
};
bool sameFacts(Facts const &a, Facts const &b) {
    return a.json==b.json && a.activity_hint==b.activity_hint && a.title_digest==b.title_digest;
}
std::string activityObservation(Facts const &facts) {
    return object({{"windowTitleDigest",facts.title_digest ? quote(*facts.title_digest) : "null"}});
}
Facts inspect(com_ptr<IUIAutomationElement> *textElement = nullptr, bool activityHint = false) {
    pump();
    require(parent_alive.load() && interactive());
    Facts facts;
    facts.window = GetForegroundWindow();
    require(facts.window && GetAncestor(facts.window, GA_ROOT) == facts.window);
    DWORD pid = 0;
    GetWindowThreadProcessId(facts.window, &pid);
    require(pid == target_pid && IsWindowVisible(facts.window) && !IsIconic(facts.window));
    DWORD cloak = 1;
    check_hresult(DwmGetWindowAttribute(facts.window, DWMWA_CLOAKED, &cloak, sizeof(cloak)));
    require(cloak == 0);
    DWORD affinity = ~0u;
    require(GetWindowDisplayAffinity(facts.window, &affinity) && affinity == WDA_NONE);
    RECT bounds{};
    require(GetWindowRect(facts.window, &bounds) && bounds.right > bounds.left &&
            bounds.bottom > bounds.top);
    MONITORINFO monitor{sizeof(monitor)};
    require(GetMonitorInfoW(MonitorFromWindow(facts.window, MONITOR_DEFAULTTONULL), &monitor));
    require(bounds.left >= monitor.rcMonitor.left && bounds.top >= monitor.rcMonitor.top &&
            bounds.right <= monitor.rcMonitor.right && bounds.bottom <= monitor.rcMonitor.bottom);
    // Z order includes same-app dialogs and other overlapping windows. Reject
    // occlusion, rather than capturing pixels that are hidden from the user.
    for (HWND above = GetTopWindow(nullptr); above && above != facts.window;
         above = GetWindow(above, GW_HWNDNEXT)) {
        if (!IsWindowVisible(above) || IsIconic(above))
            continue;
        DWORD hidden = 1;
        if (FAILED(DwmGetWindowAttribute(above, DWMWA_CLOAKED, &hidden, sizeof(hidden))))
            throw Refusal{};
        if (hidden)
            continue;
        RECT other{}, intersection{};
        require(GetWindowRect(above, &other));
        require(!IntersectRect(&intersection, &bounds, &other));
    }
    Handle process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)};
    require(process.h != nullptr);
    FILETIME created{}, exit{}, kernel{}, user{};
    require(GetProcessTimes(process.h, &created, &exit, &kernel, &user));
    facts.birth = (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    bool packaged = false;
    facts.app = appIdentity(process.h, packaged);
    facts.document = hash(facts.app + "\n" + documentToken(facts.window, packaged, textElement));
    facts.activity_hint=activityHint;
    if(activityHint) facts.title_digest=activityWindowTitleDigest(facts.window);
    pump();
    LASTINPUTINFO input{sizeof(input)};
    require(GetLastInputInfo(&input));
    facts.events = generation.load();
    require(facts.events <= UINT32_MAX);
    facts.epoch = (facts.events << 32) | input.dwTime;
    require(facts.epoch > 0 && GetForegroundWindow() == facts.window);
    auto identity = object({{"pid", std::to_string(pid)},
                            {"processBirth", std::to_string(facts.birth)},
                            {"windowId", std::to_string(reinterpret_cast<uintptr_t>(facts.window))},
                            {"appId", quote(facts.app)},
                            {"documentId", quote(facts.document)},
                            {"documentGeneration", std::to_string(facts.epoch)}});
    facts.json = object({{"identity", identity},
                         {"permission", "true"},
                         {"foreground", "true"},
                         {"interactive", "true"},
                         {"protected", "false"},
                         {"visibility", quote("visible")},
                         {"privacy", quote("not_browser")}});
    return facts;
}
struct Pixels {
    std::vector<BYTE> bgra, png;
    UINT width{}, height{};
    Pixels() = default;
    Pixels(Pixels const &) = delete;
    Pixels &operator=(Pixels const &) = delete;
    Pixels(Pixels &&other) noexcept { *this = std::move(other); }
    Pixels &operator=(Pixels &&other) noexcept {
        if (this != &other) {
            erase(); bgra = std::move(other.bgra); png = std::move(other.png);
            width = other.width; height = other.height;
        }
        return *this;
    }
    void erase() {
        if (!bgra.empty()) SecureZeroMemory(bgra.data(), bgra.size());
        if (!png.empty()) SecureZeroMemory(png.data(), png.size());
    }
    ~Pixels() { erase(); }
};

struct DeviceResources {
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    DeviceResources() {
        check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
            device.put(), nullptr, context.put()));
    }
};
// No image/surface is retained. All calls are sequential on the main MTA;
// each FrameArrived callback finishes before the next job starts.
DeviceResources &deviceResources() {
    static DeviceResources resources;
    return resources;
}
Pixels pixels(ID3D11Device *device, ID3D11DeviceContext *context, ID3D11Texture2D *texture,
              UINT width, UINT height) {
    D3D11_TEXTURE2D_DESC description{};
    texture->GetDesc(&description);
    require(width && height && width <= 1920 && height <= 1920 && width <= description.Width &&
            height <= description.Height && description.Format == DXGI_FORMAT_B8G8R8A8_UNORM);
    description.Width = width;
    description.Height = height;
    description.Usage = D3D11_USAGE_STAGING;
    description.BindFlags = 0;
    description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    description.MiscFlags = 0;
    com_ptr<ID3D11Texture2D> staging;
    check_hresult(device->CreateTexture2D(&description, nullptr, staging.put()));
    D3D11_BOX box{0, 0, 0, width, height, 1};
    context->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, texture, 0, &box);
    D3D11_MAPPED_SUBRESOURCE mapped{};
    check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
    Pixels out;
    out.width = width;
    out.height = height;
    try {
        out.bgra.resize(size_t(width) * height * 4);
        for (UINT y = 0; y < height; ++y)
            memcpy(out.bgra.data() + size_t(y) * width * 4,
                   static_cast<BYTE *>(mapped.pData) + size_t(y) * mapped.RowPitch,
                   size_t(width) * 4);
    } catch (...) {
        context->Unmap(staging.get(), 0);
        throw;
    }
    context->Unmap(staging.get(), 0);
    auto factory = create_instance<IWICImagingFactory>(CLSID_WICImagingFactory);
    com_ptr<IStream> stream;
    check_hresult(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()));
    com_ptr<IWICBitmapEncoder> encoder;
    check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
    check_hresult(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache));
    com_ptr<IWICBitmapFrameEncode> frame;
    check_hresult(encoder->CreateNewFrame(frame.put(), nullptr));
    check_hresult(frame->Initialize(nullptr));
    check_hresult(frame->SetSize(width, height));
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    check_hresult(frame->SetPixelFormat(&format));
    require(format == GUID_WICPixelFormat32bppBGRA);
    check_hresult(
        frame->WritePixels(height, width * 4, static_cast<UINT>(out.bgra.size()), out.bgra.data()));
    check_hresult(frame->Commit());
    check_hresult(encoder->Commit());
    STATSTG stat{};
    check_hresult(stream->Stat(&stat, STATFLAG_NONAME));
    require(stat.cbSize.QuadPart > 0 && stat.cbSize.QuadPart <= 2 * 1024 * 1024);
    LARGE_INTEGER start{};
    check_hresult(stream->Seek(start, STREAM_SEEK_SET, nullptr));
    out.png.resize(size_t(stat.cbSize.QuadPart));
    ULONG read = 0;
    check_hresult(stream->Read(out.png.data(), static_cast<ULONG>(out.png.size()), &read));
    require(read == out.png.size());
    return out;
}
Pixels capture(Facts const &before, com_ptr<IUIAutomationElement> *textElement = nullptr) {
    require_unchanged(sameFacts(inspect(nullptr,before.activity_hint),before));
    qa_timing("capture_validated");
    auto device = deviceResources().device;
    auto context = deviceResources().context;
    auto dxgi = device.as<IDXGIDevice>();
    com_ptr<IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
    auto direct = inspectable.as<IDirect3DDevice>();
    auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    check_hresult(
        interop->CreateForWindow(before.window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    require(item.Size().Width > 0 && item.Size().Height > 0 && item.Size().Width <= 1920 &&
            item.Size().Height <= 1920);
    auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        direct, DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, item.Size());
    auto session = pool.CreateCaptureSession(item);
    session.IsCursorCaptureEnabled(false); // Default OS border stays enabled.
    qa_timing("capture_resources_ready");
    struct CaptureState {
        HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        std::mutex mutex;
        Pixels output;
        bool finished = false, ok = false;
        ~CaptureState() {
            if (ready)
                CloseHandle(ready);
        }
    };
    auto state = std::make_shared<CaptureState>();
    require(state->ready != nullptr);
    // No callback borrows this function's stack. Revoking an event does not
    // prove that an already-dispatched callback has stopped running.
    auto token = pool.FrameArrived([state, device, context](auto const &sender, auto const &) {
        std::lock_guard<std::mutex> lock(state->mutex);
        if (state->finished)
            return;
        state->finished = true;
        try {
            auto frame = sender.TryGetNextFrame();
            require(bool(frame));
            auto surface =
                frame.Surface()
                    .as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
            com_ptr<ID3D11Texture2D> texture;
            check_hresult(surface->GetInterface(__uuidof(ID3D11Texture2D), texture.put_void()));
            auto size = frame.ContentSize();
            state->output =
                pixels(device.get(), context.get(), texture.get(), size.Width, size.Height);
            state->ok = true;
        } catch (...) {
        }
        SetEvent(state->ready);
    });
    auto close = [&] {
        try {
            session.Close();
        } catch (...) {
        }
        try {
            pool.FrameArrived(token);
        } catch (...) {
        }
        try {
            pool.Close();
        } catch (...) {
        }
    };
    try {
        require_unchanged(sameFacts(inspect(nullptr,before.activity_hint),before));
        qa_timing("capture_start");
        session.StartCapture();
        auto deadline = Clock::now() + std::chrono::milliseconds(800);
        while (WaitForSingleObject(state->ready, 5) == WAIT_TIMEOUT) {
            pump();
            if (!parent_alive || GetForegroundWindow() != before.window || Clock::now() >= deadline)
                break;
        }
        close();
        qa_timing("capture_closed");
    } catch (...) {
        close();
        throw;
    }
    std::lock_guard<std::mutex> lock(state->mutex);
    require(state->ok);
    require_unchanged(sameFacts(inspect(textElement,before.activity_hint),before));
    return std::move(state->output);
}
// Fixed adjacent resources only; no PATH/model override or provider fallback.
class OcrEngine {
    HMODULE library{};
    void *api{};
    void *(*create)(){};
    int (*init)(void *, char const *, char const *){};
    void (*set)(void *, unsigned char const *, int, int, int, int){};
    int (*variable)(void *, char const *, char const *){};
    int (*recognize)(void *, void *){};
    char *(*text)(void *){};
    void (*deleteText)(char const *){};
    void (*destroy)(void *){};
    void (*clear)(void *){};
    void (*clearAdaptive)(void *){};
    void close() {
        if (api && destroy) { destroy(api); api = nullptr; qa_timing("ocr_destroyed"); }
        if (library) { FreeLibrary(library); library = nullptr; qa_timing("ocr_library_freed"); }
    }
public:
    OcrEngine(OcrEngine const &) = delete;
    OcrEngine &operator=(OcrEngine const &) = delete;
    OcrEngine() {
        try {
            wchar_t executable[32768]{};
            require(GetModuleFileNameW(nullptr, executable, 32768) > 0);
            require(_putenv_s("OMP_THREAD_LIMIT", "2") == 0 && _putenv_s("OMP_NUM_THREADS", "2") == 0 &&
                SetEnvironmentVariableW(L"OMP_THREAD_LIMIT", L"2") && SetEnvironmentVariableW(L"OMP_NUM_THREADS", L"2"));
            auto runtime = fs::path(executable).parent_path() / L"screen-context-ocr";
            library = LoadLibraryExW((runtime / L"tesseract55.dll").c_str(), nullptr,
                LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
            require(library != nullptr); qa_timing("ocr_library_loaded");
            create = reinterpret_cast<decltype(create)>(GetProcAddress(library, "TessBaseAPICreate"));
            init = reinterpret_cast<decltype(init)>(GetProcAddress(library, "TessBaseAPIInit3"));
            set = reinterpret_cast<decltype(set)>(GetProcAddress(library, "TessBaseAPISetImage"));
            variable = reinterpret_cast<decltype(variable)>(GetProcAddress(library, "TessBaseAPISetVariable"));
            recognize = reinterpret_cast<decltype(recognize)>(GetProcAddress(library, "TessBaseAPIRecognize"));
            text = reinterpret_cast<decltype(text)>(GetProcAddress(library, "TessBaseAPIGetUTF8Text"));
            deleteText = reinterpret_cast<decltype(deleteText)>(GetProcAddress(library, "TessDeleteText"));
            destroy = reinterpret_cast<decltype(destroy)>(GetProcAddress(library, "TessBaseAPIDelete"));
            clear = reinterpret_cast<decltype(clear)>(GetProcAddress(library, "TessBaseAPIClear"));
            clearAdaptive = reinterpret_cast<decltype(clearAdaptive)>(GetProcAddress(library, "TessBaseAPIClearAdaptiveClassifier"));
            require(create && init && set && variable && recognize && text && deleteText && destroy && clear && clearAdaptive);
            api = create(); require(api != nullptr);
            auto data = to_string((runtime / L"tessdata").wstring());
            require(init(api, data.c_str(), "eng+kor") == 0);
            require(variable(api, "user_defined_dpi", "96") != 0 && variable(api, "tessedit_pageseg_mode", "11") != 0);
            qa_timing("ocr_initialized");
        } catch (...) { close(); throw; }
    }
    ~OcrEngine() { close(); }
    std::pair<std::wstring, std::string> read(Pixels const &image) {
        std::wstring result;
        std::string state = "unavailable";
        auto rgba = image.bgra;
        try {
            for (size_t n = 0; n < rgba.size(); n += 4) std::swap(rgba[n], rgba[n + 2]);
            set(api, rgba.data(), image.width, image.height, 4, image.width * 4);
            if (recognize(api, nullptr) == 0) {
                qa_timing("ocr_recognized");
                char *value = text(api);
                if (value) {
                    try { result = std::wstring(to_hstring(value)); }
                    catch (...) { deleteText(value); throw; }
                    SecureZeroMemory(value, strlen(value)); deleteText(value);
                    state = result.empty() ? "no_text" : "recognized";
                }
            }
        } catch (...) {
            SecureZeroMemory(rgba.data(), rgba.size()); clear(api); clearAdaptive(api); throw;
        }
        SecureZeroMemory(rgba.data(), rgba.size());
        // Do not carry image/results or learned words into another observation.
        clear(api); clearAdaptive(api);
        size_t count = 0, end = 0;
        for (; end < result.size() && count < 1600; ++end, ++count)
            if (IS_HIGH_SURROGATE(result[end]) && end + 1 < result.size() && IS_LOW_SURROGATE(result[end + 1])) ++end;
        if (end < result.size()) SecureZeroMemory(result.data() + end, (result.size() - end) * sizeof(wchar_t));
        result.resize(end);
        while (!result.empty() && std::iswspace(result.back())) result.pop_back();
        size_t first = 0; while (first < result.size() && std::iswspace(result[first])) ++first;
        result.erase(0, first);
        if (state == "recognized" && result.empty()) state = "no_text";
        return {std::move(result), state};
    }
};
std::pair<std::wstring, std::string> recognize(Pixels const &image) {
    try { OcrEngine engine; return engine.read(image); } catch (...) { return {L"", "unavailable"}; }
}
struct OwnedTextArray {
    SAFEARRAY *value{};
    ~OwnedTextArray() { if (value) SafeArrayDestroy(value); }
};
struct OwnedTextBstr {
    BSTR value{};
    ~OwnedTextBstr() { if (value) { SecureZeroMemory(value, SysStringLen(value)*sizeof(wchar_t)); SysFreeString(value); } }
};
// Uses a live element from the same final after-frame inspection. No element,
// text/property snapshot or range is retained between jobs. Whole-document
// endpoints must match one visible span before any capped GetText call.
std::optional<std::wstring> visibleDocumentText(HWND window, com_ptr<IUIAutomationElement> const &element) {
    try {
        require(bool(element));
        BOOL password = TRUE, offscreen = TRUE;
        check_hresult(element->get_CurrentIsPassword(&password));
        check_hresult(element->get_CurrentIsOffscreen(&offscreen));
        require(!password && !offscreen);
        RECT area{}, client{}; POINT origin{};
        check_hresult(element->get_CurrentBoundingRectangle(&area));
        require(GetClientRect(window,&client) && ClientToScreen(window,&origin));
        OffsetRect(&client,origin.x,origin.y);
        require(area.right>area.left && area.bottom>area.top && area.left>=client.left && area.top>=client.top && area.right<=client.right && area.bottom<=client.bottom);
        com_ptr<IUIAutomationTextPattern> pattern;
        check_hresult(element->GetCurrentPatternAs(UIA_TextPatternId,__uuidof(IUIAutomationTextPattern),pattern.put_void()));
        com_ptr<IUIAutomationTextRangeArray> ranges;
        check_hresult(pattern->GetVisibleRanges(ranges.put()));
        int length = 0;check_hresult(ranges->get_Length(&length));require(length==1);
        com_ptr<IUIAutomationTextRange> range,document;
        check_hresult(ranges->GetElement(0,range.put()));
        check_hresult(pattern->get_DocumentRange(document.put()));
        int start = 1,end = 1;
        check_hresult(range->CompareEndpoints(TextPatternRangeEndpoint_Start,document.get(),TextPatternRangeEndpoint_Start,&start));
        check_hresult(range->CompareEndpoints(TextPatternRangeEndpoint_End,document.get(),TextPatternRangeEndpoint_End,&end));
        require(start==0 && end==0); // Position comparisons only; never DocumentRange.GetText.
        int empty = 1;
        check_hresult(range->CompareEndpoints(TextPatternRangeEndpoint_Start,range.get(),TextPatternRangeEndpoint_End,&empty));
        if(empty==0) return std::wstring{};
        OwnedTextArray rectangles;
        check_hresult(range->GetBoundingRectangles(&rectangles.value));require(rectangles.value!=nullptr);
        VARTYPE type{};check_hresult(SafeArrayGetVartype(rectangles.value,&type));require(type==VT_R8 && SafeArrayGetDim(rectangles.value)==1);
        LONG first=0,last=-1;
        check_hresult(SafeArrayGetLBound(rectangles.value,1,&first));check_hresult(SafeArrayGetUBound(rectangles.value,1,&last));
        auto count=int64_t(last)-first+1;require(count>0 && count<=512*4 && count%4==0);
        for(int64_t n=0;n<count;n+=4){
            double r[4]{};
            for(int k=0;k<4;++k){LONG index=first+static_cast<LONG>(n)+k;check_hresult(SafeArrayGetElement(rectangles.value,&index,&r[k]));require(std::isfinite(r[k]));}
            require(r[2]>0 && r[3]>0 && r[0]>=area.left && r[1]>=area.top && r[0]+r[2]<=area.right && r[1]+r[3]<=area.bottom);
        }
        OwnedTextBstr raw;
        check_hresult(range->GetText(1600,&raw.value));require(raw.value!=nullptr);
        auto units=SysStringLen(raw.value);require(units<=1600);
        std::wstring result(raw.value,units);EraseText<std::wstring> eraseResult{result};
        for(size_t n=0;n<result.size();++n){
            auto c=unsigned(result[n]);
            if(c>=0xD800 && c<=0xDBFF){require(n+1<result.size() && result[n+1]>=0xDC00 && result[n+1]<=0xDFFF);++n;}
            else require(!(c>=0xDC00 && c<=0xDFFF));
        }
        auto whitespace=[](wchar_t c){return (c>=9 && c<=13)||c==32||c==0x85||c==0xA0||c==0x1680||(c>=0x2000 && c<=0x200A)||c==0x2028||c==0x2029||c==0x202F||c==0x205F||c==0x3000;};
        if(std::all_of(result.begin(),result.end(),whitespace)) return std::wstring{};
        return result;
    } catch (...) { return std::nullopt; }
}

void captureJob(std::string const &request, bool ocr, OcrEngine *engine = nullptr, bool visible = false, int version = 1, bool preparedJobPower = false) {
        bool restorationFailure = false;
        OwnPowerApi powerApi;
        JobPowerScope<OwnPowerApi> jobPower(powerApi, restorationFailure);
        if (preparedJobPower) jobPower.enter();
        require(GraphicsCaptureSession::IsSupported() && interactive());
        GetWindowThreadProcessId(GetForegroundWindow(), &target_pid);
        require(target_pid > 0 && target_pid != GetCurrentProcessId());
        Hooks hooks;
        auto before = inspect(nullptr,version==3);
        qa_timing("preflight_ready");
        auto preflight=object(
            {{"protocolVersion", std::to_string(version)}, {"requestId", quote(request)}, {"facts", before.json}});
        if(version==3){preflight.pop_back();preflight+=",\"activityHint\":"+activityObservation(before)+"}";}
        packet(preflight);
        while (!go) {
            pump();
            require_unchanged(parent_alive && generation.load() == before.events);
            Sleep(2);
        }
        qa_timing("admitted");
        com_ptr<IUIAutomationElement> textElement;
        auto image = capture(before, visible ? &textElement : nullptr);
        qa_timing("capture_complete");
        auto observed = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
        std::wstring text; std::string state="not_requested",source="none";
        if(visible){
            source="accessibility";
            if(auto direct=visibleDocumentText(before.window,textElement)){text=std::move(*direct);state=text.empty()?"no_text":"recognized";}
            else state="unavailable";
        }
        if(ocr && (!visible || state=="unavailable")){
            source="ocr";auto result=engine?engine->read(image):recognize(image);text=std::move(result.first);state=std::move(result.second);
        }
        EraseText<std::wstring> eraseText{text};
        qa_timing(version==1?"ocr_complete":"text_complete");
        auto after = inspect(nullptr,version==3);
        qa_timing("after_validated");
        require_unchanged(sameFacts(after,before));
        auto header = object(
            {{"protocolVersion", std::to_string(version)},
             {"requestId", quote(request)},
             {"before", before.json},
             {"after", after.json},
             {"observedAtMs", std::to_string(observed)},
             {"frame", object({{"pngBytes", std::to_string(image.png.size())},
                               {"width", std::to_string(image.width)},
                               {"height", std::to_string(image.height)},
                               {"sha256", quote(hash(image.png.data(), image.png.size()))}})}});
        header.pop_back();
        if(version==3) header+=",\"activityHintBefore\":"+activityObservation(before)+",\"activityHintAfter\":"+activityObservation(after);
        if(version==1) header += ",\"text\":"+quote(text)+",\"ocrState\":"+quote(state)+"}";
        else header += ",\"textEvidence\":"+object({{"source",quote(source)},{"state",quote(state)},{"text",quote(text)}})+"}";
        EraseText<std::string> eraseHeader{header};
        // Restore before the final fresh facts check, preserving its position
        // immediately before result commit. Failed restoration emits no frame.
        if (preparedJobPower) jobPower.restore();
        require(!restorationFailure);
        require_unchanged(sameFacts(inspect(nullptr,version==3),before));
        qa_timing("result_validated");
        packet(header);
        std::cout.write(reinterpret_cast<char *>(image.png.data()), image.png.size());
        std::cout.flush();
        SecureZeroMemory(image.bgra.data(), image.bgra.size());
        SecureZeroMemory(image.png.data(), image.png.size());
}
struct WorkerInput {
    std::mutex mutex;
    std::string request;
    std::atomic<ULONGLONG> deadline{GetTickCount64() + 5000};
};
std::vector<BYTE> readExact(DWORD count) {
    std::vector<BYTE> bytes(count); DWORD used = 0;
    while (used < count) {
        DWORD got = 0;
        if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), bytes.data() + used, count - used, &got, nullptr) || !got)
            TerminateProcess(GetCurrentProcess(), 3);
        used += got;
    }
    return bytes;
}
int preparedWorker(bool ocr, bool visible = false, int version = 1) {
    auto input = std::make_shared<WorkerInput>();
    std::thread([input] {
        for (;;) {
            if (GetTickCount64() >= input->deadline.load()) TerminateProcess(GetCurrentProcess(), 4);
            Sleep(5);
        }
    }).detach();
    std::thread([input, ocr, visible, version] {
        for (int n = 0; n < 8; ++n) {
            auto bytes = readExact(41);
            if (memcmp(bytes.data(), version==1?"JOB1":version==2?"JOB2":"JOB3", 4) != 0 || bytes[40] != ((ocr?1:0)|(visible?2:0))) TerminateProcess(GetCurrentProcess(), 3);
            std::string request(reinterpret_cast<char *>(bytes.data() + 4), 36);
            GUID parsed{}; auto guid = L"{" + std::wstring(to_hstring(request)) + L"}";
            if (FAILED(IIDFromString(guid.c_str(), &parsed))) TerminateProcess(GetCurrentProcess(), 3);
            {
                std::lock_guard<std::mutex> lock(input->mutex);
                if (!input->request.empty()) TerminateProcess(GetCurrentProcess(), 3);
                go = false; input->request = request;
                input->deadline = GetTickCount64() + 1100;
            }
            if (readExact(1)[0] != 1) TerminateProcess(GetCurrentProcess(), 3);
            go = true;
        }
        // Keep observing EOF while the last job finishes; no ninth job allowed.
        readExact(1); TerminateProcess(GetCurrentProcess(), 3);
    }).detach();
    std::string request;
    try {
        init_apartment(apartment_type::multi_threaded);
        require(GraphicsCaptureSession::IsSupported());
        // Client/device/model initialization only: no foreground query, UIA
        // element, capture item/session or screen pixels during preparation.
        automationClient(); deviceResources();
        std::unique_ptr<OcrEngine> engine;
        if (ocr) engine = std::make_unique<OcrEngine>();
        input->deadline = GetTickCount64() + 90000;
        std::cout << (version==1?"RDY1":version==2?"RDY2":"RDY3"); std::cout.flush(); require(bool(std::cout));
        for (int n = 0; n < 8; ++n) {
            request.clear();
            while (request.empty()) {
                { std::lock_guard<std::mutex> lock(input->mutex); request = input->request; }
                if (request.empty()) { pump(); Sleep(2); }
            }
            captureJob(request, ocr, engine.get(), visible, version, true);
            {
                std::lock_guard<std::mutex> lock(input->mutex);
                input->request.clear(); go = false;
                input->deadline = GetTickCount64() + 90000;
            }
            // captureJob has released its image/text objects and cleared OCR
            // result/adaptation state before declaring this request complete.
            std::cout << (version==1?"END1":version==2?"END2":"END3") << request; std::cout.flush(); require(bool(std::cout));
        }
        return 0;
    } catch (Refusal const &error) {
        if (!request.empty()) try { packet(object({{"protocolVersion",std::to_string(version)},{"requestId",quote(request)},{"refusal",quote(error.code)}})); } catch (...) {}
    } catch (...) {
        if (!request.empty()) try { packet(object({{"protocolVersion",std::to_string(version)},{"requestId",quote(request)},{"refusal",quote("unavailable")}})); } catch (...) {}
    }
    return 0;
}

int wmain(int argc, wchar_t **argv) {
    qa_timing("entry");
    std::string request_id;
    // Native bounds/UIA rectangles and WGC pixels must use physical screen
    // coordinates. This affects only the owned helper's calling thread.
    if(!SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return 2;
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    try {
        if (argc == 4 && std::wstring(argv[1]) == L"--worker-v1" && std::wstring(argv[2]) == L"--ocr") {
            require(std::wstring(argv[3]) == L"on" || std::wstring(argv[3]) == L"off");
            return preparedWorker(std::wstring(argv[3]) == L"on");
        }
        if (argc == 4 && (std::wstring(argv[1]) == L"--worker-v2" || std::wstring(argv[1]) == L"--worker-v3") && std::wstring(argv[2]) == L"--text") {
            auto mode=std::wstring(argv[3]);
            require(mode==L"off" || mode==L"ocr" || mode==L"accessibility" || mode==L"accessibility-or-ocr");
            return preparedWorker(mode==L"ocr" || mode==L"accessibility-or-ocr", mode==L"accessibility" || mode==L"accessibility-or-ocr", std::wstring(argv[1])==L"--worker-v3"?3:2);
        }
        init_apartment(apartment_type::multi_threaded);
        if (argc == 2 && std::wstring(argv[1]) == L"--capabilities") {
            std::cout << object(
                {{"protocolVersion", "1"}, {"sourceProtocolVersion", "2"},
                 {"captureSupported", GraphicsCaptureSession::IsSupported() ? "true" : "false"},
                 {"interactive", interactive() ? "true" : "false"},
                 {"candidateOnly", "true"}});
            return 0;
        }
        require(argc == 6 && std::wstring(argv[1]) == L"--protocol-v1" &&
                std::wstring(argv[2]) == L"--request" && std::wstring(argv[4]) == L"--ocr");
        require(wcslen(argv[3]) == 36);
        GUID parsed{};
        auto guid_text = L"{" + std::wstring(argv[3]) + L"}";
        require(SUCCEEDED(IIDFromString(guid_text.c_str(), &parsed)));
        auto request = to_string(argv[3]);
        request_id = request;
        bool ocr = std::wstring(argv[5]) == L"on";
        require(ocr || std::wstring(argv[5]) == L"off");
        // Own only this helper. EOF and a separate watchdog are armed before
        // any potentially blocking UIA/preflight call; no shared PID is killed.
        std::thread([] {
            Sleep(1100);
            TerminateProcess(GetCurrentProcess(), 4);
        }).detach();
        std::thread([] {
            BYTE byte = 0;
            DWORD read = 0;
            if (ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &read, nullptr) && read == 1 &&
                byte == 1) {
                go = true;
                ReadFile(GetStdHandle(STD_INPUT_HANDLE), &byte, 1, &read, nullptr);
            }
            parent_alive = false;
            TerminateProcess(GetCurrentProcess(), 3);
        }).detach();
        captureJob(request, ocr);
        return 0;
    } catch (Refusal const &error) {
        if (request_id.empty())
            return 2;
        try {
            packet(object({{"protocolVersion", "1"},
                           {"requestId", quote(request_id)},
                           {"refusal", quote(error.code)}}));
        } catch (...) {
        }
        return 0;
    } catch (...) {
        if (request_id.empty())
            return 2;
        try {
            packet(object({{"protocolVersion", "1"},
                           {"requestId", quote(request_id)},
                           {"refusal", quote("unavailable")}}));
        } catch (...) {
        }
        return 0;
    }
}

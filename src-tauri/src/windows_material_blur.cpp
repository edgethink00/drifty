#define UNICODE
#define _UNICODE
// Windows 11 backdrop for the transparent Tauri main window.
// The magnifier samples only windows behind Drifty. Its blurred output is
// attached to the main HWND below the WebView child so the backdrop moves
// atomically with the app rather than following it in a sibling window.
#include <windows.h>
#include <magnification.h>
#include <d3d11.h>
#include <dcomp.h>
#include <d2d1effects.h>
#include <dwmapi.h>
#include <wrl/client.h>
#include <roapi.h>
#include <winrt/Windows.UI.ViewManagement.h>
#include <new>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <optional>
#include <thread>

using Microsoft::WRL::ComPtr;

namespace {
struct BlurState {
  HWND ui = nullptr;
  HWND source = nullptr;
  HWND magnifier = nullptr;
  RECT bounds{};
  bool magInitialized = false;
  ComPtr<ID3D11Device> d3d;
  ComPtr<IDXGIDevice> dxgi;
  ComPtr<IDCompositionDesktopDevice> desktop;
  ComPtr<IDCompositionDevice3> device3;
  ComPtr<IDCompositionTarget> target;
  ComPtr<IUnknown> surface;
  ComPtr<IDCompositionVisual2> visual;
  ComPtr<IDCompositionGaussianBlurEffect> blur;
};

// Magnifier controls need their own regular Win32 message loop. Tauri's main
// window loop is not a substitute for pumping this child control's messages.
BlurState* state = nullptr;  // Worker thread only.
HANDLE workerThread = nullptr;
DWORD workerId = 0;
HANDLE readyEvent = nullptr;
HWND uiWindow = nullptr;
std::atomic<bool> startupSucceeded{false};
std::atomic<bool> runtimeHealthy{false};
constexpr UINT kSyncMessage = WM_APP + 1;
constexpr UINT kStopMessage = WM_APP + 2;
constexpr wchar_t kClassName[] = L"DriftyNativeBlurSurface";

void markRuntimeFailure() {
  if (runtimeHealthy.exchange(false, std::memory_order_acq_rel)) {
    std::fprintf(stderr, "Drifty native blur lost its source or synchronization\n");
  }
  PostQuitMessage(0);
}

bool sameRect(const RECT& a, const RECT& b) {
  return a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom;
}

bool visibleBounds(HWND window, RECT& bounds) {
  // GetWindowRect includes the invisible resize border. Painting that area in
  // the sibling blur window exposes a black rectangle outside Drifty's frame.
  return SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS,
                                         &bounds, sizeof(bounds))) &&
         bounds.right > bounds.left && bounds.bottom > bounds.top;
}

bool sync(BlurState& s) {
  if (!IsWindow(s.ui)) return false;
  // DXGI device loss also invalidates the DirectComposition tree. This V2
  // desktop device has no CheckDeviceState method, so check its D3D source.
  if (s.d3d && FAILED(s.d3d->GetDeviceRemovedReason())) return false;
  if (!IsWindowVisible(s.ui) || IsIconic(s.ui)) return true;
  RECT bounds{};
  if (!visibleBounds(s.ui, bounds)) return false;
  const bool moved = !sameRect(bounds, s.bounds);
  const int width = bounds.right - bounds.left;
  const int height = bounds.bottom - bounds.top;
  if (moved) {
    MoveWindow(s.source, bounds.left, bounds.top, width, height, TRUE);
    MoveWindow(s.magnifier, 0, 0, width, height, TRUE);
    s.bounds = bounds;
  }
  // Tauri's multi-window WebView2 host can keep the magnifier redirection
  // surface on an old frame until its source is explicitly refreshed.
  return MagSetWindowSource(s.magnifier, bounds);
}

LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_TIMER && wparam == 1 && state && state->source == hwnd) {
    if (!sync(*state)) markRuntimeFailure();
    return 0;
  }
  if (message == WM_DESTROY && state && state->source == hwnd) {
    markRuntimeFailure();
  }
  if (message == WM_PAINT) {
    if (state && state->source == hwnd) {
      if (FAILED(state->d3d->GetDeviceRemovedReason()))
        markRuntimeFailure();
    }
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(hwnd, &paint);
    RECT client{};
    GetClientRect(hwnd, &client);
    FillRect(dc, &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    EndPaint(hwnd, &paint);
    return 0;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

void destroy(BlurState* s) {
  if (!s) return;
  if (s->source) KillTimer(s->source, 1);
  // Release DirectComposition references before their HWNDs disappear.
  s->blur.Reset(); s->visual.Reset(); s->surface.Reset(); s->target.Reset();
  s->device3.Reset(); s->desktop.Reset(); s->dxgi.Reset(); s->d3d.Reset();
  if (s->source) DestroyWindow(s->source);
  if (s->magInitialized) MagUninitialize();
  delete s;
}

bool initialize(BlurState& s) {
  if (!IsWindow(s.ui) || !visibleBounds(s.ui, s.bounds)) return false;
  const int width = s.bounds.right - s.bounds.left;
  const int height = s.bounds.bottom - s.bounds.top;
  if (width <= 0 || height <= 0) return false;

  WNDCLASSW cls{};
  cls.lpfnWndProc = windowProc;
  cls.hInstance = GetModuleHandleW(nullptr);
  cls.lpszClassName = kClassName;
  if (!RegisterClassW(&cls) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;

  if (!MagInitialize()) return false;
  s.magInitialized = true;
  constexpr DWORD kStyle = WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
  s.source = CreateWindowExW(kStyle, kClassName, L"Drifty blur source", WS_POPUP | WS_VISIBLE,
                             s.bounds.left, s.bounds.top, width, height, nullptr, nullptr,
                             GetModuleHandleW(nullptr), nullptr);
  if (!s.source || !SetLayeredWindowAttributes(s.source, 0, 255, LWA_ALPHA)) return false;
  s.magnifier = CreateWindowExW(0, WC_MAGNIFIER, L"Drifty background source", WS_CHILD | WS_VISIBLE,
                                0, 0, width, height, s.source, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!s.magnifier) return false;
  MAGTRANSFORM transform{};
  transform.v[0][0] = transform.v[1][1] = transform.v[2][2] = 1.0f;
  if (!MagSetWindowTransform(s.magnifier, &transform)) return false;

  HWND excluded[] = {s.source, s.ui};
  if (!MagSetWindowFilterList(s.magnifier, MW_FILTERMODE_EXCLUDE, 2, excluded) ||
      !MagSetWindowSource(s.magnifier, s.bounds)) return false;
  ShowWindow(s.source, SW_SHOWNOACTIVATE);

  D3D_FEATURE_LEVEL featureLevel{};
  HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                 D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
                                 &s.d3d, &featureLevel, nullptr);
  if (FAILED(hr) || FAILED(s.d3d.As(&s.dxgi))) return false;
  hr = DCompositionCreateDevice3(s.dxgi.Get(), IID_PPV_ARGS(&s.desktop));
  if (FAILED(hr) || FAILED(s.desktop.As(&s.device3))) return false;
  // The bottom DirectComposition layer is clipped and moved by the real app
  // HWND. The WebView child remains above it. This avoids the sibling-window
  // geometry race visible during move/maximize in physical DXGI recordings.
  hr = s.desktop->CreateTargetForHwnd(s.ui, FALSE, &s.target);
  if (FAILED(hr)) {
    std::fprintf(stderr, "Drifty main-window composition target failed: 0x%08lX\n",
                 static_cast<unsigned long>(hr));
    return false;
  }
  if (FAILED(s.desktop->CreateSurfaceFromHwnd(s.source, &s.surface)) ||
      FAILED(s.desktop->CreateVisual(&s.visual)) ||
      FAILED(s.visual->SetContent(s.surface.Get())) ||
      FAILED(s.device3->CreateGaussianBlurEffect(&s.blur)) ||
      FAILED(s.blur->SetStandardDeviation(32.0f)) ||
      // Clamp the Gaussian result to the sampled desktop rectangle instead of
      // expanding the soft kernel past the HWND edge into a dark fringe.
      FAILED(s.blur->SetBorderMode(D2D1_BORDER_MODE_HARD)) ||
      FAILED(s.blur->SetInput(0, nullptr, 0)) ||
      FAILED(s.visual->SetEffect(s.blur.Get())) ||
      FAILED(s.target->SetRoot(s.visual.Get())) ||
      FAILED(s.desktop->Commit())) return false;

  BOOL cloak = TRUE;
  if (FAILED(DwmSetWindowAttribute(s.source, DWMWA_CLOAK, &cloak, sizeof(cloak)))) return false;
  // A low-frequency watchdog handles reveal/hide and z-order changes. Tauri
  // window events also call the exported sync function for immediate movement.
  if (!SetTimer(s.source, 1, 100, nullptr)) return false;
  return sync(s);
}

DWORD WINAPI workerMain(void* parameter) {
  HANDLE ready = readyEvent;
  // Create the thread queue before the caller can post a sync/stop request.
  MSG message{};
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  auto* candidate = new (std::nothrow) BlurState;
  if (!candidate) {
    SetEvent(ready);
    return 1;
  }
  candidate->ui = static_cast<HWND>(parameter);
  if (!initialize(*candidate)) {
    destroy(candidate);
    SetEvent(ready);
    return 1;
  }
  state = candidate;
  startupSucceeded.store(true, std::memory_order_release);
  runtimeHealthy.store(true, std::memory_order_release);
  SetEvent(ready);
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (!message.hwnd && message.message == kSyncMessage) {
      if (!sync(*state)) {
        markRuntimeFailure();
        break;
      }
    } else if (!message.hwnd && message.message == kStopMessage) {
      break;
    } else {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  runtimeHealthy.store(false, std::memory_order_release);
  startupSucceeded.store(false, std::memory_order_release);
  state = nullptr;
  destroy(candidate);
  return 0;
}
}  // namespace

extern "C" bool drifty_windows_blur_start(void* uiWindow) {
  if (workerThread) return ::uiWindow == static_cast<HWND>(uiWindow) &&
                           startupSucceeded.load(std::memory_order_acquire) &&
                           runtimeHealthy.load(std::memory_order_acquire);
  ::uiWindow = static_cast<HWND>(uiWindow);
  startupSucceeded.store(false, std::memory_order_release);
  runtimeHealthy.store(false, std::memory_order_release);
  readyEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!readyEvent) return false;
  workerThread = CreateThread(nullptr, 0, workerMain, uiWindow, 0, &workerId);
  if (!workerThread) {
    CloseHandle(readyEvent);
    readyEvent = nullptr;
    return false;
  }
  if (WaitForSingleObject(readyEvent, 10000) != WAIT_OBJECT_0) {
    // A stuck graphics initialization must not freeze Drifty indefinitely.
    // Keep the handles alive until stop; the worker may still be using them.
    PostThreadMessageW(workerId, kStopMessage, 0, 0);
    return false;
  }
  return startupSucceeded.load(std::memory_order_acquire);
}

extern "C" bool drifty_windows_blur_sync() {
  return workerThread && runtimeHealthy.load(std::memory_order_acquire) &&
         PostThreadMessageW(workerId, kSyncMessage, 0, 0);
}

extern "C" bool drifty_windows_blur_is_healthy() {
  return workerThread && startupSucceeded.load(std::memory_order_acquire) &&
         runtimeHealthy.load(std::memory_order_acquire);
}

extern "C" void drifty_windows_blur_stop() {
  if (!workerThread) return;
  runtimeHealthy.store(false, std::memory_order_release);
  PostThreadMessageW(workerId, kStopMessage, 0, 0);
  if (WaitForSingleObject(workerThread, 5000) == WAIT_OBJECT_0) {
    CloseHandle(workerThread);
    CloseHandle(readyEvent);
    workerThread = nullptr;
    readyEvent = nullptr;
    workerId = 0;
    ::uiWindow = nullptr;
    startupSucceeded.store(false, std::memory_order_release);
  }
}

namespace {
// One long-lived worker answers the WinRT capability question. It joins the
// multithreaded apartment once and keeps its UISettings instance. Reading the
// capability inline had two costs: the first read activated a WinRT object on
// the WebView2 UI thread during startup, and the appearance poll paired
// RoInitialize with RoUninitialize every cycle, creating and tearing down the
// process MTA while WebView2 startup work could still be in flight.
struct PolicyService {
  std::mutex mutex;
  std::condition_variable changed;
  bool started = false;
  std::uint64_t requested = 0;
  std::uint64_t answered = 0;
  unsigned char answer = 2;
};

// Never destroyed: the detached worker outlives static destruction at exit.
PolicyService& policyService() {
  static PolicyService* service = new PolicyService();
  return *service;
}

// C++/WinRT projected objects cannot be heap-allocated with new; the worker
// keeps its UISettings in an optional that lives as long as the thread.
unsigned char readAdvancedEffects(std::optional<winrt::Windows::UI::ViewManagement::UISettings>& settings) {
  try {
    if (!settings) settings.emplace();
    return settings->AdvancedEffectsEnabled() ? 0 : 1;
  } catch (...) {
    // A failed capability check must never reveal an unverified backdrop.
    settings.reset();
    return 2;
  }
}

void policyWorkerMain() {
  PolicyService& service = policyService();
  const HRESULT initialized = RoInitialize(RO_INIT_MULTITHREADED);
  const bool apartmentReady = SUCCEEDED(initialized) || initialized == RPC_E_CHANGED_MODE;
  std::optional<winrt::Windows::UI::ViewManagement::UISettings> settings;
  std::unique_lock<std::mutex> lock(service.mutex);
  for (;;) {
    service.changed.wait(lock, [&] { return service.requested != service.answered; });
    const std::uint64_t serial = service.requested;
    lock.unlock();
    const unsigned char answer = apartmentReady ? readAdvancedEffects(settings) : 2;
    lock.lock();
    service.answer = answer;
    service.answered = serial;
    service.changed.notify_all();
  }
}

unsigned char queryAdvancedEffectsPolicy() {
  PolicyService& service = policyService();
  std::unique_lock<std::mutex> lock(service.mutex);
  if (!service.started) {
    try {
      std::thread(policyWorkerMain).detach();
    } catch (...) {
      return 2;
    }
    service.started = true;
  }
  const std::uint64_t serial = ++service.requested;
  service.changed.notify_all();
  // The worker normally answers within milliseconds. A stalled answer is
  // reported as unverifiable, which keeps the opaque shell.
  if (!service.changed.wait_for(lock, std::chrono::milliseconds(2000),
                                [&] { return service.answered >= serial; })) {
    return 2;
  }
  return service.answer;
}
}  // namespace

// 0 = allowed, 1 = disabled by system preferences, 2 = cannot verify safely.
// UISettings is the documented authority for custom transparency effects:
// https://learn.microsoft.com/windows/apps/develop/composition/composition-tailoring
// The caller's thread only reads Win32 system parameters; COM and WinRT stay on
// the policy worker, so no apartment is initialized on the calling thread.
extern "C" unsigned char drifty_windows_blur_system_policy() {
  HIGHCONTRASTW contrast{};
  contrast.cbSize = sizeof(contrast);
  BOOL disableOverlapped = FALSE;
  if (!SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(contrast), &contrast, 0) ||
      !SystemParametersInfoW(SPI_GETDISABLEOVERLAPPEDCONTENT, 0, &disableOverlapped, 0)) return 2;
  if ((contrast.dwFlags & HCF_HIGHCONTRASTON) || disableOverlapped) return 1;
  return queryAdvancedEffectsPolicy();
}

use std::sync::mpsc;

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::MainThreadOnly;
#[cfg(target_os = "macos")]
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSButton, NSColor, NSControlSize, NSControlStateValueOff,
    NSControlStateValueOn, NSFont, NSImage, NSImageScaling, NSImageView, NSModalResponse,
    NSModalResponseCancel, NSModalResponseOK, NSPanel, NSTextField, NSView, NSWindowStyleMask,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use serde::Serialize;
use tauri::{async_runtime, AppHandle};

#[cfg(target_os = "macos")]
const UPDATE_DIALOG_ICON_PNG: &[u8] = include_bytes!("../../icons/icon.png");
#[cfg(target_os = "macos")]
const PANEL_WIDTH: f64 = 260.0;
#[cfg(target_os = "macos")]
const PANEL_HEIGHT: f64 = 212.0;
#[cfg(target_os = "macos")]
const SIDE_PADDING: f64 = 24.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUpdatePromptResult {
    confirmed: bool,
    auto_install_future_updates: bool,
}

#[cfg(target_os = "macos")]
struct UpdatePromptButtonTargetIvars {
    modal_response: NSModalResponse,
}

#[cfg(target_os = "macos")]
struct NativeUpdatePrompt {
    panel: Retained<NSPanel>,
    auto_install_checkbox: Retained<NSButton>,
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = UpdatePromptButtonTargetIvars]
    struct UpdatePromptButtonTarget;

    unsafe impl NSObjectProtocol for UpdatePromptButtonTarget {}

    impl UpdatePromptButtonTarget {
        #[unsafe(method(updatePromptButtonClicked:))]
        fn button_clicked(&self, _sender: &objc2::runtime::AnyObject) {
            let app = NSApplication::sharedApplication(self.mtm());
            app.stopModalWithCode(self.ivars().modal_response);
        }
    }
);

#[cfg(target_os = "macos")]
impl UpdatePromptButtonTarget {
    fn new(mtm: MainThreadMarker, modal_response: NSModalResponse) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(UpdatePromptButtonTargetIvars { modal_response });
        // SAFETY: `NSObject`'s `init` selector returns an initialized instance of this NSObject subclass.
        unsafe { msg_send![super(this), init] }
    }
}

#[tauri::command]
pub async fn update_prompt_show_native(
    app: AppHandle,
    version: String,
    urgent: bool,
    auto_install_future_updates: bool,
) -> Result<NativeUpdatePromptResult, String> {
    async_runtime::spawn_blocking(move || {
        show_native_update_prompt(app, version, urgent, auto_install_future_updates)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn show_native_update_prompt(
    app: AppHandle,
    version: String,
    urgent: bool,
    auto_install_future_updates: bool,
) -> Result<NativeUpdatePromptResult, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(show_native_update_prompt_on_main_thread(
            &version,
            urgent,
            auto_install_future_updates,
        ));
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|error| format!("Native update prompt was interrupted: {error}"))?
}

#[cfg(target_os = "macos")]
fn show_native_update_prompt_on_main_thread(
    version: &str,
    _urgent: bool,
    auto_install_future_updates: bool,
) -> Result<NativeUpdatePromptResult, String> {
    autoreleasepool(|_| {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("Native update prompt must run on the macOS main thread.".to_string());
        };

        let app = NSApplication::sharedApplication(mtm);
        let prompt = update_prompt_panel(mtm, version, auto_install_future_updates);
        let response = app.runModalForWindow(&prompt.panel);
        prompt.panel.orderOut(None);

        Ok(NativeUpdatePromptResult {
            confirmed: response == NSModalResponseOK,
            auto_install_future_updates: prompt.auto_install_checkbox.state()
                == NSControlStateValueOn,
        })
    })
}

#[cfg(target_os = "macos")]
fn update_prompt_panel(
    mtm: MainThreadMarker,
    version: &str,
    auto_install_future_updates: bool,
) -> NativeUpdatePrompt {
    let content_rect = frame(0.0, 0.0, PANEL_WIDTH, PANEL_HEIGHT);
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        content_rect,
        NSWindowStyleMask::Borderless,
        NSBackingStoreType::Buffered,
        false,
    );
    unsafe {
        panel.setReleasedWhenClosed(false);
    }
    panel.setTitle(&NSString::from_str("Drifty update"));
    panel.setOpaque(false);
    panel.setHasShadow(true);
    panel.setMovableByWindowBackground(true);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.center();

    let root = NSView::initWithFrame(NSView::alloc(mtm), content_rect);
    root.setWantsLayer(true);
    if let Some(layer) = root.layer() {
        layer.setCornerRadius(24.0);
        layer.setMasksToBounds(true);
        layer.setBackgroundColor(Some(
            &NSColor::colorWithCalibratedWhite_alpha(0.38, 0.92).CGColor(),
        ));
        layer.setBorderWidth(0.5);
        layer.setBorderColor(Some(
            &NSColor::colorWithCalibratedWhite_alpha(0.78, 0.36).CGColor(),
        ));
    }
    panel.setContentView(Some(&root));

    let icon_data = NSData::with_bytes(UPDATE_DIALOG_ICON_PNG);
    if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &icon_data) {
        let icon_view = NSImageView::initWithFrame(
            NSImageView::alloc(mtm),
            frame(SIDE_PADDING, 140.0, 52.0, 52.0),
        );
        icon_view.setImage(Some(&icon));
        icon_view.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
        root.addSubview(&icon_view);
    }

    let text_width = PANEL_WIDTH - SIDE_PADDING * 2.0;

    let title =
        NSTextField::labelWithString(&NSString::from_str(&format!("Drifty {version}")), mtm);
    title.setFrame(frame(SIDE_PADDING, 112.0, text_width, 18.0));
    title.setFont(Some(&NSFont::boldSystemFontOfSize(13.0)));
    title.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.92)));
    root.addSubview(&title);

    let body = NSTextField::wrappingLabelWithString(
        &NSString::from_str("A new Drifty update is available."),
        mtm,
    );
    body.setFrame(frame(SIDE_PADDING, 84.0, text_width, 20.0));
    body.setFont(Some(&NSFont::systemFontOfSize(13.0)));
    body.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.9)));
    root.addSubview(&body);

    let auto_install_checkbox = update_prompt_checkbox(
        mtm,
        "Automatically install future updates",
        auto_install_future_updates,
    );
    auto_install_checkbox.setFrame(frame(SIDE_PADDING, 58.0, text_width, 18.0));
    root.addSubview(&auto_install_checkbox);

    let later_target = UpdatePromptButtonTarget::new(mtm, NSModalResponseCancel);
    let later = update_prompt_button(mtm, "Later", &later_target);
    later.setFrame(frame(SIDE_PADDING, 16.0, 102.0, 28.0));
    root.addSubview(&later);

    let update_target = UpdatePromptButtonTarget::new(mtm, NSModalResponseOK);
    let update = update_prompt_primary_button(mtm, "Update", &update_target);
    update.setFrame(frame(134.0, 16.0, 102.0, 28.0));
    update.setKeyEquivalent(&NSString::from_str("\r"));
    root.addSubview(&update);

    panel.makeKeyAndOrderFront(None);
    NativeUpdatePrompt {
        panel,
        auto_install_checkbox,
    }
}

#[cfg(target_os = "macos")]
fn update_prompt_button(
    mtm: MainThreadMarker,
    title: &str,
    target: &UpdatePromptButtonTarget,
) -> Retained<NSButton> {
    let button = unsafe {
        NSButton::buttonWithTitle_target_action(
            &NSString::from_str(title),
            Some(target),
            Some(objc2::sel!(updatePromptButtonClicked:)),
            mtm,
        )
    };
    button.setBordered(false);
    button.setControlSize(NSControlSize::Regular);
    button.setFont(Some(&NSFont::systemFontOfSize(13.0)));
    button.setContentTintColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.9)));
    button.setWantsLayer(true);
    if let Some(layer) = button.layer() {
        layer.setCornerRadius(14.0);
        layer.setMasksToBounds(true);
        layer.setBackgroundColor(Some(
            &NSColor::colorWithCalibratedWhite_alpha(1.0, 0.16).CGColor(),
        ));
    }
    button
}

#[cfg(target_os = "macos")]
fn update_prompt_checkbox(mtm: MainThreadMarker, title: &str, checked: bool) -> Retained<NSButton> {
    let checkbox = unsafe {
        NSButton::checkboxWithTitle_target_action(&NSString::from_str(title), None, None, mtm)
    };
    checkbox.setControlSize(NSControlSize::Small);
    checkbox.setFont(Some(&NSFont::systemFontOfSize(11.0)));
    checkbox.setContentTintColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.82)));
    checkbox.setState(if checked {
        NSControlStateValueOn
    } else {
        NSControlStateValueOff
    });
    checkbox
}

#[cfg(target_os = "macos")]
fn update_prompt_primary_button(
    mtm: MainThreadMarker,
    title: &str,
    target: &UpdatePromptButtonTarget,
) -> Retained<NSButton> {
    let button = update_prompt_button(mtm, title, target);
    button.setContentTintColor(Some(&NSColor::whiteColor()));
    if let Some(layer) = button.layer() {
        layer.setBackgroundColor(Some(&NSColor::systemBlueColor().CGColor()));
    }
    button
}

#[cfg(target_os = "macos")]
fn frame(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

#[cfg(not(target_os = "macos"))]
fn show_native_update_prompt_on_main_thread(
    _version: &str,
    _urgent: bool,
    auto_install_future_updates: bool,
) -> Result<NativeUpdatePromptResult, String> {
    let _ = auto_install_future_updates;
    Err("Native update prompt is only available on macOS.".to_string())
}

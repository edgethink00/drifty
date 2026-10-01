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
    NSApplication, NSApplicationActivationPolicy, NSBackgroundStyle, NSBackingStoreType, NSButton,
    NSColor, NSControlSize, NSControlStateValueOff, NSControlStateValueOn, NSFont, NSImage,
    NSImageScaling, NSImageView, NSModalPanelWindowLevel, NSModalResponse, NSModalResponseCancel,
    NSModalResponseOK, NSPanel, NSTextField, NSView, NSWindowStyleMask,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use serde::Serialize;
use tauri::{async_runtime, AppHandle};

#[cfg(target_os = "macos")]
const UPDATE_DIALOG_ICON_PNG: &[u8] = include_bytes!("../../icons/icon.png");
#[cfg(target_os = "macos")]
const PANEL_WIDTH: f64 = 300.0;
#[cfg(target_os = "macos")]
const SIDE_PADDING: f64 = 24.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUpdatePromptResult {
    confirmed: bool,
    background_updates_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUpdateStatusResult {
    dismissed: bool,
}

#[cfg(target_os = "macos")]
struct UpdatePromptButtonTargetIvars {
    modal_response: NSModalResponse,
}

#[cfg(target_os = "macos")]
struct NativeUpdatePrompt {
    panel: Retained<NSPanel>,
    background_updates_checkbox: Retained<NSButton>,
    _later_target: Retained<UpdatePromptButtonTarget>,
    _update_target: Retained<UpdatePromptButtonTarget>,
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
    message: Option<String>,
    background_updates_enabled: bool,
    language: Option<String>,
) -> Result<NativeUpdatePromptResult, String> {
    let korean = language.as_deref() == Some("ko");
    async_runtime::spawn_blocking(move || {
        show_native_update_prompt(
            app,
            version,
            urgent,
            message,
            background_updates_enabled,
            korean,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn update_status_show_native(
    app: AppHandle,
    title: String,
    body: String,
    language: Option<String>,
) -> Result<NativeUpdateStatusResult, String> {
    let korean = language.as_deref() == Some("ko");
    async_runtime::spawn_blocking(move || show_native_update_status(app, title, body, korean))
        .await
        .map_err(|error| error.to_string())?
}

fn show_native_update_prompt(
    app: AppHandle,
    version: String,
    urgent: bool,
    message: Option<String>,
    background_updates_enabled: bool,
    korean: bool,
) -> Result<NativeUpdatePromptResult, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(show_native_update_prompt_on_main_thread(
            &version,
            urgent,
            message.as_deref(),
            background_updates_enabled,
            korean,
        ));
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|error| format!("Native update prompt was interrupted: {error}"))?
}

fn show_native_update_status(
    app: AppHandle,
    title: String,
    body: String,
    korean: bool,
) -> Result<NativeUpdateStatusResult, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(show_native_update_status_on_main_thread(
            &title, &body, korean,
        ));
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|error| format!("Native update status was interrupted: {error}"))?
}

#[cfg(target_os = "macos")]
fn show_native_update_prompt_on_main_thread(
    version: &str,
    urgent: bool,
    message: Option<&str>,
    background_updates_enabled: bool,
    korean: bool,
) -> Result<NativeUpdatePromptResult, String> {
    autoreleasepool(|_| {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("Native update prompt must run on the macOS main thread.".to_string());
        };

        let app = NSApplication::sharedApplication(mtm);
        let prompt = update_prompt_panel(
            mtm,
            version,
            urgent,
            message,
            background_updates_enabled,
            korean,
        );
        present_update_panel(mtm, &prompt.panel);
        let response = app.runModalForWindow(&prompt.panel);
        prompt.panel.orderOut(None);

        Ok(NativeUpdatePromptResult {
            confirmed: response == NSModalResponseOK,
            background_updates_enabled: prompt.background_updates_checkbox.state()
                == NSControlStateValueOn,
        })
    })
}

#[cfg(target_os = "macos")]
fn update_prompt_panel(
    mtm: MainThreadMarker,
    version: &str,
    urgent: bool,
    message: Option<&str>,
    background_updates_enabled: bool,
    korean: bool,
) -> NativeUpdatePrompt {
    let copy = native_update_copy(korean, urgent);
    let text_width = PANEL_WIDTH - SIDE_PADDING * 2.0;
    let title_copy = if urgent {
        if korean {
            format!("중요 업데이트 · Drifty {version}")
        } else {
            format!("Important update · Drifty {version}")
        }
    } else {
        format!("Drifty {version}")
    };
    let title = NSTextField::wrappingLabelWithString(&NSString::from_str(&title_copy), mtm);
    title.setFont(Some(&NSFont::boldSystemFontOfSize(13.0)));
    title.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.92)));
    let title_height = wrapped_label_height(&title, text_width);

    let body_copy = normalize_update_prompt_message(message, urgent, korean);
    let body = NSTextField::wrappingLabelWithString(&NSString::from_str(&body_copy), mtm);
    body.setFont(Some(&NSFont::systemFontOfSize(13.0)));
    body.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.9)));
    let body_height = wrapped_label_height(&body, text_width);
    let body_y = 82.0;
    let title_y = body_y + body_height + 8.0;
    let icon_y = title_y + title_height + 12.0;
    let panel_height = icon_y + 52.0 + 20.0;
    let (panel, root) = create_update_panel(mtm, copy.title, PANEL_WIDTH, panel_height);
    let icon_data = NSData::with_bytes(UPDATE_DIALOG_ICON_PNG);
    if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &icon_data) {
        let icon_view = NSImageView::initWithFrame(
            NSImageView::alloc(mtm),
            frame(SIDE_PADDING, icon_y, 52.0, 52.0),
        );
        icon_view.setImage(Some(&icon));
        icon_view.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
        root.addSubview(&icon_view);
    }
    title.setFrame(frame(SIDE_PADDING, title_y, text_width, title_height));
    root.addSubview(&title);
    body.setFrame(frame(SIDE_PADDING, body_y, text_width, body_height));
    root.addSubview(&body);

    let background_updates_checkbox =
        update_prompt_checkbox(mtm, copy.automatic, background_updates_enabled);
    background_updates_checkbox.setFrame(frame(SIDE_PADDING, 54.0, text_width, 18.0));
    root.addSubview(&background_updates_checkbox);

    let later_target = UpdatePromptButtonTarget::new(mtm, NSModalResponseCancel);
    let later = update_prompt_button(mtm, copy.later, &later_target);
    later.setFrame(frame(SIDE_PADDING, 16.0, 122.0, 28.0));
    root.addSubview(&later);

    let update_target = UpdatePromptButtonTarget::new(mtm, NSModalResponseOK);
    let update = update_prompt_primary_button(mtm, copy.update, &update_target);
    update.setFrame(frame(154.0, 16.0, 122.0, 28.0));
    update.setKeyEquivalent(&NSString::from_str("\r"));
    root.addSubview(&update);

    NativeUpdatePrompt {
        panel,
        background_updates_checkbox,
        _later_target: later_target,
        _update_target: update_target,
    }
}

struct NativeUpdateCopy {
    title: &'static str,
    fallback: &'static str,
    automatic: &'static str,
    later: &'static str,
    update: &'static str,
    ok: &'static str,
}

fn native_update_copy(korean: bool, urgent: bool) -> NativeUpdateCopy {
    if korean {
        NativeUpdateCopy {
            title: if urgent {
                "Drifty 중요 업데이트"
            } else {
                "Drifty 업데이트"
            },
            fallback: if urgent {
                "안정성 또는 보안을 위한 중요한 업데이트입니다."
            } else {
                "새로운 Drifty 업데이트를 설치할 수 있습니다."
            },
            automatic: "Drifty 자동 업데이트",
            later: "나중에",
            update: "업데이트",
            ok: "확인",
        }
    } else {
        NativeUpdateCopy {
            title: if urgent {
                "Important Drifty update"
            } else {
                "Drifty update"
            },
            fallback: if urgent {
                "This update includes an important stability or security fix."
            } else {
                "A new Drifty update is available."
            },
            automatic: "Automatically update Drifty",
            later: "Later",
            update: "Update",
            ok: "OK",
        }
    }
}

fn normalize_update_prompt_message(message: Option<&str>, urgent: bool, korean: bool) -> String {
    let normalized = message
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let fallback = native_update_copy(korean, urgent).fallback;
    let source = if normalized.is_empty() {
        fallback
    } else {
        normalized.as_str()
    };
    source.chars().take(180).collect()
}

#[cfg(target_os = "macos")]
fn wrapped_label_height(label: &NSTextField, width: f64) -> f64 {
    label.setPreferredMaxLayoutWidth(width);
    label.setMaximumNumberOfLines(0);
    label
        .cell()
        .map(|cell| {
            cell.cellSizeForBounds(frame(0.0, 0.0, width, 1000.0))
                .height
                .ceil()
                + 2.0
        })
        .unwrap_or(36.0)
        .max(18.0)
}

#[cfg(target_os = "macos")]
fn present_update_panel(mtm: MainThreadMarker, panel: &NSPanel) {
    let app = NSApplication::sharedApplication(mtm);
    if app.activationPolicy() != NSApplicationActivationPolicy::Prohibited {
        crate::macos_activation::activate_application(&app);
        panel.setLevel(NSModalPanelWindowLevel);
        panel.makeKeyAndOrderFront(None);
        return;
    }
    // Isolated/background sessions stay non-activatable, but the prompt still
    // has to appear in front of other windows without stealing key focus.
    panel.setLevel(NSModalPanelWindowLevel);
    panel.orderFrontRegardless();
}

#[cfg(target_os = "macos")]
fn show_native_update_status_on_main_thread(
    title: &str,
    body: &str,
    korean: bool,
) -> Result<NativeUpdateStatusResult, String> {
    autoreleasepool(|_| {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("Native update status must run on the macOS main thread.".to_string());
        };

        let app = NSApplication::sharedApplication(mtm);
        let prompt = update_status_panel(mtm, title, body, korean);
        present_update_panel(mtm, &prompt.panel);
        let _response = app.runModalForWindow(&prompt.panel);
        prompt.panel.orderOut(None);
        Ok(NativeUpdateStatusResult { dismissed: true })
    })
}

#[cfg(target_os = "macos")]
struct NativeUpdateStatus {
    panel: Retained<NSPanel>,
    _ok_target: Retained<UpdatePromptButtonTarget>,
}

#[cfg(target_os = "macos")]
fn update_status_panel(
    mtm: MainThreadMarker,
    title: &str,
    body: &str,
    korean: bool,
) -> NativeUpdateStatus {
    let panel_height = 164.0;
    let (panel, root) = create_update_panel(mtm, title, PANEL_WIDTH, panel_height);

    let text_width = PANEL_WIDTH - SIDE_PADDING * 2.0;
    let title_field = NSTextField::labelWithString(&NSString::from_str(title), mtm);
    title_field.setFrame(frame(SIDE_PADDING, 112.0, text_width, 18.0));
    title_field.setFont(Some(&NSFont::boldSystemFontOfSize(13.0)));
    title_field.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.92)));
    title_field.setEditable(false);
    title_field.setSelectable(true);
    root.addSubview(&title_field);

    let body_field = NSTextField::wrappingLabelWithString(&NSString::from_str(body), mtm);
    body_field.setFrame(frame(SIDE_PADDING, 70.0, text_width, 36.0));
    body_field.setFont(Some(&NSFont::systemFontOfSize(13.0)));
    body_field.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.9)));
    body_field.setEditable(false);
    body_field.setSelectable(true);
    root.addSubview(&body_field);

    let ok_target = UpdatePromptButtonTarget::new(mtm, NSModalResponseOK);
    let ok = update_prompt_primary_button(mtm, native_update_copy(korean, false).ok, &ok_target);
    ok.setFrame(frame((PANEL_WIDTH - 102.0) / 2.0, 16.0, 102.0, 28.0));
    ok.setKeyEquivalent(&NSString::from_str("\r"));
    root.addSubview(&ok);

    NativeUpdateStatus {
        panel,
        _ok_target: ok_target,
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
    checkbox.setContentTintColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.9)));
    // AppKit resolves checkbox title contrast from the cell's background style.
    // Tint and attributed foreground alone do not change it on a light system.
    if let Some(cell) = checkbox.cell() {
        cell.setBackgroundStyle(NSBackgroundStyle::Emphasized);
    }
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

#[cfg(target_os = "macos")]
fn update_panel_style_mask() -> NSWindowStyleMask {
    NSWindowStyleMask::Borderless
}

#[cfg(target_os = "macos")]
fn create_update_panel(
    mtm: MainThreadMarker,
    title: &str,
    width: f64,
    height: f64,
) -> (Retained<NSPanel>, Retained<NSView>) {
    let content_rect = frame(0.0, 0.0, width, height);
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        content_rect,
        update_panel_style_mask(),
        NSBackingStoreType::Buffered,
        false,
    );
    unsafe {
        panel.setReleasedWhenClosed(false);
    }
    panel.setTitle(&NSString::from_str(title));
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
            &NSColor::colorWithCalibratedWhite_alpha(0.32, 1.0).CGColor(),
        ));
        layer.setBorderWidth(0.5);
        layer.setBorderColor(Some(
            &NSColor::colorWithCalibratedWhite_alpha(0.78, 0.36).CGColor(),
        ));
    }
    panel.setContentView(Some(&root));
    (panel, root)
}

#[cfg(not(target_os = "macos"))]
fn show_native_update_prompt_on_main_thread(
    _version: &str,
    _urgent: bool,
    _message: Option<&str>,
    background_updates_enabled: bool,
    korean: bool,
) -> Result<NativeUpdatePromptResult, String> {
    let _ = (background_updates_enabled, korean);
    Err("Native update prompt is only available on macOS.".to_string())
}

#[cfg(not(target_os = "macos"))]
fn show_native_update_status_on_main_thread(
    _title: &str,
    _body: &str,
    _korean: bool,
) -> Result<NativeUpdateStatusResult, String> {
    Err("Native update status is only available on macOS.".to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn native_update_prompt_retains_button_targets_until_modal_exits() {
        fn retained_targets(
            prompt: &NativeUpdatePrompt,
        ) -> (
            &Retained<UpdatePromptButtonTarget>,
            &Retained<UpdatePromptButtonTarget>,
        ) {
            (&prompt._later_target, &prompt._update_target)
        }

        let _retained_targets: fn(
            &NativeUpdatePrompt,
        ) -> (
            &Retained<UpdatePromptButtonTarget>,
            &Retained<UpdatePromptButtonTarget>,
        ) = retained_targets;
    }

    #[test]
    fn native_update_panels_share_borderless_chrome() {
        let mask = update_panel_style_mask();
        assert!(
            mask.contains(NSWindowStyleMask::Borderless),
            "native update panels must stay borderless so the custom card is the only chrome"
        );
        assert!(
            !mask.contains(NSWindowStyleMask::Titled),
            "native update panels must not add a system title bar over the custom card"
        );
        assert!(
            !mask.contains(NSWindowStyleMask::Closable),
            "native update panels must not mix system window buttons with the custom card"
        );
    }

    #[test]
    fn native_update_copy_follows_explicit_app_language() {
        assert_eq!(native_update_copy(false, false).update, "Update");
        assert_eq!(native_update_copy(false, true).later, "Later");
        assert_eq!(native_update_copy(true, false).update, "업데이트");
        assert_eq!(native_update_copy(true, false).ok, "확인");
        assert_eq!(
            normalize_update_prompt_message(None, true, true),
            "안정성 또는 보안을 위한 중요한 업데이트입니다."
        );
        assert_eq!(
            normalize_update_prompt_message(Some("Release reason"), true, true),
            "Release reason"
        );
    }

    #[test]
    fn urgent_update_prompt_uses_the_release_reason() {
        assert_eq!(
            normalize_update_prompt_message(
                Some("  Activity   records may be lost.  "),
                true,
                false
            ),
            "Activity records may be lost."
        );
        assert!(normalize_update_prompt_message(None, true, false).contains("important"));
    }
}

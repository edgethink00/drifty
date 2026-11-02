// Copyright 2014-2021 The winit contributors
// Copyright 2021-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0

use std::{collections::VecDeque, ffi::CStr, panic::AssertUnwindSafe, sync::OnceLock};

use objc2::{
  exception::Exception,
  runtime::{AnyClass as Class, ClassBuilder as ClassDecl, Sel},
};
use objc2_app_kit::{self as appkit, NSApplication, NSEvent, NSEventType};
use std::sync::LazyLock;

use super::{app_state::AppState, event::EventWrapper, util, DEVICE_ID};
use crate::event::{DeviceEvent, ElementState, Event};

pub struct AppClass(pub *const Class);
unsafe impl Send for AppClass {}
unsafe impl Sync for AppClass {}

pub static APP_CLASS: LazyLock<AppClass> = LazyLock::new(|| unsafe {
  let superclass = class!(NSApplication);
  let mut decl =
    ClassDecl::new(CStr::from_bytes_with_nul(b"TaoApp\0").unwrap(), superclass).unwrap();

  decl.add_method(sel!(sendEvent:), send_event as extern "C-unwind" fn(_, _, _));

  AppClass(decl.register())
});

/// Drifty patch: receives an Objective-C exception that AppKit raised while
/// dispatching an event, before it continues to AppKit's own handler.
pub(crate) static SEND_EVENT_EXCEPTION_HOOK: OnceLock<fn(Option<&Exception>)> = OnceLock::new();

// Normally, holding Cmd + any key never sends us a `keyUp` event for that key.
// Overriding `sendEvent:` like this fixes that. (https://stackoverflow.com/a/15294196)
// Fun fact: Firefox still has this bug! (https://bugzilla.mozilla.org/show_bug.cgi?id=1299553)
//
// Drifty patch: this override sits between `-[NSApplication run]` and AppKit's
// own dispatch. Declared `extern "C"`, it stopped an Objective-C exception
// raised during dispatch with "panic in a function that cannot unwind" and
// aborted the app, leaving no trace of the exception (Sentry
// DRIFTY-MAC-NATIVE-4 and -AT, macOS 27). Without this frame the exception
// reaches `-[NSApplication run]`, which reports it and keeps running unless the
// app opts into crashing. So hand the original exception to the hook, then
// rethrow it to AppKit through a frame that may unwind.
extern "C-unwind" fn send_event(this: &NSApplication, _sel: Sel, event: &NSEvent) {
  let outcome = objc2::exception::catch(AssertUnwindSafe(|| dispatch_event(this, event)));
  let Err(exception) = outcome else {
    return;
  };
  match SEND_EVENT_EXCEPTION_HOOK.get() {
    Some(hook) => hook(exception.as_deref()),
    None => log::error!("Objective-C exception while dispatching an event"),
  }
  if let Some(exception) = exception {
    objc2::exception::throw(exception);
  }
}

fn dispatch_event(this: &NSApplication, event: &NSEvent) {
  unsafe {
    // For posterity, there are some undocumented event types
    // (https://github.com/servo/cocoa-rs/issues/155)
    // but that doesn't really matter here.
    let event_type = event.r#type();
    let modifier_flags = event.modifierFlags();
    if event_type == appkit::NSKeyUp
      && util::has_flag(modifier_flags, appkit::NSEventModifierFlags::Command)
    {
      if let Some(key_window) = this.keyWindow() {
        key_window.sendEvent(event);
      } else {
        log::debug!("skip sending CMD keyEvent - app has no keyWindow");
      }
    } else {
      maybe_dispatch_device_event(event);
      let superclass = util::superclass(this);
      let _: () = msg_send![super(this, superclass), sendEvent: event];
    }
  }
}

unsafe fn maybe_dispatch_device_event(event: &NSEvent) {
  let event_type = event.r#type();
  match event_type {
    NSEventType::MouseMoved
    | NSEventType::LeftMouseDragged
    | NSEventType::OtherMouseDragged
    | NSEventType::RightMouseDragged => {
      let mut events = VecDeque::with_capacity(3);

      let delta_x = event.deltaX() as f64;
      let delta_y = event.deltaY() as f64;

      if delta_x != 0.0 {
        events.push_back(EventWrapper::StaticEvent(Event::DeviceEvent {
          device_id: DEVICE_ID,
          event: DeviceEvent::Motion {
            axis: 0,
            value: delta_x,
          },
        }));
      }

      if delta_y != 0.0 {
        events.push_back(EventWrapper::StaticEvent(Event::DeviceEvent {
          device_id: DEVICE_ID,
          event: DeviceEvent::Motion {
            axis: 1,
            value: delta_y,
          },
        }));
      }

      if delta_x != 0.0 || delta_y != 0.0 {
        events.push_back(EventWrapper::StaticEvent(Event::DeviceEvent {
          device_id: DEVICE_ID,
          event: DeviceEvent::MouseMotion {
            delta: (delta_x, delta_y),
          },
        }));
      }

      AppState::queue_events(events);
    }
    NSEventType::LeftMouseDown | NSEventType::RightMouseDown | NSEventType::OtherMouseDown => {
      let mut events = VecDeque::with_capacity(1);

      events.push_back(EventWrapper::StaticEvent(Event::DeviceEvent {
        device_id: DEVICE_ID,
        event: DeviceEvent::Button {
          button: event.buttonNumber() as u32,
          state: ElementState::Pressed,
        },
      }));

      AppState::queue_events(events);
    }
    NSEventType::LeftMouseUp | NSEventType::RightMouseUp | NSEventType::OtherMouseUp => {
      let mut events = VecDeque::with_capacity(1);

      events.push_back(EventWrapper::StaticEvent(Event::DeviceEvent {
        device_id: DEVICE_ID,
        event: DeviceEvent::Button {
          button: event.buttonNumber() as u32,
          state: ElementState::Released,
        },
      }));

      AppState::queue_events(events);
    }
    _ => (),
  }
}

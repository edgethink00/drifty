#![allow(deprecated)]

mod macros;
pub mod raw_nspanel;

use std::{collections::HashMap, sync::Mutex};

use cocoa::base::id;
use objc::runtime::{Class, Object};
use objc_id::ShareId;
use raw_nspanel::RawNSPanel;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, RunEvent, Runtime, WebviewWindow, WindowEvent,
};

pub extern crate block;
pub extern crate cocoa;
pub extern crate objc;
pub extern crate objc_foundation;
pub extern crate objc_id;
pub extern crate tauri;

pub type Panel = ShareId<RawNSPanel>;

#[derive(Default)]
pub struct Store {
    panels: HashMap<String, ShareId<RawNSPanel>>,
    original_classes: HashMap<String, &'static Class>,
}

impl Store {
    fn remove_panel(&mut self, label: &str) -> Option<Panel> {
        let panel = self.panels.remove(label)?;
        if let Some(original) = self.original_classes.remove(label) {
            restore_class(&panel, original);
        }
        Some(panel)
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        // Restore every native class before releasing any registry references.
        // WebKit may have installed a KVO subclass before panel conversion.
        for (label, panel) in &self.panels {
            if let Some(original) = self.original_classes.get(label) {
                restore_class(panel, original);
            }
        }
    }
}

fn restore_class(panel: &Panel, original: &'static Class) {
    // SAFETY: the registry reference keeps this exact native object alive.
    // Conversion changed only its isa; the saved runtime class has process
    // lifetime and restores the layout/observers Tauri and WebKit initialized.
    unsafe {
        raw_nspanel::object_setClass(
            &**panel as *const RawNSPanel as *mut Object,
            original as *const Class as *mut Object,
        );
    }
}

pub struct WebviewPanelManager(pub Mutex<Store>);

impl Default for WebviewPanelManager {
    fn default() -> Self {
        Self(Mutex::new(Store::default()))
    }
}

pub trait ManagerExt<R: Runtime> {
    fn get_webview_panel(&self, label: &str) -> Result<ShareId<RawNSPanel>, Error>;
}

#[derive(Debug)]
pub enum Error {
    PanelNotFound,
}

impl<R: Runtime, T: Manager<R>> ManagerExt<R> for T {
    fn get_webview_panel(&self, label: &str) -> Result<ShareId<RawNSPanel>, Error> {
        let manager = self.state::<self::WebviewPanelManager>();
        let manager = manager.0.lock().unwrap();

        match manager.panels.get(label) {
            Some(panel) => Ok(panel.clone()),
            None => Err(Error::PanelNotFound),
        }
    }
}

#[derive(Default)]
pub struct WebviewPanelConfig {
    pub delegate: Option<id>,
}

pub trait WebviewWindowExt<R: Runtime> {
    fn to_panel(&self) -> tauri::Result<ShareId<RawNSPanel>>;
}

impl<R: Runtime> WebviewWindowExt<R> for WebviewWindow<R> {
    fn to_panel(&self) -> tauri::Result<ShareId<RawNSPanel>> {
        let native = self.ns_window()? as *mut Object;
        // Capture the actual isa, including WebKit's KVO subclass, rather than
        // sending `class`, which KVO can override to report the underlying class.
        let original_class = unsafe { (&*native).class() };
        let panel = RawNSPanel::from_window(self.to_owned());
        let shared_panel = panel.share();
        let manager = self.state::<self::WebviewPanelManager>();

        let mut store = manager.0.lock().unwrap();
        store
            .original_classes
            .entry(self.label().into())
            .or_insert(original_class);
        store
            .panels
            .insert(self.label().into(), shared_panel.clone());

        Ok(shared_panel)
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nspanel")
        .setup(|app, _api| {
            app.manage(self::WebviewPanelManager::default());

            Ok(())
        })
        .on_event(|app, event| {
            match event {
                // Tauri/Wry invokes plugins before dropping the WebView for a
                // Destroyed event. Restore KVO identity before its observer cleanup.
                RunEvent::WindowEvent {
                    label,
                    event: WindowEvent::Destroyed,
                    ..
                } => {
                    let removed = {
                        let manager = app.state::<WebviewPanelManager>();
                        let removed = manager.0.lock().unwrap().remove_panel(label);
                        removed
                    };
                    drop(removed);
                }
                RunEvent::Exit => {
                    let registry = {
                        let manager = app.state::<WebviewPanelManager>();
                        let mut store = manager.0.lock().unwrap();
                        std::mem::take(&mut *store)
                    };
                    drop(registry);
                }
                _ => {}
            }
        })
        .build()
}

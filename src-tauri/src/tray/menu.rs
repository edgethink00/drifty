use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{AppHandle, Runtime};

/// Await the native result without blocking an IPC worker or holding a state
/// lock across the handoff. The callback reads its snapshot on the main thread.
pub(super) async fn run_menu_update<R: Runtime>(
    app: AppHandle<R>,
    update: impl FnOnce(&AppHandle<R>) -> tauri::Result<()> + Send + 'static,
) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let callback_app = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.try_send(update(&callback_app).map_err(|error| error.to_string()));
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "Native menu update did not complete".to_string())?
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct MenuRow {
    pub id: &'static str,
    pub text: Option<String>,
    pub enabled: bool,
    pub visible: bool,
}

impl MenuRow {
    pub fn item(id: &'static str, text: impl Into<String>, enabled: bool, visible: bool) -> Self {
        Self {
            id,
            text: Some(text.into()),
            enabled,
            visible,
        }
    }

    pub fn separator(id: &'static str) -> Self {
        Self {
            id,
            text: None,
            enabled: false,
            visible: true,
        }
    }
}

/// A fixed pool of Rust menu items, including items currently absent from the popup.
///
/// muda 0.19 stores a raw MenuChild pointer in NSMenuItem. AppKit can retain a
/// removed item for a pending click, so EVERY item stays owned for the life of
/// this menu. Refreshes only change labels/states and membership, never replace
/// the root or discard a pool item. The pool size does not grow with refreshes.
pub(super) struct TrayMenu<R: Runtime> {
    pub menu: Menu<R>,
    items: Vec<MenuItemKind<R>>,
    applied: Option<Vec<MenuRow>>,
    schema: Vec<(&'static str, bool)>,
}

impl<R: Runtime> TrayMenu<R> {
    pub fn new(app: &AppHandle<R>, rows: Vec<MenuRow>) -> tauri::Result<Self> {
        let menu = Menu::new(app)?;
        let mut items = Vec::with_capacity(rows.len());
        for row in &rows {
            items.push(match &row.text {
                Some(text) => MenuItemKind::MenuItem(MenuItem::with_id(
                    app,
                    row.id,
                    text,
                    row.enabled,
                    None::<&str>,
                )?),
                None => MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?),
            });
        }
        let schema = rows
            .iter()
            .map(|row| (row.id, row.text.is_some()))
            .collect();
        let mut result = Self {
            menu,
            items,
            applied: None,
            schema,
        };
        result.apply(rows)?;
        Ok(result)
    }

    /// Call the entire transaction on the main thread, not one native operation
    /// at a time from competing workers. Rows always use the same pool order.
    pub fn apply(&mut self, rows: Vec<MenuRow>) -> tauri::Result<()> {
        assert!(self
            .schema
            .iter()
            .copied()
            .eq(rows.iter().map(|row| (row.id, row.text.is_some()))));
        if self.applied.as_ref() == Some(&rows) {
            return Ok(());
        }
        // A partial native error must not leave an old successful snapshot that
        // suppresses the next retry (including a return to that old snapshot).
        self.applied = None;
        for (item, row) in self.items.iter().zip(&rows) {
            if let (MenuItemKind::MenuItem(item), Some(text)) = (item, &row.text) {
                if item.text()? != *text {
                    item.set_text(text)?;
                }
                if item.is_enabled()? != row.enabled {
                    item.set_enabled(row.enabled)?;
                }
            }
        }

        // The relative order is fixed. Remove only hidden rows, then insert
        // newly visible ones; unaffected native items retain their identity.
        let mut current = self.menu.items()?;
        for (item, row) in self.items.iter().zip(&rows) {
            if !row.visible {
                if let Some(index) = current.iter().position(|entry| entry.id() == item.id()) {
                    self.menu.remove(item)?;
                    current.remove(index);
                }
            }
        }
        let mut index = 0;
        for (item, row) in self.items.iter().zip(&rows) {
            if row.visible {
                if current.get(index).map(|entry| entry.id()) != Some(item.id()) {
                    self.menu.insert(item, index)?;
                    current.insert(index, item.clone());
                }
                index += 1;
            }
        }
        self.applied = Some(rows);
        Ok(())
    }
}

//! Shared authored scene coordinates and the independent transparent surface.
use serde::Deserialize;
use std::sync::OnceLock;
use tauri::{LogicalPosition, LogicalSize};

#[derive(Clone, Copy, Debug, Deserialize)]
pub(super) struct PetRenderPadding {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PetRenderLayout {
    version: u32,
    pub scene_width: f64,
    pub scene_height: f64,
    pub padding: PetRenderPadding,
}

impl PetRenderLayout {
    fn validate(self) -> Result<Self, &'static str> {
        if self.version != 1
            || self.scene_width != 144.0
            || self.scene_height != 99.0
            || [
                self.padding.left,
                self.padding.top,
                self.padding.right,
                self.padding.bottom,
            ]
            .into_iter()
            .any(|value| !value.is_finite() || value < 0.0)
        {
            return Err("invalid Pet Mode rendering layout");
        }
        Ok(self)
    }

    pub fn geometry(self, scene_width: f64) -> PetRenderGeometry {
        let scale = scene_width / self.scene_width;
        PetRenderGeometry {
            scene_width,
            scene_height: self.scene_height * scale,
            left: self.padding.left * scale,
            top: self.padding.top * scale,
            render_width: (self.scene_width + self.padding.left + self.padding.right) * scale,
            render_height: (self.scene_height + self.padding.top + self.padding.bottom) * scale,
        }
    }
}

pub(super) fn pet_render_layout() -> &'static PetRenderLayout {
    static LAYOUT: OnceLock<PetRenderLayout> = OnceLock::new();
    LAYOUT.get_or_init(|| {
        serde_json::from_str::<PetRenderLayout>(include_str!(
            "../../../apps/desktop/src/features/pet-mode/render-layout-v1.json"
        ))
        .expect("Pet Mode rendering layout must be valid JSON")
        .validate()
        .expect("Pet Mode rendering layout must match the native scene contract")
    })
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PetRenderGeometry {
    pub scene_width: f64,
    pub scene_height: f64,
    pub left: f64,
    pub top: f64,
    pub render_width: f64,
    pub render_height: f64,
}

impl PetRenderGeometry {
    pub fn scale(self) -> f64 {
        self.scene_width / pet_render_layout().scene_width
    }

    pub fn window_point_for_canonical(self, point: (f64, f64)) -> (f64, f64) {
        (
            self.left + point.0 * self.scale(),
            self.top + point.1 * self.scale(),
        )
    }

    pub fn canonical_point_at_window(self, point: (f64, f64)) -> (f64, f64) {
        (
            (point.0 - self.left) / self.scale(),
            (point.1 - self.top) / self.scale(),
        )
    }

    pub fn window_size(self) -> LogicalSize<f64> {
        LogicalSize::new(self.render_width, self.render_height)
    }

    pub fn scene_to_window(self, scene: LogicalPosition<f64>) -> LogicalPosition<f64> {
        LogicalPosition::new(scene.x - self.left, scene.y - self.top)
    }

    pub fn window_to_scene(self, window: LogicalPosition<f64>) -> LogicalPosition<f64> {
        LogicalPosition::new(window.x + self.left, window.y + self.top)
    }

    pub fn physical_scene_rect(self, dpi: f64) -> (f64, f64, f64, f64) {
        (
            self.left * dpi,
            self.top * dpi,
            self.scene_width * dpi,
            self.scene_height * dpi,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_layout_keeps_the_existing_authored_scene() {
        let layout = pet_render_layout();
        assert_eq!((layout.scene_width, layout.scene_height), (144.0, 99.0));
    }

    #[test]
    fn padding_changes_neither_world_body_contacts_nor_uniform_scale() {
        for size in [0.5, 0.75, 1.0, 1.25] {
            for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
                for origin in [(200.0, 14.0), (-1840.0, -1080.0), (14.0, 720.0)] {
                    for padding in [
                        PetRenderPadding {
                            left: 0.0,
                            top: 0.0,
                            right: 0.0,
                            bottom: 0.0,
                        },
                        PetRenderPadding {
                            left: 18.0,
                            top: 64.0,
                            right: 23.0,
                            bottom: 16.0,
                        },
                        pet_render_layout().padding,
                    ] {
                        let geometry = PetRenderLayout {
                            version: 1,
                            scene_width: 144.0,
                            scene_height: 99.0,
                            padding,
                        }
                        .geometry(144.0 * size);
                        let scene = LogicalPosition::new(origin.0, origin.1);
                        let window = geometry.scene_to_window(scene);
                        let restored = geometry.window_to_scene(window);
                        for point in [(143.0, 40.0), (109.2, 47.8), (72.0, 93.0)] {
                            let actual = (
                                (window.x + geometry.left + point.0 * size) * dpi,
                                (window.y + geometry.top + point.1 * size) * dpi,
                            );
                            let expected = (
                                (scene.x + point.0 * size) * dpi,
                                (scene.y + point.1 * size) * dpi,
                            );
                            assert!((actual.0 - expected.0).abs() < 1e-9);
                            assert!((actual.1 - expected.1).abs() < 1e-9);
                        }
                        assert!((restored.x - scene.x).abs() < 1e-9);
                        assert!((restored.y - scene.y).abs() < 1e-9);
                        assert_eq!(geometry.scene_height, 99.0 * size);
                    }
                }
            }
        }
    }

    #[test]
    fn invalid_layout_is_rejected_before_native_geometry_is_used() {
        let mut layout = *pet_render_layout();
        layout.padding.top = f64::NAN;
        assert!(layout.validate().is_err());
        layout = *pet_render_layout();
        layout.padding.left = -1.0;
        assert!(layout.validate().is_err());
        layout = *pet_render_layout();
        layout.version = 2;
        assert!(layout.validate().is_err());
    }

    #[test]
    fn canonical_grab_point_survives_both_pet_scale_and_dpi_changes() {
        let canonical = (50.0, 40.0);
        let mouse = (-1840.25, 100.75);
        for pet_scale in [0.5, 0.75, 1.0, 1.25] {
            for dpi in [1.0, 1.25, 1.5, 1.75, 2.0] {
                let geometry = pet_render_layout().geometry(144.0 * pet_scale);
                let offset = geometry.window_point_for_canonical(canonical);
                let origin = (mouse.0 - offset.0 * dpi, mouse.1 - offset.1 * dpi);
                let roundtrip = geometry.canonical_point_at_window((
                    (mouse.0 - origin.0) / dpi,
                    (mouse.1 - origin.1) / dpi,
                ));
                assert!((roundtrip.0 - canonical.0).abs() < 1e-9);
                assert!((roundtrip.1 - canonical.1).abs() < 1e-9);
            }
        }
    }
}

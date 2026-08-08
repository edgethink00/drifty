use serde::Deserialize;

#[derive(Clone, Copy)]
struct ProductivityShares {
    focus: f64,
    drift: f64,
    neutral: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TrayIconStyle {
    #[default]
    Compact,
    Expanded,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TrayDisplayMode {
    /// Keep this default aligned with `COMPANION_MENU_BAR_DISPLAY_DEFAULT` in
    /// `companionPillSettings.ts`. The donut is the only display narrow enough
    /// to always survive a crowded menu bar.
    #[default]
    Donut,
    FocusTime,
    DonutFocusTime,
}

#[derive(Clone, Copy)]
pub struct DonutIconRenderInput {
    pub focus: f64,
    pub drift: f64,
    pub neutral: f64,
    pub is_dark: bool,
    pub style: TrayIconStyle,
}

pub fn render(input: DonutIconRenderInput) -> (Vec<u8>, u32, u32) {
    const H: usize = 18;

    let width = match input.style {
        TrayIconStyle::Compact => 18,
        TrayIconStyle::Expanded => 40,
    };
    let logo_rgb: [u8; 3] = [0xf1, 0xef, 0xe7];
    let focus_rgb: [u8; 3] = if input.is_dark {
        [0xcf, 0xe8, 0x6a]
    } else {
        [0x53, 0x64, 0x14]
    };
    let drift_rgb: [u8; 3] = if input.is_dark {
        [0xf2, 0x8a, 0x78]
    } else {
        [0x8f, 0x35, 0x2d]
    };
    let neutral_rgb: [u8; 3] = if input.is_dark {
        [0x6a, 0x67, 0x5e]
    } else {
        [0xb8, 0xb3, 0xa7]
    };

    let mut pixels = vec![0u8; width * H * 4];

    if input.style == TrayIconStyle::Expanded {
        for py in 0..H {
            for px in 0..18usize {
                let alpha = hourglass_alpha(px as f32 + 0.5, py as f32 + 0.5);
                if alpha > 0.0 {
                    let i = (py * width + px) * 4;
                    pixels[i] = logo_rgb[0];
                    pixels[i + 1] = logo_rgb[1];
                    pixels[i + 2] = logo_rgb[2];
                    pixels[i + 3] = (alpha * 255.0) as u8;
                }
            }
        }
    }

    let ring_start = match input.style {
        TrayIconStyle::Compact => 0,
        TrayIconStyle::Expanded => 22,
    };
    let cx = match input.style {
        TrayIconStyle::Compact => 9.0,
        TrayIconStyle::Expanded => 31.0,
    };
    let cy = 9.0f64;
    let r = 6.5f64;
    let sw = 2.5f64;

    let shares = normalize_shares(input.focus, input.drift, input.neutral);
    let tau = std::f64::consts::TAU;
    let half_pi = std::f64::consts::FRAC_PI_2;

    let focus_end = shares.map(|value| value.focus * tau).unwrap_or(0.0);
    let drift_end = shares
        .map(|value| (value.focus + value.drift) * tau)
        .unwrap_or(0.0);
    let neutral_end = shares
        .map(|value| (value.focus + value.drift + value.neutral) * tau)
        .unwrap_or(0.0);

    for py in 0..H {
        for px in ring_start..width {
            let dx = px as f64 + 0.5 - cx;
            let dy = py as f64 + 0.5 - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            let ring_dist = (dist - r).abs() - sw * 0.5;
            if ring_dist > 1.5 {
                continue;
            }
            let ring_alpha = ((1.5 - ring_dist.max(0.0)) / 1.5).min(1.0);

            // Angle from 12 o'clock clockwise (0..TAU)
            let angle = (dy.atan2(dx) + half_pi).rem_euclid(tau);

            let (color, alpha) = if shares.is_none() {
                (neutral_rgb, ring_alpha * 0.35)
            } else if angle < focus_end {
                (focus_rgb, ring_alpha)
            } else if angle < drift_end {
                (drift_rgb, ring_alpha)
            } else if angle < neutral_end {
                (neutral_rgb, ring_alpha)
            } else {
                (neutral_rgb, ring_alpha * 0.35)
            };

            let i = (py * width + px) * 4;
            pixels[i] = color[0];
            pixels[i + 1] = color[1];
            pixels[i + 2] = color[2];
            pixels[i + 3] = (alpha * 255.0) as u8;
        }
    }

    (pixels, width as u32, H as u32)
}

pub fn render_focus_dot(is_dark: bool) -> (Vec<u8>, u32, u32) {
    const W: usize = 10;
    const H: usize = 18;
    let focus_rgb: [u8; 3] = if is_dark {
        [0xcf, 0xe8, 0x6a]
    } else {
        [0x53, 0x64, 0x14]
    };
    let mut pixels = vec![0u8; W * H * 4];
    for py in 0..H {
        for px in 0..W {
            let dx = px as f64 + 0.5 - 5.0;
            let dy = py as f64 + 0.5 - 9.0;
            let distance = (dx * dx + dy * dy).sqrt();
            let alpha = (4.0 - distance).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }
            let index = (py * W + px) * 4;
            pixels[index] = focus_rgb[0];
            pixels[index + 1] = focus_rgb[1];
            pixels[index + 2] = focus_rgb[2];
            pixels[index + 3] = (alpha * 255.0) as u8;
        }
    }
    (pixels, W as u32, H as u32)
}

fn normalize_shares(focus: f64, drift: f64, neutral: f64) -> Option<ProductivityShares> {
    let focus = finite_non_negative(focus);
    let drift = finite_non_negative(drift);
    let neutral = finite_non_negative(neutral);
    let total = focus + drift + neutral;
    if total <= f64::EPSILON {
        return None;
    }

    Some(ProductivityShares {
        focus: focus / total,
        drift: drift / total,
        neutral: neutral / total,
    })
}

fn finite_non_negative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn hourglass_alpha(px: f32, py: f32) -> f32 {
    // 80% scale around center (9, 9)
    if point_in_triangle(px, py, 2.6, 2.6, 15.4, 2.6, 9.0, 9.0)
        || point_in_triangle(px, py, 9.0, 9.0, 15.4, 15.4, 2.6, 15.4)
    {
        1.0
    } else {
        0.0
    }
}

fn point_in_triangle(
    px: f32,
    py: f32,
    ax: f32,
    ay: f32,
    bx: f32,
    by: f32,
    cx: f32,
    cy: f32,
) -> bool {
    let cross = |p1x: f32, p1y: f32, p2x: f32, p2y: f32, p3x: f32, p3y: f32| {
        (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y)
    };
    let d1 = cross(px, py, ax, ay, bx, by);
    let d2 = cross(px, py, bx, by, cx, cy);
    let d3 = cross(px, py, cx, cy, ax, ay);
    let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_neg && has_pos)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count_color(pixels: &[u8], rgb: [u8; 3]) -> usize {
        pixels
            .chunks_exact(4)
            .filter(|pixel| pixel[0..3] == rgb && pixel[3] > 0)
            .count()
    }

    #[test]
    fn tray_icon_style_deserializes_from_frontend_values() {
        assert_eq!(
            serde_json::from_value::<TrayIconStyle>(serde_json::json!("compact")).expect("compact"),
            TrayIconStyle::Compact,
        );
        assert_eq!(
            serde_json::from_value::<TrayIconStyle>(serde_json::json!("expanded"))
                .expect("expanded"),
            TrayIconStyle::Expanded,
        );
    }

    #[test]
    fn tray_display_mode_deserializes_from_frontend_values() {
        assert_eq!(
            serde_json::from_value::<TrayDisplayMode>(serde_json::json!("donut")).expect("donut"),
            TrayDisplayMode::Donut,
        );
        assert_eq!(
            serde_json::from_value::<TrayDisplayMode>(serde_json::json!("focusTime"))
                .expect("focus time"),
            TrayDisplayMode::FocusTime,
        );
        assert_eq!(
            serde_json::from_value::<TrayDisplayMode>(serde_json::json!("donutFocusTime"))
                .expect("donut and focus time"),
            TrayDisplayMode::DonutFocusTime,
        );
    }

    #[test]
    fn donut_is_the_default_menu_bar_display() {
        assert_eq!(TrayDisplayMode::default(), TrayDisplayMode::Donut);
    }

    #[test]
    fn focus_time_display_renders_a_compact_focus_dot() {
        let (pixels, width, height) = render_focus_dot(true);

        assert_eq!((width, height), (10, 18));
        assert!(count_color(&pixels, [0xcf, 0xe8, 0x6a]) > 0);
    }

    #[test]
    fn render_colors_full_ring_with_productivity_shares() {
        let (pixels, width, height) = render(DonutIconRenderInput {
            focus: 0.4,
            drift: 0.25,
            neutral: 0.35,
            is_dark: true,
            style: TrayIconStyle::Compact,
        });

        assert_eq!((width, height), (18, 18));
        assert!(count_color(&pixels, [0xcf, 0xe8, 0x6a]) > 0);
        assert!(count_color(&pixels, [0xf2, 0x8a, 0x78]) > 0);
        assert!(count_color(&pixels, [0x6a, 0x67, 0x5e]) > 0);
        assert_eq!(count_color(&pixels, [0xf1, 0xef, 0xe7]), 0);
    }

    #[test]
    fn render_without_measurements_uses_neutral_fallback() {
        let (pixels, _, _) = render(DonutIconRenderInput {
            focus: 0.0,
            drift: 0.0,
            neutral: 0.0,
            is_dark: true,
            style: TrayIconStyle::Compact,
        });

        assert_eq!(count_color(&pixels, [0xcf, 0xe8, 0x6a]), 0);
        assert_eq!(count_color(&pixels, [0xf2, 0x8a, 0x78]), 0);
        assert!(count_color(&pixels, [0x6a, 0x67, 0x5e]) > 0);
    }

    #[test]
    fn expanded_render_uses_light_logo_in_both_appearances() {
        let (dark_pixels, dark_width, dark_height) = render(DonutIconRenderInput {
            focus: 0.0,
            drift: 0.0,
            neutral: 0.0,
            is_dark: true,
            style: TrayIconStyle::Expanded,
        });
        let (light_pixels, light_width, light_height) = render(DonutIconRenderInput {
            focus: 0.0,
            drift: 0.0,
            neutral: 0.0,
            is_dark: false,
            style: TrayIconStyle::Expanded,
        });

        assert_eq!((dark_width, dark_height), (40, 18));
        assert_eq!((light_width, light_height), (40, 18));
        assert!(count_color(&dark_pixels, [0xf1, 0xef, 0xe7]) > 0);
        assert!(count_color(&light_pixels, [0xf1, 0xef, 0xe7]) > 0);
        assert_eq!(count_color(&light_pixels, [26, 26, 26]), 0);
    }
}

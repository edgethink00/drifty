#[derive(Clone, Copy)]
struct ProductivityShares {
    focus: f64,
    drift: f64,
    neutral: f64,
}

pub fn render(focus: f64, drift: f64, neutral: f64, is_dark: bool) -> (Vec<u8>, u32, u32) {
    const W: usize = 40;
    const H: usize = 18;

    let logo_rgb: [u8; 3] = [0xf1, 0xef, 0xe7];
    let focus_rgb: [u8; 3] = if is_dark {
        [0xcf, 0xe8, 0x6a]
    } else {
        [0x53, 0x64, 0x14]
    };
    let drift_rgb: [u8; 3] = if is_dark {
        [0xf2, 0x8a, 0x78]
    } else {
        [0x8f, 0x35, 0x2d]
    };
    let neutral_rgb: [u8; 3] = if is_dark {
        [0x6a, 0x67, 0x5e]
    } else {
        [0xb8, 0xb3, 0xa7]
    };

    let mut pixels = vec![0u8; W * H * 4];

    // Hourglass: two triangles in 18×18 left region
    // Top triangle:    (1,1) (17,1) (9,9)
    // Bottom triangle: (9,9) (17,17) (1,17)
    for py in 0..H {
        for px in 0..18usize {
            let alpha = hourglass_alpha(px as f32 + 0.5, py as f32 + 0.5);
            if alpha > 0.0 {
                let i = (py * W + px) * 4;
                pixels[i] = logo_rgb[0];
                pixels[i + 1] = logo_rgb[1];
                pixels[i + 2] = logo_rgb[2];
                pixels[i + 3] = (alpha * 255.0) as u8;
            }
        }
    }

    // Donut ring: x=22..40, center=(31,9), r=6.5, stroke=2.5
    let cx = 31.0f64;
    let cy = 9.0f64;
    let r = 6.5f64;
    let sw = 2.5f64;

    let shares = normalize_shares(focus, drift, neutral);
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
        for px in 22..W {
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

            let i = (py * W + px) * 4;
            pixels[i] = color[0];
            pixels[i + 1] = color[1];
            pixels[i + 2] = color[2];
            pixels[i + 3] = (alpha * 255.0) as u8;
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
    fn render_colors_full_ring_with_productivity_shares() {
        let (pixels, _, _) = render(0.4, 0.25, 0.35, true);

        assert!(count_color(&pixels, [0xcf, 0xe8, 0x6a]) > 0);
        assert!(count_color(&pixels, [0xf2, 0x8a, 0x78]) > 0);
        assert!(count_color(&pixels, [0x6a, 0x67, 0x5e]) > 0);
    }

    #[test]
    fn render_without_measurements_uses_neutral_fallback() {
        let (pixels, _, _) = render(0.0, 0.0, 0.0, true);

        assert_eq!(count_color(&pixels, [0xcf, 0xe8, 0x6a]), 0);
        assert_eq!(count_color(&pixels, [0xf2, 0x8a, 0x78]), 0);
        assert!(count_color(&pixels, [0x6a, 0x67, 0x5e]) > 0);
    }

    #[test]
    fn render_uses_light_logo_in_both_appearances() {
        let (dark_pixels, _, _) = render(0.0, 0.0, 0.0, true);
        let (light_pixels, _, _) = render(0.0, 0.0, 0.0, false);

        assert!(count_color(&dark_pixels, [0xf1, 0xef, 0xe7]) > 0);
        assert!(count_color(&light_pixels, [0xf1, 0xef, 0xe7]) > 0);
        assert_eq!(count_color(&light_pixels, [26, 26, 26]), 0);
    }
}

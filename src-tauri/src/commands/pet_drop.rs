use serde::{Deserialize, Serialize};

pub const PET_DROP_HOP_PT: f64 = 4.0;
pub const PET_DROP_CATCH_PT: f64 = 65.0;
pub const PET_DROP_TOP_HOME_PT: f64 = 58.0;
pub const PET_DROP_FLOOR_HOME_PT: f64 = 40.0;
pub const PET_DROP_ON_LEDGE_PT: f64 = 18.0;
pub const PET_DROP_FEET_INSET_PT: f64 = 93.0;
pub const PET_DROP_SLAB_LEFT_PT: f64 = 28.0;
pub const PET_DROP_SLAB_RIGHT_PT: f64 = 116.0;
pub const PET_DROP_G: f64 = 0.25;
pub const PET_DROP_MIN_MS: u64 = 16;
const POINTS_PER_METER: f64 = 96.0 / 0.0254;
const GRAVITY_MPS2: f64 = 9.80665;

#[derive(Clone, Debug, PartialEq)]
pub struct PetRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PetDropKind {
    Hold,
    StayTop,
    StayFloor,
    AlreadyOn,
    Catch,
    Hop,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetDropPlan {
    pub kind: PetDropKind,
    pub distance: f64,
    pub duration_ms: u64,
    pub target_y: f64,
    pub ledge: String,
}

impl PetRect {
    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }
}

pub fn pet_feet_y(pet: &PetRect) -> f64 {
    pet.y + PET_DROP_FEET_INSET_PT * pet.height / 99.0
}

pub fn pet_slab(pet: &PetRect) -> (f64, f64, f64) {
    let scale = pet.width / 144.0;
    (
        pet.x + PET_DROP_SLAB_LEFT_PT * scale,
        pet.x + PET_DROP_SLAB_RIGHT_PT * scale,
        pet_feet_y(pet),
    )
}

pub fn gravity_duration_ms(distance_pt: f64) -> u64 {
    if distance_pt <= 0.0 {
        return PET_DROP_MIN_MS;
    }
    let meters = distance_pt / POINTS_PER_METER;
    let seconds = (2.0 * meters / (GRAVITY_MPS2 * PET_DROP_G)).sqrt();
    ((seconds * 1000.0).round() as u64).max(PET_DROP_MIN_MS)
}

pub fn overlaps_horizontally(left: f64, right: f64, other: &PetRect) -> bool {
    !(other.right() < left || other.x > right)
}

pub const MIN_VISIBLE_LEDGE_WIDTH_PT: f64 = 16.0;

fn subtract_interval(intervals: &mut Vec<(f64, f64)>, occluder_left: f64, occluder_right: f64) {
    let mut next = Vec::new();
    for (a, b) in intervals.drain(..) {
        if occluder_right <= a || occluder_left >= b {
            next.push((a, b));
        } else if occluder_left <= a && occluder_right >= b {
            // completely covered by front window
            continue;
        } else if occluder_left > a && occluder_right < b {
            next.push((a, occluder_left));
            next.push((occluder_right, b));
        } else if occluder_left <= a && occluder_right < b {
            next.push((occluder_right, b));
        } else if occluder_left > a && occluder_right >= b {
            next.push((a, occluder_left));
        }
    }
    *intervals = next;
}

pub fn nearest_ledge<'a>(
    pet: &PetRect,
    windows: &'a [(&'a str, PetRect)],
    dock: Option<&PetRect>,
    work: &PetRect,
) -> (&'a str, f64) {
    let (slab_left, slab_right, feet) = pet_slab(pet);
    let mut found: Vec<(&str, f64)> = Vec::new();

    for (i, (name, rect)) in windows.iter().enumerate() {
        if rect.y < feet - PET_DROP_ON_LEDGE_PT {
            continue;
        }
        let overlap_left = slab_left.max(rect.x);
        let overlap_right = slab_right.min(rect.right());
        if overlap_right <= overlap_left {
            continue;
        }

        // Check if windows in front of this window (earlier in Z-order) occlude the top edge.
        let mut visible_intervals = vec![(overlap_left, overlap_right)];
        for (_, front) in &windows[..i] {
            if front.y <= rect.y && front.bottom() > rect.y {
                subtract_interval(&mut visible_intervals, front.x, front.right());
                if visible_intervals.is_empty() {
                    break;
                }
            }
        }

        let visible_width: f64 = visible_intervals.iter().map(|(a, b)| b - a).sum();
        if visible_width >= MIN_VISIBLE_LEDGE_WIDTH_PT {
            found.push((*name, rect.y));
        }
    }

    if let Some(dock) = dock {
        if overlaps_horizontally(slab_left, slab_right, dock)
            && dock.y >= feet - PET_DROP_ON_LEDGE_PT
        {
            found.push(("Dock", dock.y));
        }
    }
    found.push(("floor", work.bottom()));
    found.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    found[0]
}

pub fn plan_pet_drop(
    held: bool,
    pet: &PetRect,
    work: &PetRect,
    windows: &[(&str, PetRect)],
    dock: Option<&PetRect>,
) -> PetDropPlan {
    if held {
        return PetDropPlan {
            kind: PetDropKind::Hold,
            distance: 0.0,
            duration_ms: 0,
            target_y: pet.y,
            ledge: "hold".into(),
        };
    }

    let feet = pet_feet_y(pet);
    let top_home = pet.y <= work.y + PET_DROP_TOP_HOME_PT;
    let floor_home = feet >= work.bottom() - PET_DROP_FLOOR_HOME_PT;
    let (ledge, ledge_y) = nearest_ledge(pet, windows, dock, work);
    let air = (ledge_y - feet).max(0.0);
    let has_ledge = ledge != "floor";

    if has_ledge && air <= PET_DROP_ON_LEDGE_PT {
        // air is never negative here, so this can only settle downward.
        let target_y = (pet.y + air).clamp(work.y, (work.bottom() - pet.height).max(work.y));
        return PetDropPlan {
            kind: PetDropKind::AlreadyOn,
            distance: air,
            duration_ms: 0,
            target_y,
            ledge: ledge.into(),
        };
    }
    if top_home {
        return PetDropPlan {
            kind: PetDropKind::StayTop,
            distance: 0.0,
            duration_ms: 0,
            target_y: pet.y,
            ledge: "menubar".into(),
        };
    }
    if floor_home {
        return PetDropPlan {
            kind: PetDropKind::StayFloor,
            distance: 0.0,
            duration_ms: 0,
            target_y: pet.y,
            ledge: "floor".into(),
        };
    }

    // Windows, Dock, and the desktop floor catch the pet when within
    // PET_DROP_CATCH_PT (65pt). Drops further in open mid-screen space perform
    // a gentle 4pt hop and stay at the user's placed height instead of
    // plunging across the entire screen.
    let can_catch = air > PET_DROP_ON_LEDGE_PT && air <= PET_DROP_CATCH_PT;
    let distance = if can_catch {
        air
    } else {
        PET_DROP_HOP_PT.min(air)
    };
    let unclamped_target = if can_catch {
        ledge_y - PET_DROP_FEET_INSET_PT * pet.height / 99.0
    } else {
        pet.y + distance
    };
    // Catch may land on the Dock, which sits on or below the work-area edge.
    // Hop stays inside the work area so a miss never leaves the desktop lane.
    let target_y = if can_catch {
        unclamped_target.max(work.y)
    } else {
        let max_y = (work.bottom() - pet.height).max(work.y);
        unclamped_target.clamp(work.y, max_y)
    };
    PetDropPlan {
        kind: if can_catch {
            PetDropKind::Catch
        } else {
            PetDropKind::Hop
        },
        distance,
        duration_ms: gravity_duration_ms(distance),
        target_y,
        ledge: if can_catch {
            ledge.into()
        } else {
            "hop".into()
        },
    }
}

/// An explicit shake just before release ignores intermediate window ledges
/// and sends the cat to the bottom of the current monitor's usable desktop
/// lane. The native clamp uses the complete panel bounds, so target the panel
/// bottom rather than the visible-paw inset used by ordinary ledge catches.
pub fn plan_pet_shake_floor_drop(pet: &PetRect, work: &PetRect) -> PetDropPlan {
    let target_y = (work.bottom() - pet.height).max(work.y);
    let distance = (target_y - pet.y).max(0.0);
    if distance <= f64::EPSILON {
        return PetDropPlan {
            kind: PetDropKind::StayFloor,
            distance: 0.0,
            duration_ms: 0,
            target_y: pet.y,
            ledge: "floor".into(),
        };
    }
    PetDropPlan {
        kind: PetDropKind::Catch,
        distance,
        duration_ms: gravity_duration_ms(distance),
        target_y,
        ledge: "floor".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pet_at(x: f64, y: f64) -> PetRect {
        PetRect {
            x,
            y,
            width: 144.0,
            height: 99.0,
        }
    }

    fn work() -> PetRect {
        PetRect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 875.0,
        }
    }

    #[test]
    fn hold_never_falls() {
        let plan = plan_pet_drop(true, &pet_at(200.0, 200.0), &work(), &[], None);
        assert_eq!(plan.kind, PetDropKind::Hold);
        assert_eq!(plan.distance, 0.0);
    }

    #[test]
    fn top_home_stays_without_a_window() {
        let plan = plan_pet_drop(false, &pet_at(1200.0, 39.0), &work(), &[], None);
        assert_eq!(plan.kind, PetDropKind::StayTop);
    }

    #[test]
    fn floor_home_stays() {
        let plan = plan_pet_drop(false, &pet_at(80.0, 820.0), &work(), &[], None);
        assert_eq!(plan.kind, PetDropKind::StayFloor);
    }

    #[test]
    fn already_on_titlebar_does_not_fall() {
        let safari = PetRect {
            x: 500.0,
            y: 150.0,
            width: 360.0,
            height: 240.0,
        };
        let plan = plan_pet_drop(
            false,
            &pet_at(560.0, 57.0),
            &work(),
            &[("Safari", safari)],
            None,
        );
        assert_eq!(plan.kind, PetDropKind::AlreadyOn);
        assert_eq!(plan.ledge, "Safari");
        assert!((plan.target_y - 57.0).abs() < 0.01);
    }

    #[test]
    fn already_on_snaps_down_but_never_up() {
        let safari = PetRect {
            x: 500.0,
            y: 160.0,
            width: 360.0,
            height: 240.0,
        };
        let plan = plan_pet_drop(
            false,
            &pet_at(560.0, 55.0),
            &work(),
            &[("Safari", safari)],
            None,
        );
        assert_eq!(plan.kind, PetDropKind::AlreadyOn);
        assert!((plan.target_y - 67.0).abs() < 0.01);
        assert!(plan.target_y > 55.0);
    }

    #[test]
    fn inside_window_does_not_teleport_up() {
        let safari = PetRect {
            x: 340.0,
            y: 210.0,
            width: 420.0,
            height: 260.0,
        };
        let plan = plan_pet_drop(
            false,
            &pet_at(420.0, 250.0),
            &work(),
            &[("Safari", safari)],
            None,
        );
        assert_ne!(plan.kind, PetDropKind::AlreadyOn);
        assert!(plan.target_y >= 250.0);
    }

    #[test]
    fn catch_falls_to_titlebar_inside_max_range() {
        let safari = PetRect {
            x: 500.0,
            y: 340.0,
            width: 360.0,
            height: 240.0,
        };
        let plan = plan_pet_drop(
            false,
            &pet_at(560.0, 200.0),
            &work(),
            &[("Safari", safari)],
            None,
        );
        assert_eq!(plan.kind, PetDropKind::Catch);
        assert_eq!(plan.ledge, "Safari");
        assert!((plan.target_y + 93.0 - 340.0).abs() < 0.01);
        assert!(plan.duration_ms >= PET_DROP_MIN_MS);
    }

    #[test]
    fn empty_desktop_inside_max_fall_lands_on_the_floor() {
        let plan = plan_pet_drop(false, &pet_at(560.0, 760.0), &work(), &[], None);
        assert_eq!(plan.kind, PetDropKind::Catch);
        assert_eq!(plan.ledge, "floor");
        assert!((plan.target_y - (work().bottom() - 93.0)).abs() < 0.01);
    }

    #[test]
    fn empty_desktop_above_max_range_uses_hop() {
        let plan = plan_pet_drop(false, &pet_at(560.0, 150.0), &work(), &[], None);
        assert_eq!(plan.kind, PetDropKind::Hop);
        assert_eq!(plan.distance, PET_DROP_HOP_PT);
        assert!((plan.target_y - 154.0).abs() < 0.01);
    }

    #[test]
    fn shake_drop_falls_from_mid_screen_to_the_safe_floor() {
        let pet = pet_at(560.0, 150.0);
        let plan = plan_pet_shake_floor_drop(&pet, &work());
        assert_eq!(plan.kind, PetDropKind::Catch);
        assert_eq!(plan.ledge, "floor");
        assert!((plan.target_y - (work().bottom() - pet.height)).abs() < 0.01);
        assert!((plan.distance - (plan.target_y - pet.y)).abs() < 0.01);
        assert!(plan.duration_ms > gravity_duration_ms(PET_DROP_HOP_PT));
    }

    #[test]
    fn shake_drop_is_a_noop_when_the_panel_is_already_at_the_floor() {
        let pet = pet_at(560.0, work().bottom() - 99.0);
        let plan = plan_pet_shake_floor_drop(&pet, &work());
        assert_eq!(plan.kind, PetDropKind::StayFloor);
        assert_eq!(plan.distance, 0.0);
        assert_eq!(plan.target_y, pet.y);
    }

    #[test]
    fn shake_drop_ignores_the_normal_top_home_rule() {
        let pet = pet_at(560.0, work().y + 10.0);
        let plan = plan_pet_shake_floor_drop(&pet, &work());
        assert_eq!(plan.kind, PetDropKind::Catch);
        assert_eq!(plan.ledge, "floor");
        assert!((plan.target_y - (work().bottom() - pet.height)).abs() < 0.01);
    }

    #[test]
    fn catch_falls_to_dock_inside_max_range() {
        let dock = PetRect {
            x: 420.0,
            y: 300.0,
            width: 880.0,
            height: 69.0,
        };
        let plan = plan_pet_drop(false, &pet_at(560.0, 150.0), &work(), &[], Some(&dock));
        assert_eq!(plan.kind, PetDropKind::Catch);
        assert_eq!(plan.ledge, "Dock");
        assert!((plan.target_y + 93.0 - 300.0).abs() < 0.01);
    }

    #[test]
    fn far_window_uses_shipped_hop() {
        let safari = PetRect {
            x: 500.0,
            y: 700.0,
            width: 360.0,
            height: 180.0,
        };
        let plan = plan_pet_drop(
            false,
            &pet_at(560.0, 150.0),
            &work(),
            &[("Safari", safari)],
            None,
        );
        assert_eq!(plan.kind, PetDropKind::Hop);
        assert_eq!(plan.distance, PET_DROP_HOP_PT);
        assert!((plan.target_y - 154.0).abs() < 0.01);
    }

    #[test]
    fn gravity_matches_quarter_g_free_fall() {
        assert_eq!(gravity_duration_ms(0.0), PET_DROP_MIN_MS);
        assert_eq!(gravity_duration_ms(4.0), 29);
        assert_eq!(gravity_duration_ms(160.0), 186);
    }

    #[test]
    fn fullscreen_window_does_not_catch_a_mid_screen_drop() {
        let chrome = PetRect {
            x: 0.0,
            y: 33.0,
            width: 1728.0,
            height: 1084.0,
        };
        let plan = plan_pet_drop(
            false,
            &pet_at(560.0, 240.0),
            &work(),
            &[("Google Chrome", chrome)],
            None,
        );
        assert_eq!(plan.kind, PetDropKind::Hop);
        assert_eq!(plan.distance, PET_DROP_HOP_PT);
        assert!((plan.target_y - 244.0).abs() < 0.01);
    }

    #[test]
    fn fully_occluded_window_is_ignored() {
        let front_a = PetRect {
            x: 400.0,
            y: 100.0,
            width: 500.0,
            height: 500.0,
        };
        let back_b = PetRect {
            x: 450.0,
            y: 300.0,
            width: 300.0,
            height: 300.0,
        };
        // Pet is at x=500, y=200 (feet=293). Back window B has ledge at y=300 (air=7pt),
        // but Front window A completely covers (x=500, y=300).
        let plan = plan_pet_drop(
            false,
            &pet_at(500.0, 200.0),
            &work(),
            &[("FrontA", front_a), ("BackB", back_b)],
            None,
        );
        // BackB should be ignored since it is completely occluded by FrontA.
        assert_ne!(plan.ledge, "BackB");
    }

    #[test]
    fn partially_exposed_ceiling_catches_pet() {
        let front_a = PetRect {
            x: 600.0,
            y: 100.0,
            width: 500.0,
            height: 500.0,
        };
        let back_b = PetRect {
            x: 400.0,
            y: 250.0,
            width: 500.0,
            height: 400.0,
        };
        // Back window B extends horizontally from 400 to 900.
        // Front window A covers from 600 to 1100.
        // Thus, Back window B is exposed and visible in range [400, 600].
        // Pet at x=420 (slab is [448, 536], completely in the exposed [400, 600] zone).
        let plan = plan_pet_drop(
            false,
            &pet_at(420.0, 100.0),
            &work(),
            &[("FrontA", front_a), ("BackB", back_b)],
            None,
        );
        assert_eq!(plan.kind, PetDropKind::Catch);
        assert_eq!(plan.ledge, "BackB");
        assert!((plan.target_y + 93.0 - 250.0).abs() < 0.01);
    }
}

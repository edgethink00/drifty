use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

#[derive(Clone, Copy)]
pub struct TrayProductivityMix {
    pub focus: f64,
    pub drift: f64,
    pub neutral: f64,
}

#[derive(Default)]
pub struct TrayProductivityState(Mutex<Option<TrayProductivityMix>>);

pub fn update_tray_productivity_mix(
    state: &State<'_, TrayProductivityState>,
    focus: f64,
    drift: f64,
    neutral: f64,
) -> Result<(), String> {
    let mut latest = state
        .0
        .lock()
        .map_err(|_| "tray productivity state lock poisoned".to_string())?;
    *latest = TrayProductivityMix::from_values(focus, drift, neutral);
    Ok(())
}

pub fn latest_tray_productivity_mix(app: &AppHandle) -> Option<TrayProductivityMix> {
    app.try_state::<TrayProductivityState>()
        .and_then(|state| state.0.lock().ok().and_then(|latest| *latest))
}

impl TrayProductivityMix {
    pub(crate) fn from_values(focus: f64, drift: f64, neutral: f64) -> Option<Self> {
        let focus = finite_non_negative(focus);
        let drift = finite_non_negative(drift);
        let neutral = finite_non_negative(neutral);
        let total = focus + drift + neutral;
        if total <= f64::EPSILON {
            return None;
        }

        Some(Self {
            focus: focus / total,
            drift: drift / total,
            neutral: neutral / total,
        })
    }
}

fn finite_non_negative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_productivity_mix_normalizes_valid_values() {
        let mix = TrayProductivityMix::from_values(30.0, 15.0, 15.0).expect("mix");

        assert_eq!(mix.focus, 0.5);
        assert_eq!(mix.drift, 0.25);
        assert_eq!(mix.neutral, 0.25);
    }

    #[test]
    fn tray_productivity_mix_rejects_empty_values() {
        assert!(TrayProductivityMix::from_values(0.0, f64::NAN, -1.0).is_none());
    }
}

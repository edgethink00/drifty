use core_foundation::{
    base::{CFType, TCFType},
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryRef},
    string::CFString,
};
use core_graphics::display::CGDisplay;
use std::time::{Duration, Instant, SystemTime};

const RESUME_DELAY: Duration = Duration::from_secs(5);
const MISSED_TICKS: Duration = Duration::from_secs(3);

#[derive(Default)]
pub(super) struct CaptureSession {
    previous: Option<(SystemTime, bool)>,
    resume_at: Option<Instant>,
}

impl CaptureSession {
    pub(super) fn allows_capture(&mut self) -> bool {
        self.observe(Instant::now(), SystemTime::now(), session_is_interactive())
    }

    fn observe(&mut self, now: Instant, wall: SystemTime, interactive: bool) -> bool {
        // A gap in the one-second poll also covers system sleep, during which
        // the capture process cannot observe the locked or sleeping state.
        if let Some((last_wall, was_interactive)) = self.previous.replace((wall, interactive)) {
            if interactive
                && (!was_interactive
                    || wall
                        .duration_since(last_wall)
                        .map_or(true, |gap| gap >= MISSED_TICKS))
            {
                self.resume_at = Some(now + RESUME_DELAY);
            }
        }
        interactive && self.resume_at.is_none_or(|at| now >= at)
    }
}

fn session_is_interactive() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }
    // The Copy rule transfers ownership. A missing session declines capture.
    let raw = unsafe { CGSessionCopyCurrentDictionary() };
    if raw.is_null() {
        return false;
    }
    let session = unsafe { CFDictionary::<CFString, CFType>::wrap_under_create_rule(raw) };
    let flag = |key: &str| {
        session
            .find(&CFString::new(key))
            .and_then(|value| value.downcast::<CFBoolean>())
            .is_some_and(bool::from)
    };
    flag("kCGSSessionOnConsoleKey")
        && !flag("CGSSessionScreenIsLocked")
        && !CGDisplay::main().is_asleep()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlock_and_sleep_gap_each_wait_five_seconds() {
        let mut session = CaptureSession::default();
        let now = Instant::now();
        let wall = SystemTime::now();
        for (offset, unlocked, expected) in [
            (0, true, true),
            (1, false, false),
            (2, true, false),
            (3, true, false),
            (5, true, false),
            (7, true, true),
            (30, true, false),
            (32, true, false),
            (34, true, false),
            (35, true, true),
        ] {
            let offset = Duration::from_secs(offset);
            assert_eq!(
                session.observe(now + offset, wall + offset, unlocked),
                expected
            );
        }
    }
}

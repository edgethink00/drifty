//! A local expiry clock, never an authority for account or provider requests.
//! Wall timestamps stay unchanged. An elapsed clock can only shorten retention.
use crate::Error;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, OnceLock};
use uuid::Uuid;

const LEGACY_CHECK: &[u8] = b"drifty-evidence-key-v1";

fn process_epoch() -> Uuid {
    static EPOCH: OnceLock<Uuid> = OnceLock::new();
    *EPOCH.get_or_init(Uuid::new_v4)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Stamp {
    version: u8,
    process: Uuid,
    wall_ms: i64,
    continuous_ns: u64,
    last_ns: u64,
}

/// Clones share the time anchor but grant no access to storage or content.
#[derive(Clone)]
pub(crate) struct RetentionClock {
    anchor: Arc<Mutex<Stamp>>,
    source: Arc<dyn Fn() -> Option<u64> + Send + Sync>,
}

impl RetentionClock {
    pub(crate) fn new(wall_ms: i64) -> Option<Self> {
        Self::with_source(wall_ms, Arc::new(continuous_nanos))
    }

    fn with_source(
        wall_ms: i64,
        source: Arc<dyn Fn() -> Option<u64> + Send + Sync>,
    ) -> Option<Self> {
        if wall_ms < 0 {
            return None;
        }
        let tick = source()?;
        Some(Self {
            anchor: Arc::new(Mutex::new(Stamp {
                version: 1,
                process: process_epoch(),
                wall_ms,
                continuous_ns: tick,
                last_ns: tick,
            })),
            source,
        })
    }

    pub(crate) fn now(&self, wall_ms: i64) -> Result<i64, Error> {
        self.sample(wall_ms, false)
    }

    pub(crate) fn advance(&self, wall_ms: i64) -> Result<i64, Error> {
        self.sample(wall_ms, true)
    }

    fn sample(&self, wall_ms: i64, advance: bool) -> Result<i64, Error> {
        if wall_ms < 0 {
            return Err(Error::ClockRollback);
        }
        let mut anchor = self.anchor.lock().map_err(|_| Error::ClockRollback)?;
        let tick = (self.source)().ok_or(Error::ClockRollback)?;
        if tick < anchor.last_ns {
            return Err(Error::ClockRollback);
        }
        anchor.last_ns = tick;
        let elapsed = tick
            .checked_sub(anchor.continuous_ns)
            .ok_or(Error::ClockRollback)?;
        let projected = anchor
            .wall_ms
            .checked_add(i64::try_from(elapsed / 1_000_000).map_err(|_| Error::ClockRollback)?)
            .ok_or(Error::ClockRollback)?;
        if advance && wall_ms > projected {
            // A forward correction may expire early; never undo that advance.
            anchor.wall_ms = wall_ms;
            anchor.continuous_ns = tick;
        }
        Ok(projected.max(wall_ms))
    }

    pub(crate) fn stamp(&self) -> Result<Vec<u8>, Error> {
        let anchor = self.anchor.lock().map_err(|_| Error::ClockRollback)?;
        serde_json::to_vec(&*anchor).map_err(|_| Error::Storage)
    }

    /// The control proof is already AEAD-authenticated by the store. A clock
    /// marker intentionally differs from the legacy key-check plaintext so an
    /// older reader refuses it rather than extending adjusted observations.
    pub(crate) fn decode(check: &[u8]) -> Result<Option<Stamp>, Error> {
        if check == LEGACY_CHECK {
            return Ok(None);
        }
        let stamp: Stamp = serde_json::from_slice(check).map_err(|_| Error::Authentication)?;
        if stamp.version != 1
            || stamp.process.is_nil()
            || stamp.wall_ms < 0
            || stamp.last_ns < stamp.continuous_ns
        {
            return Err(Error::Authentication);
        }
        Ok(Some(stamp))
    }

    pub(crate) fn restore(stamp: Stamp) -> Option<Self> {
        if stamp.process != process_epoch() || continuous_nanos()? < stamp.last_ns {
            return None;
        }
        Some(Self {
            anchor: Arc::new(Mutex::new(stamp)),
            source: Arc::new(continuous_nanos),
        })
    }

    #[cfg(test)]
    pub(crate) fn fixture(wall_ms: i64, tick: Arc<std::sync::atomic::AtomicU64>) -> Self {
        Self::with_source(
            wall_ms,
            Arc::new(move || Some(tick.load(std::sync::atomic::Ordering::SeqCst))),
        )
        .unwrap()
    }
}

// Unlike std::time::Instant on Darwin, this includes system sleep. Conversion
// uses integer Mach timebase units, not an assumption that ticks are ns.
#[cfg(target_os = "macos")]
fn continuous_nanos() -> Option<u64> {
    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }
    unsafe extern "C" {
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
    }
    static SCALE: OnceLock<Option<(u32, u32)>> = OnceLock::new();
    let (numer, denom) = (*SCALE.get_or_init(|| {
        let mut value = Timebase { numer: 0, denom: 0 };
        (unsafe { mach_timebase_info(&mut value) } == 0 && value.numer > 0 && value.denom > 0)
            .then_some((value.numer, value.denom))
    }))?;
    u64::try_from(
        u128::from(unsafe { mach_continuous_time() }) * u128::from(numer) / u128::from(denom),
    )
    .ok()
}

#[cfg(windows)]
fn continuous_nanos() -> Option<u64> {
    // Interrupt time includes sleep/hibernation, unlike unbiased interrupt time.
    let mut ticks = 0u64;
    unsafe {
        windows_sys::Win32::System::WindowsProgramming::QueryInterruptTimePrecise(&mut ticks)
    };
    ticks.checked_mul(100)
}

#[cfg(target_os = "linux")]
fn continuous_nanos() -> Option<u64> {
    let mut value: libc::timespec = unsafe { std::mem::zeroed() };
    if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut value) } != 0 {
        return None;
    }
    u64::try_from(value.tv_sec)
        .ok()?
        .checked_mul(1_000_000_000)?
        .checked_add(u64::try_from(value.tv_nsec).ok()?)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn continuous_nanos() -> Option<u64> {
    None
}

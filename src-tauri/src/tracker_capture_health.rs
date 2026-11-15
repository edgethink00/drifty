//! Observe capture progress independently of the renderer and SQLite.
//! A failed receipt never authorizes killing a live writer or deleting data.
use serde::Deserialize;
use std::{
    fs::File,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};

const STALE_AFTER: Duration = Duration::from_secs(90);
const CONFIRM_FAILURE: Duration = Duration::from_secs(10);
const REPORT_COOLDOWN: Duration = Duration::from_secs(3600);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    version: u8,
    pid: u32,
    run_id: String,
    sequence: u64,
    commits: u64,
    state: CaptureState,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CaptureState {
    Starting,
    Recording,
    Idle,
    Suppressed,
    Gap,
    Failed,
}

pub(crate) fn read_receipt(db: &Path) -> Option<Receipt> {
    let state = db.parent()?.join(".state");
    let pid: u32 = std::fs::read_to_string(state.join("tracker.pid"))
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let mut bytes = Vec::new();
    File::open(state.join("tracker.capture-health.json"))
        .ok()?
        .take(4097)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    let receipt: Receipt = serde_json::from_slice(&bytes).ok()?;
    if receipt.version != 1
        || receipt.pid != pid
        || pid == 0
        || receipt.sequence == 0
        || receipt.run_id.len() != 36
        || !receipt
            .run_id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() || c == b'-')
        || receipt.commits > receipt.sequence
    {
        return None;
    }
    Some(receipt)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Transition {
    Failed(&'static str),
    Recovered,
}

#[derive(Debug, Default)]
pub(crate) struct CaptureHealthMonitor {
    identity: Option<(u32, String)>,
    sequence: u64,
    progressed_at: Option<Instant>,
    unhealthy_since: Option<Instant>,
    last_report: Option<Instant>,
    reported_failure: bool,
}

impl CaptureHealthMonitor {
    pub(crate) fn reset_observation(&mut self) {
        self.identity = None;
        self.progressed_at = None;
        self.unhealthy_since = None;
        self.reported_failure = false;
    }

    pub(crate) fn observe(
        &mut self,
        receipt: Option<&Receipt>,
        now: Instant,
    ) -> Option<Transition> {
        if let Some(receipt) = receipt {
            let identity = (receipt.pid, receipt.run_id.clone());
            if self.identity.as_ref() != Some(&identity) || self.sequence != receipt.sequence {
                self.identity = Some(identity);
                self.sequence = receipt.sequence;
                self.progressed_at = Some(now);
            }
        }
        // An older sidecar has no receipt protocol. Do not infer failure from
        // its absence; once observed, a disappearing receipt does expire.
        let last_progress = self.progressed_at?;
        let reason = if now.saturating_duration_since(last_progress) >= STALE_AFTER {
            Some("stalled")
        } else {
            match receipt.map(|r| (r.state, r.commits)) {
                Some((CaptureState::Failed, _)) => Some("failed"),
                Some((CaptureState::Gap, _)) => Some("gap"),
                Some((CaptureState::Starting, _)) | Some((CaptureState::Recording, 0)) => {
                    Some("unconfirmed")
                }
                None => Some("unavailable"),
                _ => None,
            }
        };
        if let Some(reason) = reason {
            let since = *self.unhealthy_since.get_or_insert(now);
            if now.saturating_duration_since(since) >= CONFIRM_FAILURE
                && !self.reported_failure
                && self.last_report.map_or(true, |last| {
                    now.saturating_duration_since(last) >= REPORT_COOLDOWN
                })
            {
                self.last_report = Some(now);
                self.reported_failure = true;
                return Some(Transition::Failed(reason));
            }
            return None;
        }
        self.unhealthy_since = None;
        if std::mem::take(&mut self.reported_failure) {
            Some(Transition::Recovered)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn receipt(sequence: u64, state: CaptureState) -> Receipt {
        Receipt {
            version: 1,
            pid: 1,
            run_id: "a".repeat(36),
            sequence,
            commits: 1,
            state,
        }
    }
    #[test]
    fn alive_but_stalled_capture_is_reported_once_and_success_recovers() {
        let mut monitor = CaptureHealthMonitor::default();
        let now = Instant::now();
        let r = receipt(1, CaptureState::Recording);
        assert_eq!(monitor.observe(Some(&r), now), None);
        assert_eq!(monitor.observe(Some(&r), now + STALE_AFTER), None);
        assert_eq!(
            monitor.observe(Some(&r), now + STALE_AFTER + CONFIRM_FAILURE),
            Some(Transition::Failed("stalled"))
        );
        assert_eq!(
            monitor.observe(Some(&r), now + Duration::from_secs(120)),
            None
        );
        assert_eq!(
            monitor.observe(
                Some(&receipt(2, CaptureState::Recording)),
                now + Duration::from_secs(130)
            ),
            Some(Transition::Recovered)
        );
    }
    #[test]
    fn progress_without_success_is_not_healthy_and_repeats_are_limited() {
        let mut monitor = CaptureHealthMonitor::default();
        let now = Instant::now();
        assert_eq!(
            monitor.observe(Some(&receipt(1, CaptureState::Failed)), now),
            None
        );
        assert_eq!(
            monitor.observe(
                Some(&receipt(2, CaptureState::Failed)),
                now + CONFIRM_FAILURE
            ),
            Some(Transition::Failed("failed"))
        );
        assert_eq!(
            monitor.observe(
                Some(&receipt(3, CaptureState::Recording)),
                now + Duration::from_secs(20)
            ),
            Some(Transition::Recovered)
        );
        assert_eq!(
            monitor.observe(
                Some(&receipt(4, CaptureState::Failed)),
                now + Duration::from_secs(30)
            ),
            None
        );
        assert_eq!(
            monitor.observe(
                Some(&receipt(5, CaptureState::Failed)),
                now + Duration::from_secs(40)
            ),
            None
        );
    }
    #[test]
    fn idle_suppression_legacy_and_pause_are_not_failed_commits() {
        let mut monitor = CaptureHealthMonitor::default();
        let now = Instant::now();
        assert_eq!(monitor.observe(None, now), None);
        assert_eq!(monitor.observe(None, now + REPORT_COOLDOWN), None);
        for (i, state) in [CaptureState::Idle, CaptureState::Suppressed]
            .into_iter()
            .enumerate()
        {
            assert_eq!(
                monitor.observe(
                    Some(&receipt(i as u64 + 1, state)),
                    now + Duration::from_secs(i as u64 * 300)
                ),
                None
            );
        }
        monitor.reset_observation();
        assert_eq!(monitor.observe(None, now + REPORT_COOLDOWN), None);
    }
    #[test]
    fn rejects_wrong_pid_malformed_and_oversized_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join(".state");
        std::fs::create_dir(&state).unwrap();
        std::fs::write(state.join("tracker.pid"), "42").unwrap();
        let db = dir.path().join("tracker.sqlite3");
        let valid = r#"{"version":1,"pid":42,"runId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","sequence":2,"commits":1,"state":"recording"}"#;
        std::fs::write(state.join("tracker.capture-health.json"), valid).unwrap();
        assert!(read_receipt(&db).is_some());
        for invalid in [
            valid.replace("42", "43"),
            "{".into(),
            " ".repeat(4097),
            valid.replace("recording", "untrusted text"),
        ] {
            std::fs::write(state.join("tracker.capture-health.json"), invalid).unwrap();
            assert!(read_receipt(&db).is_none());
        }
    }
}

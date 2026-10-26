//! References from a trusted local tracker reader, never WebView authority.
//! Shape/equality checks cannot prove capture consent or row eligibility. The
//! native caller must resolve local, unredacted rows from its own tracker DB.
use crate::Error;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

pub const MAX_ACTIVITY_REFS: usize = 64;
pub(crate) const MAX_BIND_AGE_MS: i64 = 10_000;
const MAX_UNIX_MS: i64 = 253_402_300_799_999;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "IdentityWire")]
pub struct ActivityBinding {
    record_id: String,
    segment_uid: String,
    identity_digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdentityWire {
    record_id: String,
    segment_uid: String,
    identity_digest: String,
}
impl TryFrom<IdentityWire> for ActivityBinding {
    type Error = Error;
    fn try_from(v: IdentityWire) -> Result<Self, Error> {
        let id = v.record_id.parse::<i64>().ok();
        let uid = Uuid::parse_str(&v.segment_uid).ok();
        if id.is_none_or(|id| id <= 0 || id.to_string() != v.record_id)
            || uid.is_none_or(|uid| uid.is_nil() || uid.to_string() != v.segment_uid)
            || v.identity_digest.len() != 64
            || !v
                .identity_digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Invalid("local activity reference"));
        }
        Ok(Self {
            record_id: v.record_id,
            segment_uid: v.segment_uid,
            identity_digest: v.identity_digest,
        })
    }
}
impl ActivityBinding {
    pub fn record_id(&self) -> &str {
        &self.record_id
    }
    pub fn matches(&self, current: &LocalActivityRecordRef, observed_at_ms: i64) -> bool {
        *self == current.identity && current.contains(observed_at_ms)
    }
    pub(crate) fn for_capture(
        current: &LocalActivityRecordRef,
        observed_at_ms: i64,
    ) -> Option<Self> {
        current
            .contains(observed_at_ms)
            .then(|| current.identity.clone())
    }
}
impl std::fmt::Debug for ActivityBinding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ActivityBinding([redacted])")
    }
}
impl Drop for ActivityBinding {
    fn drop(&mut self) {
        self.record_id.zeroize();
        self.segment_uid.zeroize();
        self.identity_digest.zeroize();
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "RecordWire", into = "RecordWire")]
pub struct LocalActivityRecordRef {
    identity: ActivityBinding,
    started_at_ms: i64,
    ended_at_ms: i64,
    revoked_ranges: Vec<[i64; 2]>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordWire {
    record_id: String,
    segment_uid: String,
    identity_digest: String,
    started_at_ms: i64,
    ended_at_ms: i64,
    #[serde(default)]
    revoked_ranges: Vec<[i64; 2]>,
}
impl TryFrom<RecordWire> for LocalActivityRecordRef {
    type Error = Error;
    fn try_from(v: RecordWire) -> Result<Self, Error> {
        if v.started_at_ms < 0 || v.ended_at_ms > MAX_UNIX_MS || v.ended_at_ms <= v.started_at_ms {
            return Err(Error::Invalid("local activity range"));
        }
        if v.revoked_ranges.len() > 64
            || v.revoked_ranges
                .iter()
                .any(|r| r[0] < 0 || r[0] >= r[1] || r[1] > MAX_UNIX_MS)
            || v.revoked_ranges.windows(2).any(|r| r[0][1] >= r[1][0])
        {
            return Err(Error::Invalid("local activity point fence"));
        }
        Ok(Self {
            identity: ActivityBinding::try_from(IdentityWire {
                record_id: v.record_id,
                segment_uid: v.segment_uid,
                identity_digest: v.identity_digest,
            })?,
            started_at_ms: v.started_at_ms,
            ended_at_ms: v.ended_at_ms,
            revoked_ranges: v.revoked_ranges,
        })
    }
}
impl From<LocalActivityRecordRef> for RecordWire {
    fn from(v: LocalActivityRecordRef) -> Self {
        Self {
            record_id: v.identity.record_id.clone(),
            segment_uid: v.identity.segment_uid.clone(),
            identity_digest: v.identity.identity_digest.clone(),
            started_at_ms: v.started_at_ms,
            ended_at_ms: v.ended_at_ms,
            revoked_ranges: v.revoked_ranges,
        }
    }
}
impl LocalActivityRecordRef {
    pub fn record_id(&self) -> &str {
        self.identity.record_id()
    }
    pub fn contains(&self, observed_at_ms: i64) -> bool {
        self.started_at_ms <= observed_at_ms
            && observed_at_ms < self.ended_at_ms
            && !self
                .revoked_ranges
                .iter()
                .any(|r| r[0] <= observed_at_ms && observed_at_ms < r[1])
    }
}
impl std::fmt::Debug for LocalActivityRecordRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LocalActivityRecordRef([redacted])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value() -> serde_json::Value {
        serde_json::json!({"recordId":"9223372036854775807", "segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e",
            "identityDigest":"a".repeat(64),"startedAtMs":1000,"endedAtMs":2000})
    }
    #[test]
    fn reference_wire_rejects_noncanonical_identity_unknown_fields_and_empty_ranges() {
        let good = value();
        let cases = [
            ("recordId", serde_json::json!("0")),
            ("recordId", serde_json::json!("+1")),
            ("recordId", serde_json::json!("01")),
            ("recordId", serde_json::json!("9223372036854775808")),
            ("recordId", serde_json::json!(1)),
            ("segmentUid", serde_json::json!(Uuid::nil())),
            (
                "segmentUid",
                serde_json::json!("F26D8C10-CB09-4C98-A3E3-3744216AAB1E"),
            ),
            ("identityDigest", serde_json::json!("A".repeat(64))),
            ("identityDigest", serde_json::json!("a".repeat(65))),
            ("startedAtMs", serde_json::json!(-1)),
            ("startedAtMs", serde_json::json!(1000.5)),
            ("endedAtMs", serde_json::json!(1000)),
            ("endedAtMs", serde_json::json!(MAX_UNIX_MS + 1)),
            ("rawTitle", serde_json::json!("forbidden")),
        ];
        for (key, bad) in cases {
            let mut v = good.clone();
            v[key] = bad;
            assert!(
                serde_json::from_value::<LocalActivityRecordRef>(v).is_err(),
                "{key}"
            );
        }
        for key in [
            "recordId",
            "segmentUid",
            "identityDigest",
            "startedAtMs",
            "endedAtMs",
        ] {
            let mut v = good.clone();
            v.as_object_mut().unwrap().remove(key);
            assert!(serde_json::from_value::<LocalActivityRecordRef>(v).is_err());
        }
    }
    #[test]
    fn association_proof_uses_current_half_open_range_and_stable_identity() {
        let record: LocalActivityRecordRef = serde_json::from_value(value()).unwrap();
        assert!(ActivityBinding::for_capture(&record, 999).is_none());
        assert!(ActivityBinding::for_capture(&record, 2000).is_none());
        let proof = ActivityBinding::for_capture(&record, 1000).unwrap();
        assert!(proof.matches(&record, 1999));
        assert!(!proof.matches(&record, 2000));
        let mut wire = value();
        wire["endedAtMs"] = 3000.into();
        let growing = serde_json::from_value(wire.clone()).unwrap();
        assert!(proof.matches(&growing, 1000));
        wire["segmentUid"] = Uuid::new_v4().to_string().into();
        let reused = serde_json::from_value(wire).unwrap();
        assert!(!proof.matches(&reused, 1000));
        let proof_wire = serde_json::to_value(&proof).unwrap();
        assert_eq!(proof_wire.as_object().unwrap().len(), 3);
        assert!(!format!("{proof:?}{record:?}").contains(record.record_id()));
    }

    #[test]
    fn revoked_points_remain_invalid_after_range_regrowth_without_dropping_retained_points() {
        let record: LocalActivityRecordRef = serde_json::from_value(value()).unwrap();
        let proof = ActivityBinding::for_capture(&record, 1500).unwrap();
        let mut grown = value();
        grown["endedAtMs"] = 3000.into();
        grown["revokedRanges"] = serde_json::json!([[1500, 2000]]);
        let current: LocalActivityRecordRef = serde_json::from_value(grown).unwrap();
        assert!(current.contains(1499));
        assert!(!current.contains(1500));
        assert!(!proof.matches(&current, 1999));
        assert!(current.contains(2000));
        assert!(current.contains(2999));
        for ranges in [
            serde_json::json!([[-1, 2]]),
            serde_json::json!([[2, 2]]),
            serde_json::json!([[1.5, 2]]),
            serde_json::json!([[1, 2, 3]]),
            serde_json::json!([[1, 2], [2, 3]]),
            serde_json::json!([[3, 4], [1, 2]]),
            serde_json::json!(vec![[1, 2]; 65]),
        ] {
            let mut bad = value();
            bad["revokedRanges"] = ranges;
            assert!(serde_json::from_value::<LocalActivityRecordRef>(bad).is_err());
        }
    }
}

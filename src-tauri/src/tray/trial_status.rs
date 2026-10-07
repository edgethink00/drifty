use chrono::{DateTime, Utc};

use super::TrayLanguage;

/// Presentation only. This cache never grants or revokes billing access.
#[derive(Clone, Debug, Default)]
pub(super) enum TrialStatus {
    #[default]
    Hidden,
    Trial(DateTime<Utc>),
    Expired,
}

impl TrialStatus {
    pub(super) fn parse(ends_at: Option<&str>, expired: bool) -> Result<Self, String> {
        if expired {
            return Ok(Self::Expired);
        }
        match ends_at {
            Some(value) => DateTime::parse_from_rfc3339(value)
                .map(|date| Self::Trial(date.with_timezone(&Utc)))
                .map_err(|_| "Invalid trial end timestamp".to_string()),
            None => Ok(Self::Hidden),
        }
    }

    pub(super) fn label(&self, now: DateTime<Utc>, language: TrayLanguage) -> Option<String> {
        let ko = language.is_korean();
        match self {
            Self::Hidden => None,
            Self::Expired => Some(
                if ko {
                    "Pro 체험 종료 · 플랜 보기"
                } else {
                    "Pro trial ended · View plans"
                }
                .into(),
            ),
            Self::Trial(end) => {
                let remaining = (*end - now).num_milliseconds();
                // Wait for the billing authority to confirm expiry; a clock alone
                // must not label an offline user as locked.
                if remaining <= 0 || remaining > 3 * 86_400_000 {
                    return None;
                }
                let days = (remaining + 86_400_000 - 1) / 86_400_000;
                Some(if ko {
                    format!("Pro 체험 {days}일 남음")
                } else {
                    format!(
                        "Pro trial · {days} {} left",
                        if days == 1 { "day" } else { "days" }
                    )
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countdown_appears_only_in_final_three_days_and_expires_without_claiming_a_lock() {
        let now = DateTime::parse_from_rfc3339("2026-10-07T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        for (seconds, expected) in [
            (259201, None),
            (259200, Some("Pro 체험 3일 남음")),
            (172800, Some("Pro 체험 2일 남음")),
            (1, Some("Pro 체험 1일 남음")),
            (0, None),
            (-1, None),
        ] {
            let status = TrialStatus::Trial(now + chrono::Duration::seconds(seconds));
            assert_eq!(status.label(now, TrayLanguage::Korean).as_deref(), expected);
        }
        assert_eq!(
            TrialStatus::Expired
                .label(now, TrayLanguage::English)
                .as_deref(),
            Some("Pro trial ended · View plans")
        );
        assert!(TrialStatus::Hidden
            .label(now, TrayLanguage::Korean)
            .is_none());
        assert!(TrialStatus::parse(Some("invalid"), false).is_err());
    }
}

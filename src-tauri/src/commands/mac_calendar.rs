//! Read-only access to the calendars a person has added to macOS Calendar
//! (iCloud, Google, Exchange/Outlook and local calendars) through EventKit.
//!
//! Nothing here stores or sends events: the Week view asks for one bounded
//! range at a time and keeps the result in memory, the same boundary as the
//! Google Calendar connection. Access is requested only when the person turns
//! the setting on, so upgrading the app never shows a Calendar prompt.

use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDate, TimeZone, Utc};
use serde::Serialize;

const MAX_RANGE_DAYS: i64 = 31;
const MAX_EVENTS: usize = 500;
const MAX_ID_BYTES: usize = 512;
const MAX_TITLE_BYTES: usize = 4_096;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MacCalendarAuthorization {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    WriteOnly,
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacCalendarEvent {
    id: String,
    title: String,
    start: String,
    end: String,
    all_day: bool,
}

/// Raw values read from one EventKit event before they cross the Tauri boundary.
#[derive(Clone, Debug)]
struct RawEvent {
    id: String,
    title: String,
    start_unix: f64,
    end_unix: f64,
    all_day: bool,
    cancelled: bool,
    birthday_calendar: bool,
}

#[tauri::command]
pub fn mac_calendar_status() -> MacCalendarAuthorization {
    platform::authorization()
}

#[tauri::command]
pub async fn mac_calendar_request_access() -> MacCalendarAuthorization {
    tauri::async_runtime::spawn_blocking(platform::request_access)
        .await
        .unwrap_or(MacCalendarAuthorization::NotDetermined)
}

#[tauri::command]
pub async fn mac_calendar_events(
    start: String,
    end: String,
) -> Result<Vec<MacCalendarEvent>, String> {
    let (start, end) = parse_range(&start, &end)?;
    if platform::authorization() != MacCalendarAuthorization::Granted {
        return Err("Calendar access is not granted.".to_string());
    }
    let raw = tauri::async_runtime::spawn_blocking(move || platform::events(start, end))
        .await
        .map_err(|_| "Calendar events could not be read.".to_string())??;
    Ok(normalize_events(raw, &Local))
}

fn parse_range(start: &str, end: &str) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    let parse = |value: &str| {
        DateTime::parse_from_rfc3339(value)
            .map(|time| time.with_timezone(&Utc))
            .map_err(|_| "Calendar range must use RFC 3339 times.".to_string())
    };
    let start = parse(start)?;
    let end = parse(end)?;
    if end <= start {
        return Err("Calendar range end must be after its start.".to_string());
    }
    if end - start > ChronoDuration::days(MAX_RANGE_DAYS) {
        return Err(format!(
            "Calendar range must be {MAX_RANGE_DAYS} days or shorter."
        ));
    }
    Ok((start, end))
}

fn utc_from_unix(seconds: f64) -> Option<DateTime<Utc>> {
    if !seconds.is_finite() {
        return None;
    }
    let millis = (seconds * 1_000.0).round();
    if millis.abs() > 8.64e15 {
        return None;
    }
    DateTime::<Utc>::from_timestamp_millis(millis as i64)
}

fn truncate_to_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

/// All-day EventKit events run from local midnight to the last second (or the
/// next midnight) of their final day. The Week view expects the Google shape:
/// an inclusive start day and an exclusive end day.
fn all_day_bounds<Tz: TimeZone>(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    zone: &Tz,
) -> Option<(NaiveDate, NaiveDate)> {
    let first = start.with_timezone(zone).date_naive();
    let last_instant = if end > start {
        end - ChronoDuration::seconds(1)
    } else {
        start
    };
    let last = last_instant.with_timezone(zone).date_naive();
    let end_exclusive = last.succ_opt()?;
    (end_exclusive > first).then_some((first, end_exclusive))
}

fn normalize_events<Tz: TimeZone>(raw: Vec<RawEvent>, zone: &Tz) -> Vec<MacCalendarEvent> {
    let mut seen = std::collections::HashSet::new();
    let mut events = Vec::new();
    for event in raw {
        if events.len() >= MAX_EVENTS {
            break;
        }
        if event.cancelled || event.birthday_calendar {
            continue;
        }
        let title = event.title.trim();
        if event.id.is_empty() || event.id.len() > MAX_ID_BYTES || title.is_empty() {
            continue;
        }
        let (Some(start), Some(end)) = (
            utc_from_unix(event.start_unix),
            utc_from_unix(event.end_unix),
        ) else {
            continue;
        };
        let normalized = if event.all_day {
            let Some((first, end_exclusive)) = all_day_bounds(start, end, zone) else {
                continue;
            };
            MacCalendarEvent {
                id: String::new(),
                title: truncate_to_bytes(title, MAX_TITLE_BYTES),
                start: first.format("%Y-%m-%d").to_string(),
                end: end_exclusive.format("%Y-%m-%d").to_string(),
                all_day: true,
            }
        } else {
            if end <= start {
                continue;
            }
            MacCalendarEvent {
                id: String::new(),
                title: truncate_to_bytes(title, MAX_TITLE_BYTES),
                start: start.to_rfc3339(),
                end: end.to_rfc3339(),
                all_day: false,
            }
        };
        // A repeating event shares one identifier across occurrences; its
        // start keeps each occurrence distinct.
        let id = format!("mac:{}@{}", event.id, normalized.start);
        if !seen.insert(id.clone()) {
            continue;
        }
        events.push(MacCalendarEvent { id, ..normalized });
    }
    events
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{sync::mpsc, time::Duration};

    use block2::RcBlock;
    use chrono::{DateTime, Utc};
    use objc2::runtime::Bool;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendarType, EKEntityType, EKEventStatus, EKEventStore,
    };
    use objc2_foundation::{NSDate, NSError};

    use super::{MacCalendarAuthorization, RawEvent};

    /// The person may leave the macOS prompt open; stop waiting after this.
    const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

    pub(super) fn authorization() -> MacCalendarAuthorization {
        // SAFETY: a class method with no arguments besides the entity type.
        let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        from_status(status)
    }

    pub(super) fn from_status(status: EKAuthorizationStatus) -> MacCalendarAuthorization {
        match status {
            EKAuthorizationStatus::NotDetermined => MacCalendarAuthorization::NotDetermined,
            EKAuthorizationStatus::Restricted => MacCalendarAuthorization::Restricted,
            EKAuthorizationStatus::Denied => MacCalendarAuthorization::Denied,
            EKAuthorizationStatus::FullAccess => MacCalendarAuthorization::Granted,
            EKAuthorizationStatus::WriteOnly => MacCalendarAuthorization::WriteOnly,
            _ => MacCalendarAuthorization::Denied,
        }
    }

    pub(super) fn request_access() -> MacCalendarAuthorization {
        let current = authorization();
        if current != MacCalendarAuthorization::NotDetermined {
            return current;
        }
        // The store must outlive the request; it lives on this blocking thread
        // until the completion arrives or the wait times out.
        // SAFETY: creating an event store has no preconditions.
        let store = unsafe { EKEventStore::new() };
        let (sender, receiver) = mpsc::channel::<()>();
        let handler = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = sender.send(());
        });
        let handler_ptr = RcBlock::as_ptr(&handler);
        if objc2::available!(macos = 14.0) {
            // SAFETY: the block is retained by EventKit for the duration of the request.
            unsafe { store.requestFullAccessToEventsWithCompletion(handler_ptr) };
        } else {
            // SAFETY: as above; this is the pre-macOS 14 request.
            #[allow(deprecated)]
            unsafe {
                store.requestAccessToEntityType_completion(EKEntityType::Event, handler_ptr)
            };
        }
        let _ = receiver.recv_timeout(REQUEST_TIMEOUT);
        drop(store);
        authorization()
    }

    fn ns_date(time: DateTime<Utc>) -> objc2::rc::Retained<NSDate> {
        NSDate::dateWithTimeIntervalSince1970(time.timestamp_millis() as f64 / 1_000.0)
    }

    pub(super) fn events(
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<RawEvent>, String> {
        objc2::rc::autoreleasepool(|_| {
            // SAFETY: creating an event store has no preconditions; access was
            // checked by the caller and EventKit returns no events without it.
            let store = unsafe { EKEventStore::new() };
            let start = ns_date(start);
            let end = ns_date(end);
            // SAFETY: valid dates; None searches every event calendar.
            let predicate = unsafe {
                store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None)
            };
            // SAFETY: the predicate was created by this store.
            let found = unsafe { store.eventsMatchingPredicate(&predicate) };
            let mut raw = Vec::with_capacity(found.count().min(super::MAX_EVENTS * 2));
            for event in found.iter() {
                // SAFETY: read-only property getters on an event returned by EventKit.
                unsafe {
                    let id = event
                        .eventIdentifier()
                        .map(|id| id.to_string())
                        .unwrap_or_else(|| event.calendarItemIdentifier().to_string());
                    let birthday_calendar = event
                        .calendar()
                        .is_some_and(|calendar| calendar.r#type() == EKCalendarType::Birthday);
                    raw.push(RawEvent {
                        id,
                        title: event.title().to_string(),
                        start_unix: event.startDate().timeIntervalSince1970(),
                        end_unix: event.endDate().timeIntervalSince1970(),
                        all_day: event.isAllDay(),
                        cancelled: event.status() == EKEventStatus::Canceled,
                        birthday_calendar,
                    });
                }
            }
            Ok(raw)
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use chrono::{DateTime, Utc};

    use super::{MacCalendarAuthorization, RawEvent};

    pub(super) fn authorization() -> MacCalendarAuthorization {
        MacCalendarAuthorization::Unsupported
    }

    pub(super) fn request_access() -> MacCalendarAuthorization {
        MacCalendarAuthorization::Unsupported
    }

    pub(super) fn events(
        _start: DateTime<Utc>,
        _end: DateTime<Utc>,
    ) -> Result<Vec<RawEvent>, String> {
        Err("Mac Calendar is only available on macOS.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use chrono::FixedOffset;

    use super::*;

    fn raw(id: &str, title: &str, start: &str, end: &str, all_day: bool) -> RawEvent {
        let unix = |value: &str| DateTime::parse_from_rfc3339(value).unwrap().timestamp() as f64;
        RawEvent {
            id: id.to_string(),
            title: title.to_string(),
            start_unix: unix(start),
            end_unix: unix(end),
            all_day,
            cancelled: false,
            birthday_calendar: false,
        }
    }

    #[test]
    fn rejects_reversed_and_oversized_ranges() {
        assert!(parse_range("2026-11-24T00:00:00Z", "2026-11-23T00:00:00Z").is_err());
        assert!(parse_range("2026-11-01T00:00:00Z", "2026-12-03T00:00:00Z").is_err());
        assert!(parse_range("not a time", "2026-12-03T00:00:00Z").is_err());
        assert!(parse_range("2026-11-24T00:00:00+09:00", "2026-12-01T00:00:00+09:00").is_ok());
    }

    #[test]
    fn keeps_timed_events_as_utc_instants_and_separates_occurrences() {
        let seoul = FixedOffset::east_opt(9 * 3600).unwrap();
        let events = normalize_events(
            vec![
                raw(
                    "standup",
                    "Standup",
                    "2026-11-24T10:00:00+09:00",
                    "2026-11-24T10:15:00+09:00",
                    false,
                ),
                raw(
                    "standup",
                    "Standup",
                    "2026-11-25T10:00:00+09:00",
                    "2026-11-25T10:15:00+09:00",
                    false,
                ),
            ],
            &seoul,
        );
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].start, "2026-11-24T01:00:00+00:00");
        assert_eq!(events[0].end, "2026-11-24T01:15:00+00:00");
        assert_ne!(events[0].id, events[1].id);
        assert!(!events[0].all_day);
    }

    #[test]
    fn converts_all_day_events_to_inclusive_start_and_exclusive_end_days() {
        let seoul = FixedOffset::east_opt(9 * 3600).unwrap();
        // EventKit ends a one-day event at 23:59:59 of that day.
        let one_day = raw(
            "trip",
            "Trip",
            "2026-11-24T00:00:00+09:00",
            "2026-11-24T23:59:59+09:00",
            true,
        );
        // Some sources end it at the next midnight instead.
        let two_days = raw(
            "offsite",
            "Offsite",
            "2026-11-25T00:00:00+09:00",
            "2026-11-27T00:00:00+09:00",
            true,
        );
        let events = normalize_events(vec![one_day, two_days], &seoul);
        assert_eq!(
            (events[0].start.as_str(), events[0].end.as_str()),
            ("2026-11-24", "2026-11-25")
        );
        assert_eq!(
            (events[1].start.as_str(), events[1].end.as_str()),
            ("2026-11-25", "2026-11-27")
        );
        assert!(events.iter().all(|event| event.all_day));
    }

    #[test]
    fn drops_cancelled_birthday_untitled_and_reversed_events() {
        let utc = Utc;
        let mut cancelled = raw(
            "a",
            "Cancelled",
            "2026-11-24T01:00:00Z",
            "2026-11-24T02:00:00Z",
            false,
        );
        cancelled.cancelled = true;
        let mut birthday = raw(
            "b",
            "Sam's birthday",
            "2026-11-24T00:00:00Z",
            "2026-11-24T23:59:59Z",
            true,
        );
        birthday.birthday_calendar = true;
        let untitled = raw(
            "c",
            "   ",
            "2026-11-24T01:00:00Z",
            "2026-11-24T02:00:00Z",
            false,
        );
        let reversed = raw(
            "d",
            "Reversed",
            "2026-11-24T02:00:00Z",
            "2026-11-24T01:00:00Z",
            false,
        );
        let kept = raw(
            "e",
            "Review",
            "2026-11-24T03:00:00Z",
            "2026-11-24T04:00:00Z",
            false,
        );
        let events = normalize_events(vec![cancelled, birthday, untitled, reversed, kept], &utc);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].title, "Review");
    }

    #[test]
    fn bounds_titles_and_event_count() {
        let utc = Utc;
        let long_title = "가".repeat(MAX_TITLE_BYTES);
        let mut many = vec![raw(
            "long",
            &long_title,
            "2026-11-24T01:00:00Z",
            "2026-11-24T02:00:00Z",
            false,
        )];
        for index in 0..(MAX_EVENTS + 20) {
            let start = format!(
                "2026-11-24T{:02}:{:02}:00Z",
                2 + index / 60 % 20,
                index % 60
            );
            let end = format!(
                "2026-11-24T{:02}:{:02}:30Z",
                2 + index / 60 % 20,
                index % 60
            );
            many.push(raw(&format!("e{index}"), "Block", &start, &end, false));
        }
        let events = normalize_events(many, &utc);
        assert_eq!(events.len(), MAX_EVENTS);
        assert!(events[0].title.len() <= MAX_TITLE_BYTES);
        assert!(events[0].title.chars().all(|character| character == '가'));
    }
}

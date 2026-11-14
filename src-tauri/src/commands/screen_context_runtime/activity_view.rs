//! Account-authorized view filters only. IDs/time windows never supply a native
//! binding; the core resolves every current local reference independently.
use super::*;
use drifty_screen_context_core::TextState;

pub(super) fn validate(ids: &[String], windows: &[[i64; 2]]) -> Result<(), String> {
    if ids.is_empty()
        || ids.len() > 64
        || windows.is_empty()
        || windows.len() > 64
        || ids.iter().any(|id| {
            id.parse::<i64>()
                .ok()
                .is_none_or(|value| value <= 0 || value.to_string() != *id)
        })
        || ids.iter().collect::<std::collections::BTreeSet<_>>().len() != ids.len()
        || windows
            .iter()
            .any(|r| r[0] < 0 || r[0] >= r[1] || r[1] > 253_402_300_799_999)
        || windows.windows(2).any(|r| r[0][1] >= r[1][0])
        || windows.last().unwrap()[1] - windows.first().unwrap()[0] > 36 * 60 * 60 * 1000
    {
        return Err("screen_context_invalid_range".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn screen_context_list_activity_evidence(
    app: AppHandle,
    lease_id: AccountLeaseId,
    record_ids: Vec<String>,
    windows: Vec<[i64; 2]>,
    cursor: Option<PageCursor>,
) -> Result<tauri::ipc::Response, String> {
    validate(&record_ids, &windows)?;
    tauri::async_runtime::spawn_blocking(move || {
        let reply = authorized(&app, lease_id, |runtime, lease| {
            runtime.refresh_exclusions(&app)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                let service = runtime.service(&app, lease)?;
                if state.opened {
                    let page = service
                        .list_replay_evidence_in_windows(&record_ids, cursor, 20, &windows)
                        .map_err(error_code)?;
                    runtime.watch_page(lease_id, &page)?;
                    Ok(ReviewReply::Current(page))
                } else {
                    Ok(ReviewReply::Empty(
                        service
                            .observation_lease()
                            .reply(EvidencePage {
                                records: Vec::new(),
                                next_cursor: None,
                            })
                            .map_err(error_code)?,
                    ))
                }
            })
        })?;
        sensitive_response(reply)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

/// One activity whose saved screens may inform its classification.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityTextRequest {
    pub(super) record_ids: Vec<String>,
    pub(super) windows: Vec<[i64; 2]>,
}
/// One classification batch.
const MAX_TEXT_ACTIVITIES: usize = 20;

#[derive(Serialize)]
#[serde(untagged)]
enum ActivityTextReply {
    Current(Vec<Option<ActivityReadReply<Option<String>>>>),
    Empty(ObservationReply<Vec<Option<String>>>),
}

/// The latest recognized text of each activity's own saved screens, with common
/// credential shapes removed, for activity classification (owner decision
/// 2026-11-12). Images never leave this command. Nothing here is displayed, so
/// no visibility watch replaces the viewer's. An activity without readable
/// text, or one that changed meanwhile, answers null.
#[tauri::command]
pub async fn screen_context_activity_text(
    app: AppHandle,
    lease_id: AccountLeaseId,
    activities: Vec<ActivityTextRequest>,
) -> Result<tauri::ipc::Response, String> {
    validate_text_requests(&activities)?;
    tauri::async_runtime::spawn_blocking(move || {
        let reply = authorized(&app, lease_id, |runtime, lease| {
            runtime.refresh_exclusions(&app)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                let service = runtime.service(&app, lease)?;
                if !state.opened || !state.preferences.enabled || service.status().paused || globally_paused(&app) {
                    return Ok(ActivityTextReply::Empty(
                        service
                            .observation_lease()
                            .reply(vec![None; activities.len()])
                            .map_err(error_code)?,
                    ));
                }
                let mut texts = Vec::with_capacity(activities.len());
                for activity in &activities {
                    match activity_text(&service, activity) {
                        Ok(text) => texts.push(text),
                        Err(Error::Invalidated) => texts.push(None),
                        Err(error) => return Err(error_code(error)),
                    }
                }
                Ok(ActivityTextReply::Current(texts))
            })
        })?;
        sensitive_response(reply)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

fn validate_text_requests(activities: &[ActivityTextRequest]) -> Result<(), String> {
    if activities.is_empty() || activities.len() > MAX_TEXT_ACTIVITIES {
        return Err("screen_context_invalid_range".into());
    }
    activities
        .iter()
        .try_for_each(|activity| validate(&activity.record_ids, &activity.windows))
}

pub(super) fn activity_text(
    service: &ScreenContextService,
    activity: &ActivityTextRequest,
) -> Result<Option<ActivityReadReply<Option<String>>>, Error> {
    let mut latest = None;
    service
        .list_replay_evidence_in_windows(&activity.record_ids, None, 20, &activity.windows)?
        .try_map(|page| {
            latest = page
                .records
                .iter()
                .rev()
                .find(|row| row.text_state == TextState::Recognized)
                .map(|row| row.id);
            Ok(())
        })?;
    let Some(id) = latest else {
        return Ok(None);
    };
    service
        .read_replay_evidence_in_windows(id, false, &activity.record_ids, &activity.windows)?
        .try_map(|evidence| {
            Ok(evidence
                .filter(|value| value.metadata.text.state() == TextState::Recognized)
                .map(|value| super::memory::redact_screen_text(value.metadata.text.as_str()))
                .filter(|text| !text.trim().is_empty()))
        })
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activity_text_takes_one_bounded_batch_of_valid_view_filters() {
        let one = || ActivityTextRequest {
            record_ids: vec!["1".into()],
            windows: vec![[1, 2]],
        };
        assert!(validate_text_requests(&[one()]).is_ok());
        assert!(validate_text_requests(
            &(0..MAX_TEXT_ACTIVITIES).map(|_| one()).collect::<Vec<_>>()
        )
        .is_ok());
        assert!(validate_text_requests(&[]).is_err());
        assert!(validate_text_requests(
            &(0..=MAX_TEXT_ACTIVITIES).map(|_| one()).collect::<Vec<_>>()
        )
        .is_err());
        let remote = ActivityTextRequest {
            record_ids: vec!["sync:1".into()],
            windows: vec![[1, 2]],
        };
        assert!(validate_text_requests(&[one(), remote]).is_err());
        assert!(serde_json::from_value::<ActivityTextRequest>(
            serde_json::json!({"recordIds": ["1"], "windows": [[1, 2]], "text": "x"})
        )
        .is_err());
    }
    #[test]
    fn view_filters_are_canonical_bounded_disjoint_half_open_and_never_accept_remote_ids() {
        assert!(validate(
            &["1".into(), "9223372036854775807".into()],
            &[[1, 2], [3, 4]]
        )
        .is_ok());
        for ids in [
            vec![],
            vec!["01".into()],
            vec!["0".into()],
            vec!["-1".into()],
            vec!["sync:1".into()],
            vec!["1".into(), "1".into()],
            vec!["1".into(); 65],
        ] {
            assert!(validate(&ids, &[[1, 2]]).is_err());
        }
        for windows in [
            vec![],
            vec![[0, 0]],
            vec![[-1, 2]],
            vec![[1, 3], [2, 4]],
            vec![[1, 2], [2, 3]],
            vec![[1, 2], [3, 130_000_000]],
            vec![[1, 253_402_300_800_000]],
        ] {
            assert!(validate(&["1".into()], &windows).is_err());
        }
    }
}

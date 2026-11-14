//! Dev input pilot: own activity windows, at most three images per request.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityInputRequest {
    record_ids: Vec<String>,
    windows: Vec<[i64; 2]>,
    #[serde(default)]
    image_limit: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScreenImage {
    pub(super) media_type: &'static str,
    pub(super) data: String,
    pub(super) observed_at_ms: i64,
}

pub(super) fn image(evidence: &drifty_screen_context_core::ReviewEvidence) -> Option<ScreenImage> {
    let frame = evidence.frame.as_ref()?;
    Some(ScreenImage { media_type: "image/png", data: STANDARD.encode(frame.bytes()),
        observed_at_ms: evidence.metadata.observed_at_ms })
}

#[derive(Serialize)]
struct ActivityInput {
    text: Option<ActivityReadReply<Option<String>>>,
    images: Vec<ActivityReadReply<Option<ScreenImage>>>,
}
#[derive(Serialize)]
#[serde(untagged)]
enum InputReply {
    Current(Vec<ActivityInput>),
    Empty(ObservationReply<Vec<Option<String>>>),
}
fn validate(requests: &[ActivityInputRequest]) -> Result<(), String> {
    if requests.is_empty() || requests.len() > 20
        || requests.iter().any(|r| r.image_limit > 3)
        || requests.iter().map(|r| r.image_limit).sum::<usize>() > 3 {
        return Err("screen_context_invalid_range".into());
    }
    for r in requests { super::activity_view::validate(&r.record_ids, &r.windows)?; }
    Ok(())
}

#[tauri::command]
pub async fn screen_context_activity_input(
    app: AppHandle, lease_id: AccountLeaseId, activities: Vec<ActivityInputRequest>,
) -> Result<tauri::ipc::Response, String> {
    validate(&activities)?;
    tauri::async_runtime::spawn_blocking(move || {
        let reply = authorized(&app, lease_id, |runtime, lease| {
            runtime.refresh_exclusions(&app)?;
            runtime.with_state(lease, |state| {
                runtime.ensure_store(&app, state, lease, false)?;
                let service = runtime.service(&app, lease)?;
                if !state.opened || !state.preferences.enabled || service.status().paused || globally_paused(&app) {
                    return Ok(InputReply::Empty(service.observation_lease()
                        .reply(vec![None; activities.len()]).map_err(error_code)?));
                }
                let mut values = Vec::new();
                for r in activities {
                    let request = super::activity_view::ActivityTextRequest {
                        record_ids: r.record_ids.clone(), windows: r.windows.clone(),
                    };
                    let text = super::activity_view::activity_text(&service, &request).map_err(error_code)?;
                    let mut images = Vec::new();
                    if r.image_limit > 0 {
                        for original in service.representative_replay_images(&r.record_ids, &r.windows, r.image_limit).map_err(error_code)? {
                            images.push(original.try_map(|e| Ok(e.as_ref().and_then(image))).map_err(error_code)?);
                        }
                    }
                    values.push(ActivityInput { text, images });
                }
                Ok(InputReply::Current(values))
            })
        })?;
        sensitive_response(reply)
    }).await.map_err(|_| UNAVAILABLE.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn one(limit: usize) -> ActivityInputRequest {
        ActivityInputRequest { record_ids: vec!["1".into()], windows: vec![[1, 1000]], image_limit: limit }
    }
    #[test]
    fn global_budget_and_local_filters_are_enforced() {
        assert!(validate(&[one(3)]).is_ok());
        assert!(validate(&[one(1), one(1), one(1)]).is_ok());
        assert!(validate(&[one(3), one(1)]).is_err());
        assert!(validate(&[one(4)]).is_err());
        assert!(validate(&[]).is_err());
        assert!(serde_json::from_value::<ActivityInputRequest>(serde_json::json!({"recordIds":["1"],"windows":[[1,2]],"path":"/tmp/x"})).is_err());
        let mut remote = one(1); remote.record_ids = vec!["sync:1".into()];
        assert!(validate(&[remote]).is_err());
    }
}

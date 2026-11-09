//! Account-authorized view filters only. IDs/time windows never supply a native
//! binding; the core resolves every current local reference independently.
use super::*;

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

#[cfg(test)]
mod tests {
    use super::*;
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

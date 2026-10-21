// WebView2's ERROR_ACCESS_DISABLED_BY_POLICY is independent of the localized
// Windows message. Match its complete HRESULT token, only on WebView errors.
pub(super) fn is_policy_blocked(runtime_error: &str) -> bool {
    let error = runtime_error.to_ascii_lowercase();
    error.starts_with("failed to create webview: webview2 error:")
        && error.contains("hresult(0x800704ec)")
}

pub(super) fn message(korean: bool, policy_blocked: bool) -> &'static str {
    match (korean, policy_blocked) {
        (true, true) => "Windows 보안 정책이 Drifty 화면을 표시하는 Microsoft Edge WebView2의 실행을 차단했습니다.\n\n이 기기의 관리자에게 Drifty와 Microsoft Edge WebView2의 실행 정책을 확인해 달라고 요청해 주세요. 오류 코드: 0x800704EC\n\n활동 기록은 계속 실행 중일 수 있습니다. Drifty를 종료하면 활동 기록도 멈춥니다.",
        (false, true) => "Windows security policy blocked Microsoft Edge WebView2, which Drifty uses to display its window.\n\nAsk this device's administrator to review the execution policies for Drifty and Microsoft Edge WebView2. Error code: 0x800704EC\n\nActivity tracking may still be running. Quitting Drifty also stops tracking.",
        (true, false) => "Drifty 화면을 열지 못했습니다.\n\n활동 기록은 계속 실행 중일 수 있습니다. Windows 알림 영역의 Drifty 메뉴에서 'Drifty 종료'를 선택한 다음 Drifty를 다시 열어 주세요.\n\nDrifty가 종료되어 있는 동안에는 활동 기록이 멈춥니다.",
        (false, false) => "Drifty couldn't open its window.\n\nActivity tracking may still be running. To try again, choose 'Quit' from the Drifty tray menu, then open Drifty again.\n\nTracking stops while Drifty is closed.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_policy_hresult_without_relying_on_windows_language() {
        for reason in [
            "This program is blocked by group policy.",
            "그룹 정책에 의해 차단되었습니다.",
        ] {
            let error = format!("failed to create webview: WebView2 error: WindowsError(Error {{ code: HRESULT(0x800704EC), message: {reason:?} }})");
            assert!(is_policy_blocked(&error));
            assert!(is_policy_blocked(&error.to_ascii_lowercase()));
        }
    }

    #[test]
    fn preserves_general_guidance_for_other_or_unidentified_failures() {
        for error in [
            "failed to create webview: WebView2 error: HRESULT(0x8007139F)",
            "failed to create webview: WebView2 error: HRESULT(0x800700AA)",
            "failed to create webview: WebView2 error: HRESULT(0x80070005)",
            "failed to create webview: WebView2 error: HRESULT(0x800704EC0)",
            "failed to create webview: WebView2 error: This program is blocked by group policy.",
            "unrelated error: HRESULT(0x800704EC)",
            "Could not find the webview runtime, make sure it is installed",
        ] {
            assert!(!is_policy_blocked(error), "{error}");
        }
    }

    #[test]
    fn policy_guidance_directs_to_administrator_and_keeps_tracking_caveat() {
        let english = message(false, true);
        assert!(english.contains("administrator"));
        assert!(english.contains("0x800704EC"));
        assert!(english.contains("may still be running"));
        assert!(!english.contains("then open Drifty again"));
        let korean = message(true, true);
        assert!(korean.contains("관리자"));
        assert!(korean.contains("0x800704EC"));
        assert!(korean.contains("계속 실행 중일 수 있습니다"));
        assert!(!korean.contains("다시 열어 주세요"));
        assert!(message(false, false).contains("then open Drifty again"));
        assert!(message(true, false).contains("다시 열어 주세요"));
    }
}

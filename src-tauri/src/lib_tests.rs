use super::*;

#[test]
fn auth_deep_link_filter_accepts_drifty_callbacks() {
    assert!(is_auth_callback_deep_link(
        "drifty://auth/callback?code=startup-code"
    ));
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/callback#access_token=access&refresh_token=refresh"
    ));
    assert!(is_auth_callback_deep_link(
        "drifty://auth/google-callback?code=google-code"
    ));
    assert!(!is_auth_callback_deep_link(
        "drifty://auth/not-callback?code=ignored"
    ));
}

#[test]
fn billing_deep_link_filter_accepts_only_drifty_success_links() {
    assert!(is_billing_success_deep_link("drifty://billing/success"));
    assert!(is_billing_success_deep_link(
        "drifty://billing/success?checkout_id=checkout-1"
    ));
    assert!(!is_billing_success_deep_link("other://billing/success"));
    assert!(!is_billing_success_deep_link("drifty://billing/cancel"));
}

#[test]
fn main_window_close_policy_only_handles_main_label() {
    assert!(should_hide_instead_of_close("main"));
    assert!(!should_hide_instead_of_close("watcher-peek"));
    assert!(!should_hide_instead_of_close("settings"));
}

#[test]
fn macos_reopen_policy_reveals_only_without_visible_windows() {
    assert!(should_reveal_main_window_on_reopen(false));
    assert!(!should_reveal_main_window_on_reopen(true));
}

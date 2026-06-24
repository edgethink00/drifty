use serde::Serialize;
use thiserror::Error;

const BACKEND_SM_APP_SERVICE: &str = "smAppService";
#[cfg(not(target_os = "macos"))]
const BACKEND_UNSUPPORTED: &str = "unsupported";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupOpenAtLoginStatus {
    Enabled,
    NotRegistered,
    RequiresApproval,
    NotFound,
    #[cfg(not(target_os = "macos"))]
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupOpenAtLoginResponse {
    success: bool,
    enabled: bool,
    status: StartupOpenAtLoginStatus,
    backend: &'static str,
}

#[derive(Debug, Error)]
enum StartupOpenAtLoginError {
    #[error("SMAppService {operation} failed: {message} (code {code})")]
    ServiceManagement {
        operation: &'static str,
        message: String,
        code: u32,
    },
}

#[tauri::command]
pub fn startup_get_open_at_login_status() -> Result<StartupOpenAtLoginResponse, String> {
    Ok(current_open_at_login_response())
}

#[tauri::command]
pub fn startup_set_open_at_login_enabled(
    enabled: bool,
) -> Result<StartupOpenAtLoginResponse, String> {
    set_open_at_login_enabled(enabled).map_err(|err| err.to_string())
}

#[cfg(target_os = "macos")]
fn current_open_at_login_response() -> StartupOpenAtLoginResponse {
    let service = startup_service();
    sm_app_service_response(service.status())
}

#[cfg(not(target_os = "macos"))]
fn current_open_at_login_response() -> StartupOpenAtLoginResponse {
    unsupported_response()
}

#[cfg(target_os = "macos")]
fn set_open_at_login_enabled(
    enabled: bool,
) -> Result<StartupOpenAtLoginResponse, StartupOpenAtLoginError> {
    use smappservice_rs::{ServiceManagementError, ServiceStatus};

    let service = startup_service();
    let current_status = service.status();

    if enabled {
        match current_status {
            ServiceStatus::Enabled | ServiceStatus::RequiresApproval => {}
            ServiceStatus::NotRegistered | ServiceStatus::NotFound => {
                if let Err(error) = service.register() {
                    if error != ServiceManagementError::AlreadyRegistered {
                        return Err(service_management_error("register", error));
                    }
                }
            }
        }
    } else {
        match current_status {
            ServiceStatus::Enabled | ServiceStatus::RequiresApproval => {
                if let Err(error) = service.unregister() {
                    if error != ServiceManagementError::JobNotFound {
                        return Err(service_management_error("unregister", error));
                    }
                }
            }
            ServiceStatus::NotRegistered | ServiceStatus::NotFound => {}
        }
    }

    Ok(sm_app_service_response(service.status()))
}

#[cfg(not(target_os = "macos"))]
fn set_open_at_login_enabled(
    _enabled: bool,
) -> Result<StartupOpenAtLoginResponse, StartupOpenAtLoginError> {
    Ok(unsupported_response())
}

#[cfg(target_os = "macos")]
fn startup_service() -> smappservice_rs::AppService {
    smappservice_rs::AppService::new(smappservice_rs::ServiceType::MainApp)
}

#[cfg(target_os = "macos")]
fn sm_app_service_response(status: smappservice_rs::ServiceStatus) -> StartupOpenAtLoginResponse {
    let status = startup_status_from_service_status(status);
    StartupOpenAtLoginResponse {
        success: true,
        enabled: status == StartupOpenAtLoginStatus::Enabled,
        status,
        backend: BACKEND_SM_APP_SERVICE,
    }
}

#[cfg(target_os = "macos")]
fn startup_status_from_service_status(
    status: smappservice_rs::ServiceStatus,
) -> StartupOpenAtLoginStatus {
    match status {
        smappservice_rs::ServiceStatus::Enabled => StartupOpenAtLoginStatus::Enabled,
        smappservice_rs::ServiceStatus::NotRegistered => StartupOpenAtLoginStatus::NotRegistered,
        smappservice_rs::ServiceStatus::RequiresApproval => {
            StartupOpenAtLoginStatus::RequiresApproval
        }
        smappservice_rs::ServiceStatus::NotFound => StartupOpenAtLoginStatus::NotFound,
    }
}

#[cfg(target_os = "macos")]
fn service_management_error(
    operation: &'static str,
    error: smappservice_rs::ServiceManagementError,
) -> StartupOpenAtLoginError {
    StartupOpenAtLoginError::ServiceManagement {
        operation,
        code: error.code(),
        message: error.to_string(),
    }
}

#[cfg(not(target_os = "macos"))]
fn unsupported_response() -> StartupOpenAtLoginResponse {
    StartupOpenAtLoginResponse {
        success: false,
        enabled: false,
        status: StartupOpenAtLoginStatus::Unsupported,
        backend: BACKEND_UNSUPPORTED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn startup_status_from_service_status_maps_smappservice_statuses() {
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::Enabled),
            StartupOpenAtLoginStatus::Enabled
        );
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::NotRegistered),
            StartupOpenAtLoginStatus::NotRegistered
        );
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::RequiresApproval),
            StartupOpenAtLoginStatus::RequiresApproval
        );
        assert_eq!(
            startup_status_from_service_status(smappservice_rs::ServiceStatus::NotFound),
            StartupOpenAtLoginStatus::NotFound
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_response_is_not_successful() {
        assert_eq!(
            unsupported_response(),
            StartupOpenAtLoginResponse {
                success: false,
                enabled: false,
                status: StartupOpenAtLoginStatus::Unsupported,
                backend: BACKEND_UNSUPPORTED,
            }
        );
    }
}

//! The file-based macOS keychain ignores per-query authentication UI flags.
//! Its UI switch is process-wide: every native credential operation must use
//! this same lock, including the app and the memory key provider.
use std::sync::Mutex;

static CREDENTIAL_IO: Mutex<()> = Mutex::new(());

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainGetUserInteractionAllowed(state: *mut u8) -> i32;
    fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
}

struct RestoreInteraction(u8);
impl Drop for RestoreInteraction {
    fn drop(&mut self) {
        unsafe {
            SecKeychainSetUserInteractionAllowed(self.0);
        }
    }
}

/// Synchronous OS credential I/O only; never hold across network work or await.
pub fn run<T>(allow: bool, operation: impl FnOnce() -> T) -> Result<T, i32> {
    let _lock = CREDENTIAL_IO.lock().map_err(|_| -2070)?;
    let mut previous = 0;
    let status = unsafe { SecKeychainGetUserInteractionAllowed(&mut previous) };
    if status != 0 {
        return Err(status);
    }
    let status = unsafe { SecKeychainSetUserInteractionAllowed(u8::from(allow)) };
    if status != 0 {
        return Err(status);
    }
    let _restore = RestoreInteraction(previous);
    Ok(operation())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn allowed() -> bool {
        let mut value = 0;
        assert_eq!(
            unsafe { SecKeychainGetUserInteractionAllowed(&mut value) },
            0
        );
        value != 0
    }

    #[test]
    fn background_io_excludes_interactive_io_and_restores_the_previous_state() {
        let previous = allowed();
        let (started, ready) = mpsc::channel();
        let (completed, result) = mpsc::channel();
        let worker = run(false, || {
            assert!(!allowed());
            let worker = std::thread::spawn(move || {
                started.send(()).unwrap();
                run(true, || completed.send(allowed()).unwrap()).unwrap();
            });
            ready.recv().unwrap();
            assert!(matches!(result.try_recv(), Err(mpsc::TryRecvError::Empty)));
            assert!(!allowed());
            worker
        })
        .unwrap();
        worker.join().unwrap();
        assert!(result.recv().unwrap());
        assert_eq!(allowed(), previous);
    }
}

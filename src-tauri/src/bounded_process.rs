//! Collect a short-lived helper's output without blocking on a full pipe or
//! on pipe handles inherited by a descendant after the helper exits.
use std::{
    io::{self, Read},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

#[cfg(unix)]
trait Pipe: Read + AsRawFd {}
#[cfg(unix)]
impl<T: Read + AsRawFd> Pipe for T {}
#[cfg(windows)]
trait Pipe: Read + AsRawHandle {}
#[cfg(windows)]
impl<T: Read + AsRawHandle> Pipe for T {}

struct OwnedChild(Child);

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            // Only terminate the process we spawned, never a PID discovered
            // from tracker state or an unrelated browser/daemon descendant.
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[cfg(unix)]
fn prepare_pipe(pipe: &impl Pipe) -> io::Result<()> {
    let fd = pipe.as_raw_fd();
    // SAFETY: the borrowed pipe owns a live descriptor for both calls.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn prepare_pipe(_pipe: &impl Pipe) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn read_available(pipe: &mut impl Pipe, buffer: &mut [u8]) -> io::Result<usize> {
    pipe.read(buffer)
}

#[cfg(windows)]
fn read_available(pipe: &mut impl Pipe, buffer: &mut [u8]) -> io::Result<usize> {
    use windows_sys::Win32::{Foundation::ERROR_BROKEN_PIPE, System::Pipes::PeekNamedPipe};
    let mut available = 0;
    // We are the sole reader of this anonymous pipe. Peek before reading so
    // the synchronous ReadFile used by ChildStdout/Stderr never waits for data.
    // No concurrent I/O is issued on this handle.
    let ok = unsafe {
        PeekNamedPipe(
            pipe.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        let error = io::Error::last_os_error();
        return if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
            Ok(0)
        } else {
            Err(error)
        };
    }
    if available == 0 {
        return Err(io::ErrorKind::WouldBlock.into());
    }
    let count = buffer.len().min(available as usize);
    pipe.read(&mut buffer[..count])
}

fn drain_pipe<T: Pipe>(pipe: &mut Option<T>, bytes: &mut Vec<u8>) -> io::Result<()> {
    let Some(reader) = pipe.as_mut() else {
        return Ok(());
    };
    let mut buffer = [0; 16 * 1024];
    // A continuously writing child must not starve the other stream or the
    // deadline check. This bounds work per poll, not the response size.
    for _ in 0..64 {
        match read_available(reader, &mut buffer) {
            Ok(0) => {
                *pipe = None;
                break;
            }
            Ok(count) => bytes.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

pub(crate) fn output(command: &mut Command, timeout: Duration) -> io::Result<Output> {
    let deadline = Instant::now() + timeout;
    let mut child = OwnedChild(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?,
    );
    let mut stdout_pipe = child.0.stdout.take();
    let mut stderr_pipe = child.0.stderr.take();
    prepare_pipe(stdout_pipe.as_ref().expect("piped stdout"))?;
    prepare_pipe(stderr_pipe.as_ref().expect("piped stderr"))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();

    loop {
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "helper output timed out",
            ));
        }
        drain_pipe(&mut stdout_pipe, &mut stdout)?;
        drain_pipe(&mut stderr_pipe, &mut stderr)?;
        if let Some(status) = child.0.try_wait()? {
            if stdout_pipe.is_none() && stderr_pipe.is_none() {
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
        }
        // Keep polling even after exit: a descendant may still hold a pipe.
        // Never call wait_with_output or leave a blocked reader thread behind.
        thread::sleep(
            Duration::from_millis(5).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const MODE: &str = "DRIFTY_BOUNDED_PROCESS_TEST_MODE";
    // libtest may print the test name under RUST_TEST_THREADS=1. A binary
    // payload cannot be mistaken for that harness output.
    const PAYLOAD_BYTE: u8 = 0xa5;

    fn fixture(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "bounded_process::tests::child_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env(MODE, mode);
        command
    }

    // Re-exec this test executable to exercise real OS pipes on both platforms.
    #[test]
    #[ignore]
    fn child_fixture() {
        match std::env::var(MODE).unwrap().as_str() {
            "large" => {
                let bytes = vec![PAYLOAD_BYTE; 512 * 1024];
                io::stdout().write_all(&bytes).unwrap();
                io::stderr().write_all(&bytes).unwrap();
            }
            "nonzero" => {
                io::stderr().write_all(b"helper failed").unwrap();
                std::process::exit(7);
            }
            "sleep" => thread::sleep(Duration::from_secs(2)),
            "inherited" => {
                let _descendant = fixture("sleep").spawn().unwrap();
            }
            "stream" => loop {
                io::stdout().write_all(&[b'x'; 16 * 1024]).unwrap();
            },
            _ => panic!("unexpected child fixture"),
        }
        std::process::exit(0);
    }

    #[test]
    fn drains_both_streams_while_the_child_is_running() {
        let result = output(&mut fixture("large"), Duration::from_secs(5)).unwrap();
        assert!(result.status.success());
        assert_eq!(
            result
                .stdout
                .iter()
                .filter(|&&byte| byte == PAYLOAD_BYTE)
                .count(),
            512 * 1024
        );
        assert_eq!(result.stderr, vec![PAYLOAD_BYTE; 512 * 1024]);
    }

    #[test]
    fn preserves_exit_status_and_stderr() {
        let result = output(&mut fixture("nonzero"), Duration::from_secs(5)).unwrap();
        assert_eq!(result.status.code(), Some(7));
        assert_eq!(result.stderr, b"helper failed");
    }

    #[test]
    fn timeout_covers_sleep_output_and_inherited_pipes() {
        // Warm up the executable before measuring a short deadline.
        output(&mut fixture("nonzero"), Duration::from_secs(5)).unwrap();
        for mode in ["sleep", "inherited", "stream"] {
            let started = Instant::now();
            let error = output(&mut fixture(mode), Duration::from_millis(150)).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut, "{mode}");
            assert!(
                started.elapsed() < Duration::from_secs(1),
                "{mode}: {:?}",
                started.elapsed()
            );
        }
    }
}

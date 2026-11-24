//! Bounded pipes for a prepared helper. Native code owns the fixed executable;
//! no arbitrary command or process handle crosses the WebView boundary.
use super::{drain_pipe, isolate_child_descriptors, prepare_pipe, OwnedChild};
use std::{
    io::{self, PipeWriter, Write},
    process::{ChildStderr, ChildStdout, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use zeroize::{Zeroize, Zeroizing};

// Eight 41-byte requests and eight one-byte GO grants. This also bounds input
// if a broken helper fabricates replies without ever consuming its stdin.
const INPUT_LIMIT: usize = 8 * 42;
const OUTPUT_LIMIT: usize = 2 * 16 * 1024 + crate::MAX_FRAME_BYTES + 48;
const DIAGNOSTIC_LIMIT: usize = 16 * 1024;
const READER_INPUT_LIMIT: usize = 4096;
const READER_OUTPUT_LIMIT: usize = 16 * 1024 + 48;

pub(crate) struct Session {
    child: OwnedChild,
    input: Option<PipeWriter>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    bytes: Zeroizing<Vec<u8>>,
    diagnostics: Zeroizing<Vec<u8>>,
    consumed: usize,
    sent: usize,
    input_limit: usize,
    output_limit: usize,
    reader_shutdown: bool,
}

impl Session {
    pub(crate) fn spawn(command: &mut Command) -> io::Result<Self> {
        Self::spawn_limits(command, INPUT_LIMIT, OUTPUT_LIMIT)
    }

    /// Fixed activity-reader budget. Total lifetime bytes cannot exceed the
    /// observed Windows pipe capacity even if a broken child fabricates replies
    /// without reading stdin. Never reset sent on a response boundary.
    pub(crate) fn spawn_activity_reader(command: &mut Command) -> io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // A Mac onefile runtime owns a bootloader and its Python child.
            // Keep those descendants in a new group owned by this spawn.
            command.process_group(0);
        }
        Self::spawn_limits(command, READER_INPUT_LIMIT, READER_OUTPUT_LIMIT)
    }
    #[cfg(target_os = "macos")]
    pub(crate) fn spawn_scene_ocr(command: &mut Command, max_jobs: usize) -> io::Result<Self> {
        Self::spawn_limits(
            command,
            max_jobs * (crate::MAX_FRAME_BYTES + 16 * 1024 + 4),
            16 * 1024 + 14,
        )
    }
    /// Large image input uses nonblocking partial writes. Never hold a store
    /// lock here, and never let a child that stops reading defeat cancellation.
    #[cfg(target_os = "macos")]
    pub(crate) fn send_bounded(
        &mut self,
        bytes: &[u8],
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
    ) -> io::Result<()> {
        if !self.can_send(bytes.len()) {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let mut position = 0;
        while position < bytes.len() {
            if cancelled() {
                return Err(io::ErrorKind::Interrupted.into());
            }
            if Instant::now() >= deadline {
                return Err(io::ErrorKind::TimedOut.into());
            }
            if !self.alive()? {
                return Err(io::ErrorKind::BrokenPipe.into());
            }
            match self
                .input
                .as_mut()
                .ok_or(io::ErrorKind::BrokenPipe)?
                .write(&bytes[position..])
            {
                Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                Ok(n) => {
                    position += n;
                    self.sent += n;
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    self.poll()?;
                    thread::sleep(Duration::from_millis(2));
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
    pub(crate) fn can_send(&self, bytes: usize) -> bool {
        bytes <= self.input_limit.saturating_sub(self.sent)
    }
    fn spawn_limits(
        command: &mut Command,
        input_limit: usize,
        output_limit: usize,
    ) -> io::Result<Self> {
        let (reader, input) = io::pipe()?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let fd = input.as_raw_fd();
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::System::Pipes::{GetNamedPipeInfo, PIPE_SERVER_END};
            let (mut flags, mut outgoing, mut incoming) = (0, 0, 0);
            let ok = unsafe {
                GetNamedPipeInfo(
                    reader.as_raw_handle(),
                    &mut flags,
                    &mut outgoing,
                    &mut incoming,
                    std::ptr::null_mut(),
                )
            };
            let capacity = if flags & PIPE_SERVER_END != 0 {
                incoming
            } else {
                outgoing
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            if capacity < input_limit as u32 {
                return Err(io::ErrorKind::InvalidData.into());
            }
        }
        // Query the read end while we own it: a standard write-only child
        // stdin handle lacks FILE_READ_ATTRIBUTES on Windows. No ACL change
        // or extra access to another process is needed for our empty pipe.
        isolate_child_descriptors(command);
        let mut child = OwnedChild(
            command
                .stdin(reader)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?,
            false,
        );
        command.stdin(Stdio::null()); // release Command's extra reader copy
        let stdout = child.0.stdout.take();
        let stderr = child.0.stderr.take();
        prepare_pipe(stdout.as_ref().expect("piped stdout"))?;
        prepare_pipe(stderr.as_ref().expect("piped stderr"))?;
        Ok(Self {
            child,
            input: Some(input),
            stdout,
            stderr,
            bytes: Zeroizing::new(Vec::with_capacity(output_limit)),
            diagnostics: Zeroizing::new(Vec::with_capacity(DIAGNOSTIC_LIMIT)),
            consumed: 0,
            sent: 0,
            input_limit,
            output_limit,
            reader_shutdown: input_limit == READER_INPUT_LIMIT,
        })
    }

    pub(crate) fn alive(&mut self) -> io::Result<bool> {
        Ok(self.child.0.try_wait()?.is_none())
    }

    pub(crate) fn finish_input(&mut self) {
        self.input.take();
    }

    pub(crate) fn exit_success(&mut self) -> io::Result<Option<bool>> {
        Ok(self.child.0.try_wait()?.map(|status| status.success()))
    }

    pub(crate) fn send(&mut self, bytes: &[u8]) -> io::Result<()> {
        if !self.can_send(bytes.len()) || !self.alive()? {
            return Err(io::ErrorKind::InvalidData.into());
        }
        self.input
            .as_mut()
            .ok_or(io::ErrorKind::BrokenPipe)?
            .write_all(bytes)?;
        self.sent += bytes.len();
        Ok(())
    }

    /// Admit pixels for the current request with one GO byte. Until
    /// `complete`, dropping this session lets an in-flight screenshot finish.
    pub(crate) fn grant(&mut self) -> io::Result<()> {
        self.send(&[1])?;
        self.child.1 = true;
        Ok(())
    }

    /// The granted request's response, including its end marker, was read.
    pub(crate) fn complete(&mut self) {
        self.child.1 = false;
    }

    fn poll(&mut self) -> io::Result<()> {
        drain_pipe(
            &mut self.stdout,
            &mut self.bytes,
            self.output_limit,
            "stdout",
        )?;
        drain_pipe(
            &mut self.stderr,
            &mut self.diagnostics,
            DIAGNOSTIC_LIMIT,
            "stderr",
        )
    }

    pub(crate) fn read(
        &mut self,
        count: usize,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
    ) -> io::Result<Zeroizing<Vec<u8>>> {
        if count > self.output_limit.saturating_sub(self.consumed) {
            return Err(io::ErrorKind::InvalidData.into());
        }
        loop {
            if Instant::now() >= deadline {
                return Err(io::ErrorKind::TimedOut.into());
            }
            if cancelled() {
                return Err(io::ErrorKind::Interrupted.into());
            }
            self.poll()?;
            if self.bytes.len() - self.consumed >= count {
                let start = self.consumed;
                self.consumed += count;
                return Ok(Zeroizing::new(self.bytes[start..self.consumed].to_vec()));
            }
            if self.stdout.is_none() {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            thread::sleep(
                Duration::from_millis(2).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }

    pub(crate) fn packet(
        &mut self,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
    ) -> io::Result<Zeroizing<Vec<u8>>> {
        let size = self.read(4, deadline, cancelled)?;
        let size = u32::from_be_bytes(size[..].try_into().expect("four bytes")) as usize;
        if size == 0 || size > 16 * 1024 {
            return Err(io::ErrorKind::InvalidData.into());
        }
        self.read(size, deadline, cancelled)
    }

    /// No bytes may precede a request/GO, or trail the completed response. Clear
    /// all consumed text/pixels before retaining only a ready process/model.
    pub(crate) fn boundary(&mut self) -> io::Result<()> {
        self.finish_boundary(false)
    }

    pub(crate) fn quiet_boundary(&mut self) -> io::Result<()> {
        self.finish_boundary(true)
    }

    fn finish_boundary(&mut self, quiet: bool) -> io::Result<()> {
        self.poll()?;
        if self.bytes.len() != self.consumed || (quiet && !self.diagnostics.is_empty()) {
            return Err(io::ErrorKind::InvalidData.into());
        }
        self.bytes.as_mut_slice().zeroize();
        self.bytes.clear();
        self.consumed = 0;
        self.diagnostics.as_mut_slice().zeroize();
        self.diagnostics.clear();
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.child.1 {
            // EOF before OwnedChild's bounded wait for an in-flight screenshot.
            self.input.take();
        }
        if !self.reader_shutdown {
            return;
        }
        // EOF lets the onefile parent reap its Python child and remove its own
        // extraction directory. Killing that parent first leaves an orphan and
        // strands the extraction. Only this optional reader gets this bounded
        // grace period; a capture helper gets one only for a granted request.
        self.input.take();
        let started = Instant::now();
        while !matches!(self.child.0.try_wait(), Ok(Some(_))) {
            let elapsed = started.elapsed();
            if elapsed >= Duration::from_millis(100) {
                #[cfg(unix)]
                unsafe {
                    // The unreaped, still-live child's PID also identifies the
                    // process group created by this exact spawn, never a group
                    // inferred from tracker state or another app's process.
                    libc::kill(-(self.child.0.id() as i32), libc::SIGTERM);
                }
                break;
            }
            thread::sleep(Duration::from_millis(2));
        }
        while !matches!(self.child.0.try_wait(), Ok(Some(_))) {
            if started.elapsed() >= Duration::from_millis(200) {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(self.child.0.id() as i32), libc::SIGKILL);
                }
                break; // OwnedChild still kills/reaps the exact parent.
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
}

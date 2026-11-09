use super::*;
use crate::{process::session::Session, SceneRegion, TextSource};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Input<'a> {
    protocol_version: u32,
    request_id: Uuid,
    image_sha256: &'a str,
    region: SceneRegion,
    width: u32,
    height: u32,
    png_bytes: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultHeader {
    protocol_version: u32,
    request_id: Uuid,
    image_sha256: String,
    region: SceneRegion,
    text_evidence: TextEvidence,
}
// Bound warm-model lifetime while amortizing preparation across changed images.
const MAX_JOBS: u8 = 4;

pub(super) struct Prepared {
    child: Session,
    jobs: u8,
    last_used: Instant,
}
impl Prepared {
    pub(super) fn reusable(&mut self) -> bool {
        self.jobs < MAX_JOBS
            && self.last_used.elapsed() < std::time::Duration::from_secs(60)
            && self.child.alive().unwrap_or(false)
            && self.child.boundary().is_ok()
    }
    pub(super) fn start(path: &Path, cancel: &Cancellation) -> Result<Self, CaptureFailure> {
        let mut command = Command::new(path);
        command.arg("--scene-ocr-v2");
        let mut child =
            Session::spawn_scene_ocr(&mut command, usize::from(MAX_JOBS)).map_err(failure)?;
        if child
            .read(5, cancel.deadline(), &|| cancel.is_cancelled())
            .map_err(failure)?
            .as_slice()
            != b"SOCR2"
        {
            return Err(CaptureFailure::Invalidated);
        }
        child.boundary().map_err(failure)?;
        Ok(Self {
            child,
            jobs: 0,
            last_used: Instant::now(),
        })
    }
    pub(super) fn recognize(
        &mut self,
        frame: &Frame,
        region: SceneRegion,
        cancel: &Cancellation,
    ) -> Result<TextEvidence, CaptureFailure> {
        let mut run = || -> Result<TextEvidence, io::Error> {
            let request = Uuid::new_v4();
            let child = &mut self.child;
            let deadline = cancel.deadline();
            let stopped = || cancel.is_cancelled();
            let header = Zeroizing::new(
                serde_json::to_vec(&Input {
                    protocol_version: 2,
                    request_id: request,
                    image_sha256: frame.sha256(),
                    region,
                    width: frame.width(),
                    height: frame.height(),
                    png_bytes: frame.bytes().len(),
                })
                .map_err(|_| io::ErrorKind::InvalidData)?,
            );
            child.boundary()?;
            child.send_bounded(&(header.len() as u32).to_be_bytes(), deadline, &stopped)?;
            child.send_bounded(&header, deadline, &stopped)?;
            child.send_bounded(frame.bytes(), deadline, &stopped)?;
            let size = child.read(4, deadline, &stopped)?;
            let size = u32::from_be_bytes(
                size.as_slice()
                    .try_into()
                    .map_err(|_| io::ErrorKind::InvalidData)?,
            ) as usize;
            if size == 0 || size > MAX_NATIVE_HEADER_BYTES {
                return Err(io::ErrorKind::InvalidData.into());
            }
            let bytes = child.read(size, deadline, &stopped)?;
            let result: ResultHeader =
                serde_json::from_slice(&bytes).map_err(|_| io::ErrorKind::InvalidData)?;
            if result.protocol_version != 2
                || result.request_id != request
                || result.image_sha256 != frame.sha256()
                || result.region != region
                || result.text_evidence.source() != TextSource::Ocr
            {
                return Err(io::ErrorKind::InvalidData.into());
            }
            // The ready marker follows the helper's per-image autorelease pool.
            // Reject stale/extra output before retaining only the warmed process.
            if child.read(5, deadline, &stopped)?.as_slice() != b"SOCR2" {
                return Err(io::ErrorKind::InvalidData.into());
            }
            child.boundary()?;
            self.jobs += 1;
            // The last job must still prove a clean exit before committing text.
            while self.jobs == MAX_JOBS {
                if stopped() {
                    return Err(io::ErrorKind::Interrupted.into());
                }
                if let Some(ok) = child.exit_success()? {
                    if !ok {
                        return Err(io::ErrorKind::InvalidData.into());
                    }
                    child.boundary()?;
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(io::ErrorKind::TimedOut.into());
                }
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            if stopped() || Instant::now() >= deadline {
                return Err(io::ErrorKind::Interrupted.into());
            }
            self.last_used = Instant::now();
            Ok(result.text_evidence)
        };
        run().map_err(failure)
    }
}
fn failure(error: io::Error) -> CaptureFailure {
    match error.kind() {
        io::ErrorKind::TimedOut => CaptureFailure::Deadline,
        io::ErrorKind::Interrupted => CaptureFailure::Cancelled,
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => CaptureFailure::Invalidated,
        _ => CaptureFailure::Unavailable,
    }
}

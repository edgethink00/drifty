//! Test executable only. No OS capture APIs or product entry point.
use std::{
    io::{self, Read, Write},
    path::PathBuf,
    time::Duration,
};

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let mode = args.get(1).unwrap().to_string_lossy();
    if mode == "screen-context-activity-prepare-v1" {
        prepare_protocol(&args);
        return;
    }
    if mode == "screen-context-activity-reader-v2" {
        reader_protocol(&args);
        return;
    }
    if mode == "--worker-v1" || mode == "--worker-v2" || mode == "--worker-v3" {
        worker_protocol(&args);
        return;
    }
    if mode == "--protocol-v1" {
        protocol(&args);
        return;
    }
    let root = PathBuf::from(args.get(2).unwrap());
    std::fs::write(root.join("child.pid"), std::process::id().to_string()).unwrap();
    let payload = b"owned-preflight";
    if mode == "oversize" {
        io::stdout().write_all(&u32::MAX.to_be_bytes()).unwrap();
    } else {
        let mut packet = (payload.len() as u32).to_be_bytes().to_vec();
        packet.extend_from_slice(payload);
        if mode == "early-output" {
            packet.extend_from_slice(b"forbidden-early-output");
        }
        io::stdout().write_all(&packet).unwrap();
    }
    io::stdout().flush().unwrap();
    let mut go = [0];
    if io::stdin().read_exact(&mut go).is_err() || go[0] != 1 {
        return;
    }
    std::fs::write(root.join("admitted.marker"), b"GO received").unwrap();
    if mode == "hung" {
        io::stdout().write_all(b"partial-result").unwrap();
        io::stdout().flush().unwrap();
        std::thread::sleep(Duration::from_secs(20));
    } else {
        io::stdout().write_all(b"owned-result").unwrap();
    }
}

fn prepare_protocol(args: &[std::ffi::OsString]) {
    assert_eq!(args[2], "--db");
    let executable = std::env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let name = executable.file_stem().unwrap().to_string_lossy();
    let mode = name.strip_prefix("preparer-fixture-").unwrap();
    std::fs::write(
        root.join("prepare-entered.txt"),
        std::process::id().to_string(),
    )
    .unwrap();
    if let Some(index) = args.iter().position(|arg| arg == "--producer-runtime") {
        assert_eq!(args.len(), index + 2);
        std::fs::write(
            root.join("prepare-producer-argument.json"),
            serde_json::to_vec(&PathBuf::from(&args[index + 1])).unwrap(),
        )
        .unwrap();
    }
    if mode == "hung" {
        std::thread::sleep(Duration::from_secs(20));
        return;
    }
    let state = match mode {
        "writer-stale" => 1,
        "missing" => 2,
        "unavailable" => 3,
        "unknown-state" => 255,
        _ => 0,
    };
    let header = if mode == "wrong-version" {
        b"SBP2"
    } else {
        b"SBP1"
    };
    io::stdout().write_all(header).unwrap();
    io::stdout().write_all(&[state]).unwrap();
    if mode == "trailing" {
        io::stdout()
            .write_all(b"owned private trailing data")
            .unwrap();
    }
    if mode == "diagnostics" {
        eprintln!("owned private path or error");
    }
    io::stdout().flush().unwrap();
    if mode == "nonzero" {
        std::process::exit(7);
    }
}

fn reader_protocol(args: &[std::ffi::OsString]) {
    let executable = std::env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let name = executable.file_stem().unwrap().to_string_lossy();
    let mode = name.strip_prefix("reader-fixture-").unwrap();
    assert_eq!(args[2], "--db");
    let mut pids = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("reader-pids.txt"))
        .unwrap();
    writeln!(pids, "{}", std::process::id()).unwrap();
    if mode == "hung-ready" {
        std::thread::sleep(Duration::from_secs(20));
        return;
    }
    io::stdout()
        .write_all(if mode == "wrong-ready" {
            b"SBR1"
        } else {
            b"SBR2"
        })
        .unwrap();
    io::stdout().flush().unwrap();
    if mode == "early-output" {
        io::stdout().write_all(b"extra").unwrap();
        io::stdout().flush().unwrap();
    }
    for _ in 0..64 {
        let mut length = [0; 4];
        if io::stdin().read_exact(&mut length).is_err() {
            return;
        }
        let n = u32::from_be_bytes(length) as usize;
        assert!(n <= 2048);
        let mut bytes = vec![0; n];
        io::stdin().read_exact(&mut bytes).unwrap();
        std::fs::write(root.join("reader-entered.txt"), b"request read").unwrap();
        if mode == "hung-query" {
            std::thread::sleep(Duration::from_secs(20));
            return;
        }
        let query: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let op = &query["operation"];
        let ids: Vec<_> = if op["kind"] == "read" {
            op["recordIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_owned())
                .collect()
        } else {
            vec!["1".into()]
        };
        let observed = op["observedAtMs"].as_i64().unwrap_or(1000);
        let records:Vec<_>=ids.iter().map(|id|serde_json::json!({"recordId":id,"segmentUid":"f26d8c10-cb09-4c98-a3e3-3744216aab1e","identityDigest":"a".repeat(64),"startedAtMs":observed-1,"endedAtMs":observed+1,"revokedRanges":[]})).collect();
        let mut reply = serde_json::json!({"protocolVersion":2,"proofVersion":1,"requestId":query["requestId"],"records":records});
        match mode {
            "wrong-version" => reply["protocolVersion"] = 1.into(),
            "missing-point-fence" => {
                reply.as_object_mut().unwrap().remove("proofVersion");
            }
            "wrong-point-fence" => reply["proofVersion"] = 2.into(),
            "malformed-point-fence" => {
                reply["records"][0]["revokedRanges"] = serde_json::json!([[1000, 1000]])
            }
            "revoked-point" => {
                reply["records"][0]["revokedRanges"] = serde_json::json!([[observed, observed + 1]])
            }
            "wrong-request" => reply["requestId"] = uuid::Uuid::new_v4().to_string().into(),
            "unknown-field" => reply["rawTitle"] = "forbidden".into(),
            "foreign-id" => reply["records"][0]["recordId"] = "864290114".into(),
            "bad-uid" => reply["records"][0]["segmentUid"] = uuid::Uuid::nil().to_string().into(),
            "duplicate-row" | "two-resolve" => {
                let row = reply["records"][0].clone();
                reply["records"].as_array_mut().unwrap().push(row);
            }
            "reordered" => reply["records"].as_array_mut().unwrap().reverse(),
            "outside-point" => reply["records"][0]["endedAtMs"] = observed.into(),
            _ => {}
        }
        let bytes = serde_json::to_vec(&reply).unwrap();
        if mode == "oversize" {
            io::stdout().write_all(&u32::MAX.to_be_bytes()).unwrap();
            io::stdout().flush().unwrap();
            return;
        }
        io::stdout()
            .write_all(&(bytes.len() as u32).to_be_bytes())
            .unwrap();
        io::stdout().write_all(&bytes).unwrap();
        io::stdout()
            .write_all(if mode == "wrong-footer-version" {
                b"SBE1"
            } else {
                b"SBE2"
            })
            .unwrap();
        let footer = if mode == "wrong-footer" {
            uuid::Uuid::new_v4().to_string()
        } else {
            query["requestId"].as_str().unwrap().to_owned()
        };
        io::stdout().write_all(footer.as_bytes()).unwrap();
        if mode == "trailing-output" {
            io::stdout().write_all(b"extra").unwrap();
        }
        io::stdout().flush().unwrap();
    }
}

fn worker_protocol(args: &[std::ffi::OsString]) {
    use drifty_screen_context_core::{native::*, *};
    let version = match args[1].to_string_lossy().as_ref() {
        "--worker-v3" => 3,
        "--worker-v2" => 2,
        _ => 1,
    };
    let executable = std::env::current_exe().unwrap();
    let name = executable.file_stem().unwrap().to_string_lossy();
    let mode = name
        .strip_prefix("warm-fixture-")
        .or_else(|| name.strip_prefix("source-fixture-"))
        .or_else(|| name.strip_prefix("activity-fixture-"))
        .expect("explicit copied QA executable");
    let root = executable.parent().unwrap();
    let mut pids = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("pids.txt"))
        .unwrap();
    writeln!(pids, "{}", std::process::id()).unwrap();
    let recycled = std::fs::read_to_string(root.join("pids.txt"))
        .unwrap()
        .lines()
        .count()
        == 2;
    if mode == "hung-ready" || (mode == "hung-recycle" && recycled) {
        std::thread::sleep(Duration::from_secs(20));
        return;
    }
    if mode == "failed-recycle" && recycled {
        io::stdout().write_all(b"BAD!").unwrap();
        io::stdout().flush().unwrap();
        return;
    }
    if mode == "legacy-ready" {
        io::stdout().write_all(b"RDY1").unwrap();
        io::stdout().flush().unwrap();
        return;
    }
    if mode == "source-ready" {
        io::stdout().write_all(b"RDY2").unwrap();
        io::stdout().flush().unwrap();
        return;
    }
    let token = |prefix: &str| format!("{prefix}{version}");
    io::stdout().write_all(token("RDY").as_bytes()).unwrap();
    io::stdout().flush().unwrap();
    for _ in 0..8 {
        let mut input = [0u8; 41];
        if io::stdin().read_exact(&mut input).is_err() {
            return;
        }
        assert_eq!(&input[..4], token("JOB").as_bytes());
        let request_id =
            uuid::Uuid::parse_str(std::str::from_utf8(&input[4..40]).unwrap()).unwrap();
        let expected_mode = match args[3].to_string_lossy().as_ref() {
            "on" | "ocr" => 1,
            "accessibility" => 2,
            "accessibility-or-ocr" => 3,
            _ => 0,
        };
        assert_eq!(input[40], expected_mode);
        let facts = SurfaceFacts {
            identity: SurfaceIdentity {
                pid: std::process::id(),
                process_birth: 123,
                window_id: 8,
                app_id: "owned.editor".into(),
                document_id: "1".repeat(64),
                document_generation: 1,
            },
            permission: true,
            foreground: true,
            interactive: true,
            protected: false,
            visibility: Visibility::Visible,
            privacy: Privacy::NotBrowser,
        };
        let mut before = facts.clone();
        if mode == "wrong-document" {
            before.identity.document_id = "0".repeat(64);
        }
        fn packet(value: &impl serde::Serialize) -> Vec<u8> {
            let bytes = serde_json::to_vec(value).unwrap();
            let mut packet = (bytes.len() as u32).to_be_bytes().to_vec();
            packet.extend(bytes);
            packet
        }
        let hint = NativeActivityObservation {
            window_title_digest: (mode != "no-title")
                .then(|| WindowTitleDigest::parse("a".repeat(64)).unwrap()),
        };
        let mut pre = serde_json::to_value(NativePreflight {
            protocol_version: version,
            request_id,
            facts: before,
        })
        .unwrap();
        if version == 3 && mode != "missing-pre-hint" {
            pre["activityHint"] = serde_json::to_value(&hint).unwrap();
            if mode == "bad-pre-digest" {
                pre["activityHint"]["windowTitleDigest"] = "UPPER-or-raw-title".into();
            }
            if mode == "unknown-pre-hint" {
                pre["activityHint"]["rawTitle"] = "forbidden".into();
            }
        }
        let mut preflight = packet(&pre);
        if mode == "early-output" {
            preflight.extend(b"early-pixels");
        }
        io::stdout().write_all(&preflight).unwrap();
        io::stdout().flush().unwrap();
        let mut go = [0];
        if io::stdin().read_exact(&mut go).is_err() {
            return;
        }
        assert_eq!(go, [1]);
        let mut admitted = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("admitted.txt"))
            .unwrap();
        writeln!(admitted, "{} {}", std::process::id(), request_id).unwrap();
        if mode == "hung-job" {
            std::thread::sleep(Duration::from_secs(20));
            return;
        }
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[42; 16])
            .unwrap();
        let frame = Frame::from_png(png).unwrap();
        let ocr = input[40] & 1 != 0;
        let legacy_result = || {
            packet(&NativeResult {
                protocol_version: 1,
                request_id,
                before: facts.clone(),
                after: facts.clone(),
                observed_at_ms: unix_millis().unwrap(),
                text: if ocr {
                    "한글 owned fixture".into()
                } else {
                    String::new()
                },
                ocr_state: if ocr {
                    OcrState::Recognized
                } else {
                    OcrState::NotRequested
                },
                frame: NativeFrameHeader {
                    png_bytes: frame.bytes().len(),
                    width: frame.width(),
                    height: frame.height(),
                    sha256: frame.sha256().into(),
                },
            })
        };
        let mut output = if version == 1 || mode == "legacy-result" {
            legacy_result()
        } else {
            let source = if mode == "wrong-source" {
                TextSource::Ocr
            } else if input[40] & 2 != 0 {
                TextSource::Accessibility
            } else if ocr {
                TextSource::Ocr
            } else {
                TextSource::None
            };
            let text = if source == TextSource::None {
                TextEvidence::not_requested()
            } else {
                TextEvidence::new(
                    source,
                    TextState::Recognized,
                    zeroize::Zeroizing::new("owned source-aware fixture".into()),
                )
                .unwrap()
            };
            let mut value = serde_json::to_value(NativeTextResult {
                protocol_version: 2,
                request_id,
                before: facts.clone(),
                after: facts.clone(),
                observed_at_ms: unix_millis().unwrap(),
                text_evidence: text,
                frame: NativeFrameHeader {
                    png_bytes: frame.bytes().len(),
                    width: frame.width(),
                    height: frame.height(),
                    sha256: frame.sha256().into(),
                },
            })
            .unwrap();
            if mode == "missing-source" {
                value["textEvidence"]
                    .as_object_mut()
                    .unwrap()
                    .remove("source");
            }
            if version == 3 && mode != "source-result" {
                value["protocolVersion"] = 3.into();
                value["activityHintBefore"] = serde_json::to_value(&hint).unwrap();
                value["activityHintAfter"] = serde_json::to_value(&hint).unwrap();
                if mode == "changed-title" {
                    value["activityHintAfter"]["windowTitleDigest"] = "b".repeat(64).into();
                }
                if mode == "changed-before-title" {
                    value["activityHintBefore"]["windowTitleDigest"] = "b".repeat(64).into();
                }
                if mode == "bad-result-digest" {
                    value["activityHintAfter"]["windowTitleDigest"] = "f".repeat(65).into();
                }
                if mode == "missing-result-hint" {
                    value.as_object_mut().unwrap().remove("activityHintAfter");
                }
                if mode == "unknown-result-hint" {
                    value["activityHintAfter"]["rawTitle"] = "forbidden".into();
                }
                if mode == "wrong-result-version" {
                    value["protocolVersion"] = 2.into();
                }
            }
            packet(&value)
        };
        output.extend_from_slice(frame.bytes());
        output.extend(if mode == "source-footer" {
            b"END2".to_vec()
        } else {
            token("END").into_bytes()
        });
        let footer = if mode == "wrong-footer" {
            uuid::Uuid::new_v4()
        } else {
            request_id
        };
        output.extend(footer.to_string().as_bytes());
        if mode == "trailing-output" {
            output.push(42);
        }
        io::stdout().write_all(&output).unwrap();
        io::stdout().flush().unwrap();
    }
}

fn protocol(args: &[std::ffi::OsString]) {
    use drifty_screen_context_core::{native::*, *};
    let request_id = uuid::Uuid::parse_str(&args[3].to_string_lossy()).unwrap();
    let ocr = args[5] == "on";
    let facts = SurfaceFacts {
        identity: SurfaceIdentity {
            pid: std::process::id(),
            process_birth: 123,
            window_id: 8,
            app_id: "owned.editor".into(),
            document_id: "1".repeat(64),
            document_generation: 1,
        },
        permission: true,
        foreground: true,
        interactive: true,
        protected: false,
        visibility: Visibility::Visible,
        privacy: Privacy::NotBrowser,
    };
    fn packet(value: &impl serde::Serialize) {
        let data = serde_json::to_vec(value).unwrap();
        io::stdout()
            .write_all(&(data.len() as u32).to_be_bytes())
            .unwrap();
        io::stdout().write_all(&data).unwrap();
        io::stdout().flush().unwrap();
    }
    packet(&NativePreflight {
        protocol_version: 1,
        request_id,
        facts: facts.clone(),
    });
    let mut go = [0];
    if io::stdin().read_exact(&mut go).is_err() || go[0] != 1 {
        return;
    }
    // Synthetic in-memory pixels. This executable never reads a screen.
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, 2, 2);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&[42; 16])
        .unwrap();
    let frame = Frame::from_png(png).unwrap();
    packet(&NativeResult {
        protocol_version: 1,
        request_id,
        before: facts.clone(),
        after: facts,
        observed_at_ms: unix_millis().unwrap(),
        text: if ocr {
            "한글 owned fixture".into()
        } else {
            String::new()
        },
        ocr_state: if ocr {
            OcrState::Recognized
        } else {
            OcrState::NotRequested
        },
        frame: NativeFrameHeader {
            png_bytes: frame.bytes().len(),
            width: frame.width(),
            height: frame.height(),
            sha256: frame.sha256().to_owned(),
        },
    });
    io::stdout().write_all(frame.bytes()).unwrap();
}

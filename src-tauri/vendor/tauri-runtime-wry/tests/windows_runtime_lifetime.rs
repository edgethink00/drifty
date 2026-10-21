// Copyright 2019-2026 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0 OR MIT
// The clone stimulus follows the public-API reproducer in tauri-apps/tauri#16089.
// Run each case in its own process: a regressed Rc counter can abort, not unwind.

#[cfg(windows)]
mod windows {
  use std::{
    hint::black_box,
    process::{Command, Stdio},
    sync::{Arc, Barrier, mpsc},
    thread,
    time::{Duration, Instant},
  };
  use tauri_runtime::{Runtime, RuntimeHandle, RuntimeInitArgs};
  use tauri_runtime_wry::Wry;

  fn concurrent(drop_while_running: bool) {
    let runtime = Wry::<()>::new(RuntimeInitArgs::default()).unwrap();
    let handle = runtime.handle();
    let start = Arc::new(Barrier::new(9));
    let workers: Vec<_> = (0..8)
      .map(|_| {
        let handle = handle.clone();
        let start = start.clone();
        thread::spawn(move || {
          start.wait();
          for _ in 0..100_000 {
            let copy = black_box(handle.clone());
            black_box(&copy);
            drop(copy);
          }
          // Windows' display handle is pointer-free, including after teardown.
          assert!(matches!(
            handle.display_handle().unwrap().as_raw(),
            raw_window_handle::RawDisplayHandle::Windows(_)
          ));
        })
      })
      .collect();
    let mut runtime = Some(runtime);
    start.wait();
    if drop_while_running {
      drop(runtime.take());
      assert!(
        handle
          .run_on_main_thread(|| panic!("closed runtime ran a task"))
          .is_err()
      );
    }
    for worker in workers {
      worker.join().unwrap();
    }
    drop(handle);
    drop(runtime);
  }

  fn dispatch() {
    let runtime = Wry::<()>::new(RuntimeInitArgs::default()).unwrap();
    let owner = thread::current().id();
    let handle = runtime.handle();
    let (done, received) = mpsc::channel();
    let retained = handle.clone();
    // Covers the synchronous owner path as well as the proxy path below.
    handle
      .run_on_main_thread(move || assert_eq!(owner, thread::current().id()))
      .unwrap();
    let worker = thread::spawn(move || {
      handle
        .run_on_main_thread(move || {
          assert_eq!(owner, thread::current().id());
          done.send(()).unwrap();
        })
        .unwrap();
      received.recv_timeout(Duration::from_secs(10)).unwrap();
      handle.available_monitors().unwrap();
      handle.request_exit(0).unwrap();
    });
    assert_eq!(runtime.run_return(|_| {}), 0);
    worker.join().unwrap();
    assert!(
      retained
        .run_on_main_thread(|| panic!("exited loop ran a task"))
        .is_err()
    );
    thread::spawn(move || {
      for _ in 0..100_000 {
        drop(black_box(retained.clone()));
      }
      assert!(
        retained
          .run_on_main_thread(|| panic!("exited loop ran worker task"))
          .is_err()
      );
      assert!(retained.display_handle().is_ok());
    })
    .join()
    .unwrap();
  }

  pub fn run() {
    // Prevent a deliberate regression crash from opening an unattended modal.
    unsafe {
      #[link(name = "kernel32")]
      unsafe extern "system" {
        fn SetErrorMode(mode: u32) -> u32;
      }
      SetErrorMode(0x0002);
    }
    let case = std::env::args().nth(1);
    match case.as_deref() {
      Some("concurrent") => concurrent(false),
      Some("teardown") => concurrent(true),
      Some("dispatch") => dispatch(),
      None => {
        for case in ["concurrent", "teardown", "dispatch"] {
          for attempt in 1..=5 {
            let mut child = Command::new(std::env::current_exe().unwrap())
              .arg(case)
              .stdout(Stdio::inherit())
              .stderr(Stdio::inherit())
              .spawn()
              .unwrap();
            let deadline = Instant::now() + Duration::from_secs(20);
            let status = loop {
              if let Some(status) = child.try_wait().unwrap() {
                break status;
              }
              if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("{case} attempt {attempt} timed out");
              }
              thread::sleep(Duration::from_millis(20));
            };
            assert!(status.success(), "{case} attempt {attempt}: {status}");
            println!("PASS {case} attempt {attempt}");
          }
        }
      }
      Some(other) => panic!("unknown case {other}"),
    }
  }
}

fn main() {
  #[cfg(windows)]
  windows::run();
  #[cfg(not(windows))]
  println!("Windows-only runtime lifetime regression: not applicable on this target");
}

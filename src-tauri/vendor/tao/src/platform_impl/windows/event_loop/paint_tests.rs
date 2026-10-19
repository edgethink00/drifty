use super::*;
use std::cell::RefCell;

struct PaintTarget {
  window: HWND,
  runner: EventLoopRunnerShared<()>,
  events: Rc<RefCell<Vec<&'static str>>>,
  _sender: Sender<()>,
}

impl PaintTarget {
  fn new(reenter_from_handler: bool) -> Self {
    let window = create_event_target_window::<()>();
    let runner = Rc::new(EventLoopRunner::new(window, unsafe {
      GetCurrentThreadId()
    }));
    let sender = insert_event_target_window_data(window, runner.clone());
    let events = Rc::new(RefCell::new(Vec::new()));
    let captured_events = events.clone();
    unsafe {
      runner.set_event_handler(move |event, flow| {
        *flow = ControlFlow::Wait;
        match event {
          Event::MainEventsCleared => {
            captured_events.borrow_mut().push("main-cleared");
            if reenter_from_handler {
              let _ = SendMessageW(window, WM_PAINT, None, None);
            }
          }
          Event::RedrawEventsCleared => captured_events.borrow_mut().push("redraw-cleared"),
          _ => {}
        }
      });
      runner.poll();
    }
    Self {
      window,
      runner,
      events,
      _sender: sender,
    }
  }

  fn paint(&self) {
    unsafe { SendMessageW(self.window, WM_PAINT, None, None) };
  }
}

impl Drop for PaintTarget {
  fn drop(&mut self) {
    // Clear a captured failure before teardown so WM_NCDESTROY can free its data.
    let _ = self.runner.take_panic_error();
    unsafe {
      let _ = DestroyWindow(self.window);
    }
  }
}

#[test]
fn nested_thread_paint_leaves_completion_to_the_outer_redraw() {
  let target = PaintTarget::new(false);
  unsafe {
    target.runner.main_events_cleared();
  }
  assert!(target.runner.redrawing());
  target.events.borrow_mut().clear();

  // Real Win32 dispatch while an outer public-window flush owns the redraw phase.
  for _ in 0..32 {
    target.paint();
  }

  assert!(
    target.runner.take_panic_error().is_ok(),
    "nested WM_PAINT panicked"
  );
  assert!(
    target.runner.redrawing(),
    "nested paint completed the outer redraw"
  );
  assert!(target.events.borrow().is_empty());
  unsafe {
    target.runner.redraw_events_cleared();
  }
  assert_eq!(*target.events.borrow(), ["redraw-cleared"]);
  assert!(!target.runner.handling_events());

  // Suppressing the nested completion must not stall the following frame.
  target.events.borrow_mut().clear();
  unsafe {
    target.runner.poll();
  }
  target.paint();
  assert!(target.runner.take_panic_error().is_ok());
  assert_eq!(*target.events.borrow(), ["main-cleared", "redraw-cleared"]);
  assert!(!target.runner.handling_events());
}

#[test]
fn ordinary_thread_paint_completes_the_redraw_once() {
  let target = PaintTarget::new(false);
  target.paint();
  assert!(target.runner.take_panic_error().is_ok());
  assert_eq!(*target.events.borrow(), ["main-cleared", "redraw-cleared"]);
  assert!(!target.runner.handling_events());
  target.paint();
  assert!(target.runner.take_panic_error().is_ok());
  assert_eq!(*target.events.borrow(), ["main-cleared", "redraw-cleared"]);
}

#[test]
fn paint_during_the_user_callback_keeps_the_existing_buffering_path() {
  let target = PaintTarget::new(true);
  target.paint();
  assert!(target.runner.take_panic_error().is_ok());
  assert_eq!(*target.events.borrow(), ["main-cleared", "redraw-cleared"]);
  assert!(!target.runner.handling_events());
}

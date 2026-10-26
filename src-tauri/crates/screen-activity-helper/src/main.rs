fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    let status =
        std::panic::catch_unwind(|| drifty_screen_activity_helper::run(&arguments)).unwrap_or(2);
    std::process::exit(status.into());
}

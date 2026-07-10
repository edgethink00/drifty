fn main() {
    let _sentry_guard = drifty_lib::init_native_observability();
    drifty_lib::run();
}

fn main() {
    drifty_lib::configure_isolated_dev_activation_policy();
    let _sentry_guard = drifty_lib::init_native_observability();
    drifty_lib::run();
}

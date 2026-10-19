#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(all(not(target_os = "windows"), not(test)))]
compile_error!("RiftMind only supports Windows. Use cargo test -p riftmind-core on macOS.");
mod adapters;
mod app;
mod bootstrap;
fn main() {
    app::run();
}

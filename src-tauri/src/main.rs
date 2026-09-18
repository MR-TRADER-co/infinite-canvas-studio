// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * Desktop entry point — delegates to the library crate so the same code can
 * later serve mobile targets.
 */
fn main() {
    infinite_canvas_studio_lib::run()
}

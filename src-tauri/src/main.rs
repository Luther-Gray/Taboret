// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Workaround for WebKitGTK "Error 71 (Protocol error) dispatching to Wayland display"
        // on Wayland compositors like Hyprland
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // SAFETY: Called at the very entry of main before any other threads are spawned.
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    app_lib::run();
}

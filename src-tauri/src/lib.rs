use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use base64::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct MediaSaveItem {
    pub filename: String,
    pub data_url: Option<String>,
    pub source_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BoardReadResult {
    pub folder_path: String,
    pub board_json: String,
    pub media_files: Vec<MediaReadItem>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MediaReadItem {
    pub filename: String,
    pub data_url: String,
    pub mime_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FetchedMediaResult {
    pub filename: String,
    pub data_url: String,
    pub mime_type: String,
}

#[tauri::command]
fn read_board_from_folder(folder_path: String) -> Result<BoardReadResult, String> {
    let board_dir = Path::new(&folder_path);
    if !board_dir.exists() || !board_dir.is_dir() {
        return Err("Directory does not exist".into());
    }

    let board_file = board_dir.join("board.json");
    if !board_file.exists() {
        return Err("No board.json found in this folder. Please choose a valid Taboret board directory.".into());
    }

    let board_json = std::fs::read_to_string(&board_file)
        .map_err(|e| format!("Failed to read board.json: {}", e))?;

    let media_dir = board_dir.join("media");
    let mut media_files = Vec::new();

    if media_dir.exists() && media_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&media_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let filename = path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    
                    if let Ok(bytes) = std::fs::read(&path) {
                        let mime = get_mime_from_extension(&path);
                        let b64 = BASE64_STANDARD.encode(&bytes);
                        let data_url = format!("data:{};base64,{}", mime, b64);
                        media_files.push(MediaReadItem {
                            filename,
                            data_url,
                            mime_type: mime,
                        });
                    }
                }
            }
        }
    }

    Ok(BoardReadResult {
        folder_path,
        board_json,
        media_files,
    })
}

#[tauri::command]
fn save_board_to_folder(folder_path: String, board_json: String, media_files: Vec<MediaSaveItem>) -> Result<(), String> {
    let board_dir = Path::new(&folder_path);
    std::fs::create_dir_all(board_dir)
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    let media_dir = board_dir.join("media");
    std::fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Failed to create media folder: {}", e))?;

    let board_file = board_dir.join("board.json");
    std::fs::write(&board_file, board_json)
        .map_err(|e| format!("Failed to write board.json: {}", e))?;

    for item in media_files {
        let dest_file = media_dir.join(&item.filename);

        if let Some(src) = item.source_path {
            let src_path = PathBuf::from(src);
            if src_path.exists() && src_path.is_file() && src_path != dest_file {
                let _ = std::fs::copy(&src_path, &dest_file);
                continue;
            }
        }

        if let Some(data_url) = item.data_url {
            if let Some(comma_pos) = data_url.find(',') {
                let b64_part = &data_url[comma_pos + 1..];
                if let Ok(bytes) = BASE64_STANDARD.decode(b64_part) {
                    let _ = std::fs::write(&dest_file, bytes);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn fetch_remote_media(url: String) -> Result<FetchedMediaResult, String> {
    let resp = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .call()
        .map_err(|e| format!("Failed to fetch remote media: {}", e))?;

    let content_type = resp.header("Content-Type")
        .unwrap_or("image/jpeg")
        .to_string();

    let mut bytes = Vec::new();
    let mut reader = resp.into_reader();
    std::io::copy(&mut reader, &mut bytes)
        .map_err(|e| format!("Failed reading remote media stream: {}", e))?;

    let b64 = BASE64_STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", content_type, b64);

    let ext = extension_from_mime(&content_type);
    let filename = format!("web_media_{}.{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), ext);

    Ok(FetchedMediaResult {
        filename,
        data_url,
        mime_type: content_type,
    })
}

#[tauri::command]
fn read_local_media_file(file_path: String) -> Result<FetchedMediaResult, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() || !path.is_file() {
        return Err("File does not exist".into());
    }

    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let filename = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "media_item".to_string());

    let mime = get_mime_from_extension(&path);
    let b64 = BASE64_STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", mime, b64);

    Ok(FetchedMediaResult {
        filename,
        data_url,
        mime_type: mime,
    })
}

fn get_mime_from_extension(path: &Path) -> String {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "png" => "image/png".into(),
        "jpg" | "jpeg" => "image/jpeg".into(),
        "webp" => "image/webp".into(),
        "gif" => "image/gif".into(),
        "svg" => "image/svg+xml".into(),
        "mp4" => "video/mp4".into(),
        "webm" => "video/webm".into(),
        "ogg" => "video/ogg".into(),
        _ => "application/octet-stream".into(),
    }
}

fn extension_from_mime(mime: &str) -> &'static str {
    if mime.contains("png") {
        "png"
    } else if mime.contains("gif") {
        "gif"
    } else if mime.contains("webp") {
        "webp"
    } else if mime.contains("svg") {
        "svg"
    } else if mime.contains("mp4") {
        "mp4"
    } else if mime.contains("webm") {
        "webm"
    } else {
        "jpg"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_board_from_folder,
            save_board_to_folder,
            fetch_remote_media,
            read_local_media_file
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

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
    let mut board_dir = PathBuf::from(&folder_path);
    if board_dir.is_file() {
        if let Some(parent) = board_dir.parent() {
            board_dir = parent.to_path_buf();
        }
    }

    if !board_dir.exists() || !board_dir.is_dir() {
        return Err("Directory does not exist".into());
    }

    let board_file = board_dir.join("board.json");
    if !board_file.exists() {
        return Err("No board.json found in this directory. Please choose a valid Taboret board directory or board.json file.".into());
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
        folder_path: board_dir.to_string_lossy().to_string(),
        board_json,
        media_files,
    })
}

#[tauri::command]
fn save_board_to_folder(folder_path: String, board_json: String, media_files: Vec<MediaSaveItem>) -> Result<(), String> {
    let mut board_dir = PathBuf::from(&folder_path);
    if board_dir.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("json")).unwrap_or(false) {
        if let Some(parent) = board_dir.parent() {
            board_dir = parent.to_path_buf();
        }
    }

    std::fs::create_dir_all(&board_dir)
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
fn fetch_remote_media(mut url: String) -> Result<FetchedMediaResult, String> {
    // Upgrade Pinterest thumbnails to highest available CDN resolution
    if url.contains("i.pinimg.com") {
        url = url.replace("/236x/", "/736x/").replace("/474x/", "/736x/");
    }

    // Determine referrer from the URL's own origin (many CDNs check this)
    let referer = if let Ok(parsed) = url::Url::parse(&url) {
        format!("{}://{}/", parsed.scheme(), parsed.host_str().unwrap_or(""))
    } else {
        "https://www.google.com/".to_string()
    };

    let resp = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .set("Referer", &referer)
        .set("Accept", "image/avif,image/webp,image/png,image/*,*/*;q=0.8")
        .call()
        .map_err(|e| format!("Failed to fetch remote media: {}", e))?;

    let mut content_type = resp.header("Content-Type")
        .unwrap_or("image/jpeg")
        .to_string();

    let mut bytes = Vec::new();
    let mut reader = resp.into_reader();
    std::io::copy(&mut reader, &mut bytes)
        .map_err(|e| format!("Failed reading remote media stream: {}", e))?;

    // If the response is HTML, extract an image URL from it (handles page links, Pinterest pins, Artstation, etc.)
    if content_type.contains("text/html") {
        let html_str = String::from_utf8_lossy(&bytes);
        let target_image_url = extract_og_image(&html_str, &url)
            .ok_or_else(|| "Dropped web link is a webpage without a detectable image preview".to_string())?;

        // Upgrade Pinterest CDN resolution on extracted URL
        let target_image_url = if target_image_url.contains("i.pinimg.com") {
            target_image_url.replace("/236x/", "/736x/").replace("/474x/", "/736x/")
        } else {
            target_image_url
        };

        let img_referer = if let Ok(parsed) = url::Url::parse(&target_image_url) {
            format!("{}://{}/", parsed.scheme(), parsed.host_str().unwrap_or(""))
        } else {
            referer.clone()
        };

        let img_resp = ureq::get(&target_image_url)
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
            .set("Referer", &img_referer)
            .set("Accept", "image/avif,image/webp,image/png,image/*,*/*;q=0.8")
            .call()
            .map_err(|e| format!("Failed fetching extracted image: {}", e))?;

        content_type = img_resp.header("Content-Type")
            .unwrap_or("image/jpeg")
            .to_string();

        bytes.clear();
        let mut img_reader = img_resp.into_reader();
        std::io::copy(&mut img_reader, &mut bytes)
            .map_err(|e| format!("Failed reading extracted image: {}", e))?;
    }

    let b64 = BASE64_STANDARD.encode(&bytes);
    // Strip MIME parameters (e.g. "image/jpeg; charset=utf-8" -> "image/jpeg")
    let clean_mime = content_type.split(';').next().unwrap_or("image/jpeg").trim();
    let data_url = format!("data:{};base64,{}", clean_mime, b64);

    let ext = extension_from_mime(clean_mime);
    let filename = format!("web_media_{}.{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), ext);

    Ok(FetchedMediaResult {
        filename,
        data_url,
        mime_type: clean_mime.to_string(),
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

/// Searches HTML for an og:image, twitter:image, or similar meta URL.
/// Handles minified (all on one line) and multi-line HTML.
/// Returns the first valid http(s) image URL found.
fn extract_og_image(html: &str, page_url: &str) -> Option<String> {
    // Patterns to search for (order = priority)
    let search_pairs: &[(&str, &str)] = &[
        ("og:image:secure_url", "content"),
        ("og:image", "content"),
        ("twitter:image", "content"),
        ("thumbnailUrl", ""),     // JSON-LD
        ("image", ""),            // JSON-LD fallback
    ];

    let _ = page_url; // available for future use

    // Normalize: the whole HTML as a single string for easy searching
    for (key, attr) in search_pairs {
        // Try meta tag format: <meta property="og:image" content="URL" />
        // or:                  <meta content="URL" property="og:image" />
        let mut search_pos = 0;
        while let Some(key_pos) = html[search_pos..].find(key) {
            let abs_pos = search_pos + key_pos;
            // Look within 512 chars around the key for a content=" ... "
            let window_start = if abs_pos > 50 { abs_pos - 50 } else { 0 };
            let window_end = (abs_pos + 512).min(html.len());
            let window = &html[window_start..window_end];

            // Extract the URL from content="..."
            let content_search = if attr.is_empty() {
                // JSON-LD style: "thumbnailUrl":"https://..."
                &[format!("\"{key}\":\"https"), format!("\"{key}\": \"https")][..]
            } else {
                &[format!("content=\"")][..]
            };

            for cs in content_search {
                if let Some(cpos) = window.find(cs.as_str()) {
                    let after = &window[cpos + cs.len()..];
                    // For JSON-LD, skip to actual URL start
                    let url_start = if attr.is_empty() {
                        if after.starts_with("https") { 0 } else { after.find("https")? }
                    } else {
                        0
                    };
                    let url_str = &after[url_start..];
                    let end = url_str.find(|c| c == '"' || c == '\'').unwrap_or(url_str.len());
                    let candidate = url_str[..end].trim();
                    if candidate.starts_with("http") && candidate.len() > 10 {
                        return Some(candidate.to_string());
                    }
                }
            }

            search_pos = abs_pos + key.len();
        }
    }

    None
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

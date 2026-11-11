/**
 * Storage and I/O module for Taboret.
 * Provides seamless folder-based saving and loading with user-accessible files.
 * Works natively in Tauri desktop and falls back gracefully in web browsers.
 */

export const isTauri = () =>
  typeof window !== "undefined" &&
  Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

/**
 * Prompt user to select a folder for opening a Mood Board.
 */
export async function pickFolder() {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      // Pick the board FOLDER directly — the Rust backend reads board.json inside it.
      // We use directory:true so users pick the folder (the board), not the json file.
      // The Rust read_board_from_folder also accepts a json file path as fallback.
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Open Board Directory — Select folder containing board.json",
      });
      return selected || null;
    } catch (err) {
      console.error("Tauri pickFolder error:", err);
    }
  }

  // Web File System Access API fallback (Chromium, Edge)
  if (typeof window.showDirectoryPicker === "function") {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      return dirHandle;
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("showDirectoryPicker error:", err);
      }
    }
  }

  // Fallback for browsers without showDirectoryPicker (Firefox, Safari)
  return await pickDirectoryViaInput();
}

/**
 * Prompt user to pick media files (images/videos) natively in Tauri.
 * Returns an array of file path strings, or null if not in Tauri.
 */
export async function pickMediaFiles() {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Images & Videos",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
              "svg",
              "avif",
              "mp4",
              "webm",
            ],
          },
        ],
        title: "Import Media — Choose images or videos",
      });
      if (!selected) return [];
      return Array.isArray(selected) ? selected : [selected];
    } catch (err) {
      console.error("Tauri pickMediaFiles error:", err);
      return [];
    }
  }
  return null;
}

function pickDirectoryViaInput() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,image/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = () => {
      const files = Array.from(input.files || []);
      input.remove();
      if (files.length > 0) {
        resolve({ isHtmlFileInput: true, files });
      } else {
        resolve(null);
      }
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    input.click();
  });
}

/**
 * Prompt user to select or create a folder for saving a new Mood Board.
 */
export async function pickSaveFolder() {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      // Pick a folder to save the board INTO.
      // The Rust backend will write board.json + media/ inside this folder.
      // Using a folder dialog (not a file-save dialog) is less confusing since
      // the user is choosing where the board FOLDER lives, not a specific file.
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Save Board Directory — Select or create the board folder",
      });
      return selected || null;
    } catch (err) {
      console.error("Tauri pickSaveFolder error:", err);
    }
  }

  if (typeof window.showDirectoryPicker === "function") {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      return dirHandle;
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("showDirectoryPicker error:", err);
      }
      return null;
    }
  }

  // Fallback for browsers without showDirectoryPicker: download board.json
  return { isFallbackDownload: true };
}

/**
 * Read board and all media from a local folder.
 */
export async function readBoard(folderHandleOrPath) {
  if (!folderHandleOrPath) {
    throw new Error("No folder specified");
  }

  if (isTauri() && typeof folderHandleOrPath === "string") {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("read_board_from_folder", {
      folderPath: folderHandleOrPath,
    });

    const parsedJson = JSON.parse(result.board_json);
    const mediaMap = new Map();
    for (const item of result.media_files) {
      mediaMap.set(`media/${item.filename}`, item.data_url);
      mediaMap.set(item.filename, item.data_url);
    }

    return {
      folderPath: folderHandleOrPath,
      boardData: parsedJson,
      mediaMap,
    };
  }

  // Web File System Access API fallback
  if (folderHandleOrPath.getFileHandle) {
    const dirHandle = folderHandleOrPath;
    const boardFileHandle = await dirHandle.getFileHandle("board.json");
    const boardFile = await boardFileHandle.getFile();
    const boardText = await boardFile.text();
    const parsedJson = JSON.parse(boardText);

    const mediaMap = new Map();
    try {
      const mediaDirHandle = await dirHandle.getDirectoryHandle("media");
      for await (const [name, handle] of mediaDirHandle.entries()) {
        if (handle.kind === "file") {
          const file = await handle.getFile();
          const dataUrl = await fileToDataUrl(file);
          mediaMap.set(`media/${name}`, dataUrl);
          mediaMap.set(name, dataUrl);
        }
      }
    } catch (e) {
      console.warn("No media directory found in folder:", e);
    }

    return {
      folderHandle: dirHandle,
      folderPath: dirHandle.name,
      boardData: parsedJson,
      mediaMap,
    };
  }

  // Fallback: Opened via HTML directory file input
  if (folderHandleOrPath.isHtmlFileInput) {
    const files = folderHandleOrPath.files;
    const boardFile = files.find(
      (f) =>
        f.name === "board.json" ||
        f.webkitRelativePath?.endsWith("/board.json"),
    );
    if (!boardFile) {
      throw new Error("No board.json found in the selected folder.");
    }
    const boardText = await boardFile.text();
    const parsedJson = JSON.parse(boardText);
    const mediaMap = new Map();

    for (const f of files) {
      if (f.name === "board.json") continue;
      const dataUrl = await fileToDataUrl(f);
      const relPath = f.webkitRelativePath
        ? f.webkitRelativePath.split("/").slice(1).join("/")
        : f.name;
      mediaMap.set(relPath, dataUrl);
      mediaMap.set(`media/${f.name}`, dataUrl);
      mediaMap.set(f.name, dataUrl);
    }

    const folderName =
      files[0].webkitRelativePath?.split("/")[0] || "Imported Board";
    return {
      folderHandle: folderHandleOrPath,
      folderPath: folderName,
      boardData: parsedJson,
      mediaMap,
    };
  }

  throw new Error("Unsupported folder target");
}

/**
 * Save board structure and media items into a local folder.
 * Media items are saved directly into the user-accessible `media/` subfolder.
 */
export async function saveBoard(folderHandleOrPath, boardData, mediaItems) {
  if (!folderHandleOrPath) {
    throw new Error("No destination folder selected");
  }

  const jsonString = JSON.stringify(boardData, null, 2);

  if (isTauri() && typeof folderHandleOrPath === "string") {
    const { invoke } = await import("@tauri-apps/api/core");

    const payload = mediaItems
      .filter((m) => m.type !== "text")
      .map((m) => {
        const filename = m.filename.startsWith("media/")
          ? m.filename.replace(/^media\//, "")
          : m.filename;
        return {
          filename,
          data_url: m.dataUrl || null,
          source_path: m.sourcePath || null,
        };
      });

    await invoke("save_board_to_folder", {
      folderPath: folderHandleOrPath,
      boardJson: jsonString,
      mediaFiles: payload,
    });

    return { success: true, folderPath: folderHandleOrPath };
  }

  // Web File System Access API fallback
  if (folderHandleOrPath.getFileHandle) {
    const dirHandle = folderHandleOrPath;
    const boardFileHandle = await dirHandle.getFileHandle("board.json", {
      create: true,
    });
    const writable = await boardFileHandle.createWritable();
    await writable.write(jsonString);
    await writable.close();

    const mediaDirHandle = await dirHandle.getDirectoryHandle("media", {
      create: true,
    });

    for (const m of mediaItems) {
      if (m.type === "text" || !m.dataUrl) continue;
      const filename = m.filename.startsWith("media/")
        ? m.filename.replace(/^media\//, "")
        : m.filename;

      const fileHandle = await mediaDirHandle.getFileHandle(filename, {
        create: true,
      });
      const fileWritable = await fileHandle.createWritable();
      const blob = dataUrlToBlob(m.dataUrl);
      await fileWritable.write(blob);
      await fileWritable.close();
    }

    return { success: true, folderPath: dirHandle.name };
  }

  // Fallback download if directory writing isn't supported in browser
  if (
    folderHandleOrPath.isFallbackDownload ||
    folderHandleOrPath.isHtmlFileInput
  ) {
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "board.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { success: true, folderPath: "board.json (Downloaded)" };
  }

  throw new Error("Failed to save: Invalid folder handle");
}

/**
 * Fetch remote media (e.g. dropped from Pinterest, Artstation, Google Images).
 * Bypasses CORS via Tauri backend if available, or falls back to fetch.
 */
export async function fetchRemoteMedia(url) {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke("fetch_remote_media", { url });
      return {
        filename: result.filename,
        dataUrl: result.data_url,
        mimeType: result.mime_type,
      };
    } catch (err) {
      console.warn("Tauri remote fetch failed, trying browser fetch:", err);
    }
  }

  // Browser fetch fallback
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to fetch media: ${response.statusText}`);
  }
  const blob = await response.blob();
  const dataUrl = await fileToDataUrl(blob);
  const ext = blob.type.split("/")[1]?.split("+")[0] || "jpg";
  const filename = `web_media_${Date.now()}.${ext}`;

  return {
    filename,
    dataUrl,
    mimeType: blob.type,
  };
}

/**
 * Read local media file dropped from user's computer.
 */
export async function readLocalFile(fileOrPath) {
  if (isTauri() && typeof fileOrPath === "string") {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("read_local_media_file", {
      filePath: fileOrPath,
    });
    return {
      filename: result.filename,
      dataUrl: result.data_url,
      mimeType: result.mime_type,
      sourcePath: fileOrPath,
    };
  }

  if (fileOrPath instanceof File || fileOrPath instanceof Blob) {
    const file = fileOrPath;
    const dataUrl = await fileToDataUrl(file);
    const filename = file.name || `local_media_${Date.now()}.png`;
    return {
      filename,
      dataUrl,
      mimeType: file.type,
      sourcePath: file.path || null,
    };
  }

  throw new Error("Invalid file object");
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

export function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "tiff", "tif", "cr2", "cr3", "arw", "nef", "orf", "rw2", "dng", "heic", "heif",
    "sr2", "srf", "srw", "pef", "raf", "3fr", "kdc", "dcr", "erf", "mef", "mrw", "nrw", "ptx",
    "r3d", "rw1", "x3f",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExifInfo {
    pub shooting_time: String,
    pub camera_model: String,
    pub lens: String,
    pub new_filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExifDetail {
    pub shooting_date: String,
    pub manufacturer: String,
    pub camera: String,
    pub lens: String,
    pub focal_length: String,
    pub aperture: String,
    pub shutter: String,
    pub iso: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub filename: String,
    pub shooting_time: String,
    pub camera_model: String,
    pub lens: String,
    pub new_filename: String,
    pub final_filename: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewData {
    pub preview_type: String,
    pub asset_url: String,
    pub image_base64: String,
    pub file_info: FileInfo,
    pub exif_detail: ExifDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub filename: String,
    pub created_date: String,
    pub file_dir: String,
    pub file_size: u64,
}

pub struct RenameState {
    pub original_names: HashMap<String, String>,
}

impl RenameState {
    pub fn new() -> Self {
        RenameState {
            original_names: HashMap::new(),
        }
    }

    pub fn record_original(&mut self, path: &str) {
        let filename = Path::new(path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        self.original_names.insert(path.to_string(), filename);
    }

    pub fn update_path(&mut self, old_path: &str, new_path: &str) {
        if let Some(original) = self.original_names.remove(old_path) {
            self.original_names.insert(new_path.to_string(), original);
        }
    }

    pub fn get_original(&self, path: &str) -> Option<&String> {
        self.original_names.get(path)
    }
}

pub fn is_photo_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn get_photo_files_from_folder(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(folder).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && is_photo_file(path) {
            files.push(path.to_path_buf());
        }
    }
    files.sort();
    files
}

pub fn get_file_info(path: &Path) -> FileInfo {
    let filename = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_dir = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let created_date = fs::metadata(path)
        .and_then(|m| m.created())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Local> = t.into();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|_| "未知".to_string());
    let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    FileInfo {
        filename,
        created_date,
        file_dir,
        file_size,
    }
}

pub fn compute_final_filenames(entries: &mut Vec<FileEntry>) {
    let mut name_count: HashMap<String, usize> = HashMap::new();
    let new_names: Vec<String> = entries.iter().map(|e| e.new_filename.clone()).collect();

    for name in &new_names {
        *name_count.entry(name.clone()).or_insert(0) += 1;
    }

    let mut assigned: HashMap<String, usize> = HashMap::new();
    for entry in entries.iter_mut() {
        let count = name_count.get(&entry.new_filename).copied().unwrap_or(1);
        if count > 1 {
            let idx = assigned.entry(entry.new_filename.clone()).or_insert(0);
            *idx += 1;
            let path = PathBuf::from(&entry.path);
            let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let stem = Path::new(&entry.new_filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            entry.final_filename = format!("{}_{}.{}", stem, *idx, extension);
        } else {
            entry.final_filename = entry.new_filename.clone();
        }
    }
}

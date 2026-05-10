use crate::models::{ExifDetail, ExifInfo};
use chrono::NaiveDateTime;
use exif::{In, Tag, Value};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

pub fn read_exif_info(path: &Path) -> ExifInfo {
    match read_exif_primary(path) {
        Some(info) => info,
        None => read_exif_fallback(path),
    }
}

fn read_exif_primary(path: &Path) -> Option<ExifInfo> {
    let file = File::open(path).ok()?;
    let mut buf_reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();

    let exif_data = match exif_reader.read_from_container(&mut buf_reader) {
        Ok(data) => data,
        Err(_) => return None,
    };

    extract_exif_info(path, &exif_data)
}

fn extract_exif_info(path: &Path, exif_data: &exif::Exif) -> Option<ExifInfo> {
    let date_time_str = get_field_string(exif_data, Tag::DateTimeOriginal)
        .or_else(|| get_field_string(exif_data, Tag::DateTime));

    if let Some(dt_str) = date_time_str {
        if let Some((formatted_date, shooting_time)) = parse_exif_datetime(&dt_str) {
            let camera_model =
                get_field_string(exif_data, Tag::Model).unwrap_or_else(|| "未知型号".to_string());
            let lens =
                get_field_string(exif_data, Tag::LensModel).unwrap_or_else(|| "未知镜头".to_string());

            let extension = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            let new_filename = format!("{}.{}", formatted_date, extension);

            return Some(ExifInfo {
                shooting_time,
                camera_model,
                lens,
                new_filename,
            });
        }
    }
    None
}

fn read_exif_fallback(path: &Path) -> ExifInfo {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let raw_extensions = [
        "arw", "cr2", "cr3", "nef", "orf", "rw2", "sr2", "srf", "srw", "pef", "raf",
        "3fr", "kdc", "dcr", "erf", "mef", "mrw", "nrw", "r3d", "rw1", "x3f",
    ];

    if raw_extensions.contains(&extension.as_str()) {
        if let Some(info) = read_raw_exif(path) {
            return info;
        }
    }

    use_file_mtime(path)
}

fn read_raw_exif(path: &Path) -> Option<ExifInfo> {
    let file = File::open(path).ok()?;
    let mut buf_reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();

    let exif_data = match exif_reader.read_from_container(&mut buf_reader) {
        Ok(data) => data,
        Err(_) => return None,
    };

    extract_exif_info(path, &exif_data)
}

fn use_file_mtime(path: &Path) -> ExifInfo {
    let mtime = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let dt: chrono::DateTime<chrono::Local> = mtime.into();
    let formatted_date = dt.format("%Y-%m-%d %H-%M-%S").to_string();
    let shooting_time = format!("使用文件修改时间: {}", dt.format("%Y-%m-%d %H:%M:%S"));

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let new_filename = format!("{}.{}", formatted_date, extension);

    ExifInfo {
        shooting_time,
        camera_model: "未知型号".to_string(),
        lens: "未知镜头".to_string(),
        new_filename,
    }
}

pub fn read_exif_detail(path: &Path) -> ExifDetail {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return empty_detail(),
    };
    let mut buf_reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();

    let exif_data = match exif_reader.read_from_container(&mut buf_reader) {
        Ok(data) => data,
        Err(_) => return empty_detail(),
    };

    let shooting_date = get_field_string(&exif_data, Tag::DateTimeOriginal)
        .or_else(|| get_field_string(&exif_data, Tag::DateTime))
        .and_then(|s| parse_exif_datetime(&s).map(|(_, t)| t))
        .unwrap_or_else(|| "无信息".to_string());

    let manufacturer =
        get_field_string(&exif_data, Tag::Make).unwrap_or_else(|| "无信息".to_string());
    let camera =
        get_field_string(&exif_data, Tag::Model).unwrap_or_else(|| "无信息".to_string());

    let lens = get_field_string(&exif_data, Tag::LensModel)
        .unwrap_or_else(|| "无信息".to_string());

    let focal_length = exif_data
        .get_field(Tag::FocalLength, In::PRIMARY)
        .map(|f| format_focal_length(f))
        .unwrap_or_else(|| "无信息".to_string());

    let aperture = exif_data
        .get_field(Tag::FNumber, In::PRIMARY)
        .map(|f| format_aperture(f))
        .or_else(|| {
            exif_data
                .get_field(Tag::ApertureValue, In::PRIMARY)
                .map(|f| format_aperture_from_av(f))
        })
        .unwrap_or_else(|| "无信息".to_string());

    let shutter = exif_data
        .get_field(Tag::ExposureTime, In::PRIMARY)
        .map(|f| format_shutter(f))
        .or_else(|| {
            exif_data
                .get_field(Tag::ShutterSpeedValue, In::PRIMARY)
                .map(|f| format_shutter_from_ssv(f))
        })
        .unwrap_or_else(|| "无信息".to_string());

    let iso = exif_data
        .get_field(Tag::PhotographicSensitivity, In::PRIMARY)
        .or_else(|| exif_data.get_field(Tag::ISOSpeed, In::PRIMARY))
        .map(|f| f.display_value().to_string())
        .unwrap_or_else(|| "无信息".to_string());

    ExifDetail {
        shooting_date,
        manufacturer,
        camera,
        lens,
        focal_length,
        aperture,
        shutter,
        iso,
    }
}

fn empty_detail() -> ExifDetail {
    ExifDetail {
        shooting_date: "无信息".to_string(),
        manufacturer: "无信息".to_string(),
        camera: "无信息".to_string(),
        lens: "无信息".to_string(),
        focal_length: "无信息".to_string(),
        aperture: "无信息".to_string(),
        shutter: "无信息".to_string(),
        iso: "无信息".to_string(),
    }
}

fn get_field_string(exif_data: &exif::Exif, tag: Tag) -> Option<String> {
    exif_data
        .get_field(tag, In::PRIMARY)
        .map(|f| f.display_value().to_string())
}

fn parse_exif_datetime(dt_str: &str) -> Option<(String, String)> {
    let cleaned = dt_str.trim();
    let formats = ["%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"];

    for fmt in &formats {
        if let Ok(dt) = NaiveDateTime::parse_from_str(cleaned, fmt) {
            let formatted_date = dt.format("%Y-%m-%d %H-%M-%S").to_string();
            let shooting_time = dt.format("%Y-%m-%d %H:%M:%S").to_string();
            return Some((formatted_date, shooting_time));
        }
    }
    None
}

fn format_focal_length(field: &exif::Field) -> String {
    match &field.value {
        Value::Rational(ref vec) if !vec.is_empty() => {
            let r = vec[0];
            let val = r.num as f64 / r.denom as f64;
            format!("{:.0}mm", val)
        }
        _ => field.display_value().to_string(),
    }
}

fn format_aperture(field: &exif::Field) -> String {
    match &field.value {
        Value::Rational(ref vec) if !vec.is_empty() => {
            let r = vec[0];
            let val = r.num as f64 / r.denom as f64;
            format!("f/{:.1}", val)
        }
        _ => field.display_value().to_string(),
    }
}

fn format_aperture_from_av(field: &exif::Field) -> String {
    match &field.value {
        Value::Rational(ref vec) if !vec.is_empty() => {
            let r = vec[0];
            let av = r.num as f64 / r.denom as f64;
            let f_val = 2f64.powf(av / 2.0);
            format!("f/{:.1}", f_val)
        }
        _ => field.display_value().to_string(),
    }
}

fn format_shutter(field: &exif::Field) -> String {
    match &field.value {
        Value::Rational(ref vec) if !vec.is_empty() => {
            let r = vec[0];
            let val = r.num as f64 / r.denom as f64;
            if val < 1.0 && val > 0.0 {
                format!("1/{} 秒", (1.0 / val) as u32)
            } else {
                format!("{:.1} 秒", val)
            }
        }
        _ => field.display_value().to_string(),
    }
}

fn format_shutter_from_ssv(field: &exif::Field) -> String {
    match &field.value {
        Value::Rational(ref vec) if !vec.is_empty() => {
            let r = vec[0];
            let ssv = r.num as f64 / r.denom as f64;
            let val = 2f64.powf(-ssv);
            if val < 1.0 && val > 0.0 {
                format!("1/{} 秒", (1.0 / val) as u32)
            } else {
                format!("{:.1} 秒", val)
            }
        }
        _ => field.display_value().to_string(),
    }
}

pub fn is_raw_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let raw_extensions = [
        "arw", "cr2", "cr3", "nef", "orf", "rw2", "sr2", "srf", "srw", "pef", "raf",
        "3fr", "kdc", "dcr", "erf", "mef", "mrw", "nrw", "r3d", "rw1", "x3f", "dng",
    ];

    raw_extensions.contains(&extension.as_str())
}

pub fn extract_embedded_jpeg(path: &Path) -> Option<Vec<u8>> {
    let mut file = File::open(path).ok()?;
    let file_size = file.metadata().ok()?.len() as usize;

    let search_size = file_size.min(2 * 1024 * 1024);
    let tail_start = if file_size > 2 * 1024 * 1024 {
        file_size - 2 * 1024 * 1024
    } else {
        0
    };

    let mut data = Vec::with_capacity(search_size);
    if tail_start > 0 {
        file.seek(SeekFrom::Start(tail_start as u64)).ok()?;
    }
    file.read_to_end(&mut data).ok()?;

    let jpeg_start = find_last_jpeg_start(&data)?;
    let jpeg_end = find_jpeg_end(&data[jpeg_start..])?;

    Some(data[jpeg_start..jpeg_start + jpeg_end].to_vec())
}

fn find_last_jpeg_start(data: &[u8]) -> Option<usize> {
    let mut last_pos = None;
    let mut i = 0;
    while i + 1 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0xD8 {
            last_pos = Some(i);
        }
        i += 1;
    }
    last_pos
}

fn find_jpeg_end(data: &[u8]) -> Option<usize> {
    let mut i = 0;
    while i + 1 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0xD9 {
            return Some(i + 2);
        }
        i += 1;
    }
    None
}

pub fn generate_preview_base64(path: &Path) -> Option<String> {
    if is_raw_file(path) {
        if let Some(jpeg_data) = extract_embedded_jpeg(path) {
            if let Ok(img) = image::load_from_memory(&jpeg_data) {
                let thumb = img.thumbnail(400, 300);
                let mut buf = Vec::new();
                let mut cursor = std::io::Cursor::new(&mut buf);
                thumb
                    .write_to(&mut cursor, image::ImageFormat::Jpeg)
                    .ok()?;
                return Some(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &buf,
                ));
            }
        }
    }

    let img = image::open(path).ok()?;
    let thumb = img.thumbnail(400, 300);
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    thumb
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .ok()?;
    Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &buf,
    ))
}

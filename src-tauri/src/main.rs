#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};
use tauri::Emitter;
use walkdir::WalkDir;
use rosu_pp::{Beatmap, Difficulty};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileStatPayload {
    mtime_ms: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OsuFilePayload {
    file_path: String,
    content: String,
    stat: FileStatPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenOsuFilePayload {
    files: Vec<OsuFilePayload>,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ParsedMetadata {
    title: String,
    artist: String,
    creator: String,
    version: String,
    mode: i32,
    audio: String,
    background: String,
    #[serde(rename = "beatmapSetID")]
    beatmap_set_id: String,
    preview_time: i32,
    star_rating: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TimeRange {
    start: i32,
    end: i32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanFilePayload {
    file_path: String,
    stat: FileStatPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    unchanged: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<ParsedMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hit_starts: Option<Vec<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hit_ends: Option<Vec<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    break_periods: Option<Vec<TimeRange>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bookmarks: Option<Vec<i32>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanDirectoryPayload {
    files: Vec<ScanFilePayload>,
    directory: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfoPayload {
    current_version: String,
    latest_version: String,
    html_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbedSyncPayload {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OsuUserData {
    id: String,
    names: Vec<String>,
}

#[derive(Debug)]
struct ParsedOsu {
    metadata: ParsedMetadata,
    hit_starts: Vec<i32>,
    hit_ends: Vec<i32>,
    break_periods: Vec<TimeRange>,
    bookmarks: Vec<i32>,
}

fn get_mtime_ms(path: &Path) -> Result<f64, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified = metadata.modified().map_err(|err| err.to_string())?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0));
    Ok(duration.as_secs_f64() * 1000.0)
}

fn get_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn normalize_metadata(mut metadata: ParsedMetadata) -> ParsedMetadata {
    if metadata.title.is_empty() {
        metadata.title = "Unknown Title".to_string();
    }
    if metadata.artist.is_empty() {
        metadata.artist = "Unknown Artist".to_string();
    }
    if metadata.creator.is_empty() {
        metadata.creator = "Unknown Creator".to_string();
    }
    if metadata.version.is_empty() {
        metadata.version = "Unknown Version".to_string();
    }
    if metadata.beatmap_set_id.is_empty() {
        metadata.beatmap_set_id = "Unknown".to_string();
    }
    metadata.mode = metadata.mode.clamp(0, 3);
    metadata
}

/// Get the Nth comma-separated field from a line without allocating a Vec.
/// Returns None if there aren't enough fields.
#[inline(always)]
fn csv_field(line: &str, n: usize) -> Option<&str> {
    let mut start = 0;
    let bytes = line.as_bytes();
    let len = bytes.len();
    for _ in 0..n {
        match memchr_comma(bytes, start) {
            Some(pos) => start = pos + 1,
            None => return None,
        }
    }
    let end = memchr_comma(bytes, start).unwrap_or(len);
    Some(&line[start..end])
}

/// Fast comma search from a given start position.
#[inline(always)]
fn memchr_comma(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i < bytes.len() {
        if bytes[i] == b',' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Count comma-separated fields without allocating.
#[inline(always)]
fn csv_field_count(line: &str) -> usize {
    if line.is_empty() {
        return 0;
    }
    line.as_bytes().iter().filter(|&&b| b == b',').count() + 1
}

/// Case-insensitive ASCII comparison without allocating.
#[inline(always)]
fn eq_ascii_ci(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.as_bytes().iter().zip(b.as_bytes()).all(|(x, y)| x.to_ascii_lowercase() == y.to_ascii_lowercase())
}

/// Check if a string ends with one of the image extensions (case-insensitive).
#[inline]
fn is_image_ext(s: &str) -> bool {
    let s_lower_bytes = s.as_bytes();
    let len = s_lower_bytes.len();
    if len < 4 {
        return false;
    }
    // Check last 4-5 chars
    let last4 = &s[len.saturating_sub(4)..];
    let last5 = if len >= 5 { &s[len - 5..] } else { "" };
    eq_ascii_ci(last4, ".jpg") || eq_ascii_ci(last4, ".png") || eq_ascii_ci(last4, ".gif") || eq_ascii_ci(last4, ".bmp")
        || eq_ascii_ci(last5, ".jpeg") || eq_ascii_ci(last5, ".webp")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OsuSection {
    None,
    General,
    Editor,
    Metadata,
    Difficulty,
    Events,
    TimingPoints,
    HitObjects,
    Other,
}

impl OsuSection {
    fn from_header(header: &str) -> Self {
        // header is the text between [ and ]
        if eq_ascii_ci(header, "General") { OsuSection::General }
        else if eq_ascii_ci(header, "Editor") { OsuSection::Editor }
        else if eq_ascii_ci(header, "Metadata") { OsuSection::Metadata }
        else if eq_ascii_ci(header, "Difficulty") { OsuSection::Difficulty }
        else if eq_ascii_ci(header, "Events") { OsuSection::Events }
        else if eq_ascii_ci(header, "TimingPoints") { OsuSection::TimingPoints }
        else if eq_ascii_ci(header, "HitObjects") { OsuSection::HitObjects }
        else { OsuSection::Other }
    }
}

fn parse_osu_content(content: &str) -> ParsedOsu {
    let mut metadata = ParsedMetadata {
        preview_time: -1,
        star_rating: -1.0,
        ..Default::default()
    };

    let mut section = OsuSection::None;
    let mut slider_multiplier = 1.0_f64;
    let mut timing_points: Vec<(i32, f64, bool)> = Vec::with_capacity(64);
    let mut hit_starts: Vec<i32> = Vec::with_capacity(512);
    let mut hit_ends: Vec<i32> = Vec::with_capacity(512);
    let mut hit_types: Vec<i32> = Vec::with_capacity(512);
    let mut break_periods: Vec<TimeRange> = Vec::with_capacity(8);
    let mut bookmarks: Vec<i32> = Vec::with_capacity(32);

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let bytes = trimmed.as_bytes();

        // Skip comments
        if bytes.len() >= 2 && bytes[0] == b'/' && bytes[1] == b'/' {
            continue;
        }

        // Section header
        if bytes[0] == b'[' && bytes[bytes.len() - 1] == b']' {
            section = OsuSection::from_header(&trimmed[1..trimmed.len() - 1]);
            continue;
        }

        match section {
            OsuSection::Metadata => {
                if let Some((key, value)) = trimmed.split_once(':') {
                    let key = key.trim();
                    let value = value.trim();
                    if eq_ascii_ci(key, "Title") {
                        metadata.title = value.to_string();
                    } else if eq_ascii_ci(key, "Artist") {
                        metadata.artist = value.to_string();
                    } else if eq_ascii_ci(key, "Creator") {
                        metadata.creator = value.to_string();
                    } else if eq_ascii_ci(key, "Version") {
                        metadata.version = value.to_string();
                    } else if eq_ascii_ci(key, "BeatmapSetID") {
                        if let Ok(id) = value.parse::<i32>() {
                            if id > 0 {
                                metadata.beatmap_set_id = format!("https://osu.ppy.sh/beatmapsets/{id}");
                            } else {
                                metadata.beatmap_set_id = value.to_string();
                            }
                        } else {
                            metadata.beatmap_set_id = value.to_string();
                        }
                    }
                }
            }
            OsuSection::General => {
                if let Some((key, value)) = trimmed.split_once(':') {
                    let key = key.trim();
                    let value = value.trim();
                    if eq_ascii_ci(key, "AudioFilename") {
                        metadata.audio = value.to_string();
                    } else if eq_ascii_ci(key, "PreviewTime") {
                        if let Ok(v) = value.parse::<i32>() {
                            metadata.preview_time = v;
                        }
                    } else if eq_ascii_ci(key, "Mode") {
                        if let Ok(v) = value.parse::<i32>() {
                            metadata.mode = v;
                        }
                    }
                }
            }
            OsuSection::Difficulty => {
                if let Some((key, value)) = trimmed.split_once(':') {
                    if eq_ascii_ci(key.trim(), "SliderMultiplier") {
                        slider_multiplier = value.trim().parse::<f64>().unwrap_or(1.0);
                    }
                }
            }
            OsuSection::TimingPoints => {
                let field_count = csv_field_count(trimmed);
                if field_count >= 2 {
                    let time = csv_field(trimmed, 0).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
                    let beat_length = csv_field(trimmed, 1).unwrap_or("500").trim().parse::<f64>().unwrap_or(500.0);
                    let uninherited = if field_count >= 7 {
                        csv_field(trimmed, 6).map(|v| v.trim() == "1").unwrap_or(true)
                    } else {
                        true
                    };
                    timing_points.push((time, beat_length, uninherited));
                }
            }
            OsuSection::Events => {
                let field_count = csv_field_count(trimmed);
                if field_count >= 3 {
                    let f0 = csv_field(trimmed, 0).unwrap_or("").trim();
                    if f0 == "2" || eq_ascii_ci(f0, "Break") {
                        let start = csv_field(trimmed, 1).unwrap_or("").trim().parse::<i32>().unwrap_or(-1);
                        let end = csv_field(trimmed, 2).unwrap_or("").trim().parse::<i32>().unwrap_or(-1);
                        if start >= 0 && end > start {
                            break_periods.push(TimeRange { start, end });
                        }
                    }
                    if f0 == "0" && metadata.background.is_empty() {
                        let candidate = csv_field(trimmed, 2).unwrap_or("").trim().trim_matches('"');
                        if is_image_ext(candidate) {
                            metadata.background = candidate.to_string();
                        }
                    }
                }
            }
            OsuSection::Editor => {
                if let Some((key, value)) = trimmed.split_once(':') {
                    if eq_ascii_ci(key.trim(), "Bookmarks") {
                        bookmarks = value
                            .split(',')
                            .filter_map(|chunk| chunk.trim().parse::<i32>().ok())
                            .collect();
                    }
                }
            }
            OsuSection::HitObjects => {
                let field_count = csv_field_count(trimmed);
                if field_count < 4 {
                    continue;
                }
                let start_time = csv_field(trimmed, 2).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
                let obj_type = csv_field(trimmed, 3).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
                let mut end_time = start_time;

                if obj_type & 2 != 0 {
                    // Slider
                    if field_count >= 8 {
                        let slides = csv_field(trimmed, 6).unwrap_or("1").trim().parse::<f64>().unwrap_or(1.0);
                        let length = csv_field(trimmed, 7).unwrap_or("0").trim().parse::<f64>().unwrap_or(0.0);

                        let mut active_beat = 60000.0 / 120.0;
                        let mut active_sv = 1.0;
                        for &(tp_time, beat_length, uninherited) in &timing_points {
                            if tp_time > start_time {
                                break;
                            }
                            if uninherited {
                                active_beat = beat_length;
                                active_sv = 1.0;
                            } else if beat_length < 0.0 {
                                active_sv = -100.0 / beat_length;
                            }
                        }

                        let duration =
                            (length / (slider_multiplier * 100.0 * active_sv)) * active_beat * slides;
                        end_time = start_time + duration.max(0.0).floor() as i32;
                    }
                } else if obj_type & 8 != 0 {
                    // Spinner
                    if field_count >= 6 {
                        end_time = csv_field(trimmed, 5).unwrap_or("").trim().parse::<i32>().unwrap_or(start_time);
                    }
                } else if obj_type & 128 != 0 {
                    // Mania hold
                    if field_count >= 6 {
                        end_time = csv_field(trimmed, 5)
                            .unwrap_or("")
                            .split(':')
                            .next()
                            .and_then(|v| v.trim().parse::<i32>().ok())
                            .unwrap_or(start_time);
                    }
                }

                if let Some(prev_type) = hit_types.last() {
                    if prev_type & 2 != 0 {
                        if let Some(prev_end) = hit_ends.last_mut() {
                            if *prev_end < start_time {
                                *prev_end = start_time;
                            }
                        }
                    }
                }

                hit_starts.push(start_time);
                hit_ends.push(end_time.max(start_time));
                hit_types.push(obj_type);
            }
            _ => {}
        }
    }

    ParsedOsu {
        metadata: normalize_metadata(metadata),
        hit_starts,
        hit_ends,
        break_periods,
        bookmarks,
    }
}

fn parse_header_creator_and_version(content: &str) -> (String, String) {
    let mut in_metadata = false;
    let mut creator = String::new();
    let mut version = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let bytes = trimmed.as_bytes();
        if bytes.len() >= 2 && bytes[0] == b'/' && bytes[1] == b'/' {
            continue;
        }
        if bytes[0] == b'[' && bytes[bytes.len() - 1] == b']' {
            let header = &trimmed[1..trimmed.len() - 1];
            in_metadata = eq_ascii_ci(header, "Metadata");
            // If we already found both values and left metadata, stop
            if !in_metadata && !creator.is_empty() && !version.is_empty() {
                break;
            }
            continue;
        }
        if in_metadata {
            if let Some((key, value)) = trimmed.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                if eq_ascii_ci(key, "Creator") {
                    creator = value.to_string();
                } else if eq_ascii_ci(key, "Version") {
                    version = value.to_string();
                }
                if !creator.is_empty() && !version.is_empty() {
                    break;
                }
            }
        }
    }

    (creator, version)
}

/// Discover .osu files and their mtimes in a single pass using WalkDir metadata.
/// Returns (path_string, mtime_ms) pairs to avoid redundant fs::metadata calls.
fn find_osu_files_with_mtime(root: &Path) -> Vec<(String, f64)> {
    let mut results = Vec::with_capacity(4096);
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_osu = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("osu"))
            .unwrap_or(false);
        if !is_osu {
            continue;
        }
        // Use entry metadata (already fetched by WalkDir) to get mtime
        let mtime_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        results.push((path.to_string_lossy().to_string(), mtime_ms));
    }
    results
}

/// Process a single .osu file. `mtime_ms` is pre-fetched from WalkDir.
fn scan_single_osu_file(
    file_path: &str,
    mtime_ms: f64,
    known: &HashMap<String, f64>,
    mappers: &[String],
) -> Option<ScanFilePayload> {
    let has_mapper = !mappers.is_empty();

    // Fast path: check cache by mtime
    if let Some(cached_mtime) = known.get(file_path) {
        if (cached_mtime - mtime_ms).abs() < 0.5 {
            if has_mapper {
                // Only read first 8KB header for mapper filter on cached files
                let path = Path::new(file_path);
                if let Ok(file) = fs::File::open(path) {
                    let mut reader = BufReader::with_capacity(8192, file);
                    let mut buf = Vec::with_capacity(8192);
                    let _ = reader.by_ref().take(8192).read_to_end(&mut buf);
                    let header = String::from_utf8_lossy(&buf);
                    let (creator, version) = parse_header_creator_and_version(&header);
                    let creator_lower = creator.to_ascii_lowercase();
                    let version_lower = version.to_ascii_lowercase();
                    if !mappers.iter().any(|m| creator_lower.contains(m) || version_lower.contains(m)) {
                        return None;
                    }
                } else {
                    return None;
                }
            }

            return Some(ScanFilePayload {
                file_path: file_path.to_string(),
                stat: FileStatPayload { mtime_ms },
                unchanged: Some(true),
                metadata: None,
                hit_starts: None,
                hit_ends: None,
                break_periods: None,
                bookmarks: None,
            });
        }
    }

    // Full parse path: read entire file with buffered I/O
    let path = Path::new(file_path);
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::with_capacity(32768, file);
    let mut content = String::with_capacity(32768);
    reader.read_to_string(&mut content).ok()?;

    let parsed = parse_osu_content(&content);

    if has_mapper {
        let creator = parsed.metadata.creator.to_ascii_lowercase();
        let version = parsed.metadata.version.to_ascii_lowercase();
        if !mappers.iter().any(|m| creator.contains(m) || version.contains(m)) {
            return None;
        }
    }

    Some(ScanFilePayload {
        file_path: file_path.to_string(),
        stat: FileStatPayload { mtime_ms },
        unchanged: None,
        metadata: Some(parsed.metadata),
        hit_starts: Some(parsed.hit_starts),
        hit_ends: Some(parsed.hit_ends),
        break_periods: Some(parsed.break_periods),
        bookmarks: Some(parsed.bookmarks),
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanBatchEvent {
    files: Vec<ScanFilePayload>,
    directory: String,
    batch_index: usize,
    total_files: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanCompleteEvent {
    directory: String,
    total_files: usize,
}

/// Quick header-only check to see if a file matches the mapper filter.
/// Returns true if the file should be included (matches mapper or no mapper filter).
fn file_matches_mapper(file_path: &str, mappers: &[String]) -> bool {
    let path = Path::new(file_path);
    if let Ok(file) = fs::File::open(path) {
        let mut reader = BufReader::with_capacity(8192, file);
        let mut buf = Vec::with_capacity(8192);
        let _ = reader.by_ref().take(8192).read_to_end(&mut buf);
        let header = String::from_utf8_lossy(&buf);
        let (creator, version) = parse_header_creator_and_version(&header);
        let creator_lower = creator.to_ascii_lowercase();
        let version_lower = version.to_ascii_lowercase();
        return mappers.iter().any(|m| creator_lower.contains(m) || version_lower.contains(m));
    }
    false
}

fn scan_directory_streaming(
    dir_path: &str,
    mapper_name: Option<String>,
    known_files: Option<HashMap<String, f64>>,
    window: &tauri::Window,
) {
    let root = PathBuf::from(dir_path);
    if !root.exists() || !root.is_dir() {
        let _ = window.emit("scan-complete", ScanCompleteEvent {
            directory: dir_path.to_string(),
            total_files: 0,
        });
        return;
    }

    // Phase 1: Discover all .osu files with their mtimes in one WalkDir pass
    let osu_entries = find_osu_files_with_mtime(&root);
    if osu_entries.is_empty() {
        let _ = window.emit("scan-complete", ScanCompleteEvent {
            directory: dir_path.to_string(),
            total_files: 0,
        });
        return;
    }

    let known = Arc::new(known_files.unwrap_or_default());
    let mappers_raw = mapper_name.unwrap_or_default();
    let mappers: Arc<Vec<String>> = Arc::new(
        mappers_raw
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    );
    let has_mapper = !mappers.is_empty();

    // When mapper filter is active, pre-count matching files for accurate progress
    let total_for_progress = if has_mapper {
        let mappers_ref = mappers.as_ref();
        osu_entries.iter()
            .filter(|(path, _)| file_matches_mapper(path, mappers_ref))
            .count()
    } else {
        osu_entries.len()
    };

    // Shared state for streaming batches
    let batch_counter = Arc::new(Mutex::new(0_usize));
    let total_emitted = Arc::new(Mutex::new(0_usize));
    let total_for_progress_arc = Arc::new(total_for_progress);

    // Phase 2: Parse files in parallel, emit batches as they complete
    let parallelism = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4);
    let max_threads = (parallelism.saturating_mul(2)).clamp(4, 32);
    let worker_count = max_threads.min(osu_entries.len());
    let chunk_size = osu_entries.len().div_ceil(worker_count);
    let dir_string = dir_path.to_string();

    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(worker_count);

        for chunk in osu_entries.chunks(chunk_size) {
            let chunk_entries: Vec<_> = chunk.to_vec();
            let known = Arc::clone(&known);
            let mappers = Arc::clone(&mappers);
            let batch_counter = Arc::clone(&batch_counter);
            let total_emitted = Arc::clone(&total_emitted);
            let total_for_progress = Arc::clone(&total_for_progress_arc);
            let dir_str = dir_string.clone();

            handles.push(scope.spawn(move || {
                let mut local_batch = Vec::with_capacity(50);
                for (file_path, mtime_ms) in &chunk_entries {
                    if let Some(payload) = scan_single_osu_file(
                        file_path,
                        *mtime_ms,
                        &known,
                        mappers.as_ref(),
                    ) {
                        local_batch.push(payload);
                    }

                    // Emit batch every 50 results
                    if local_batch.len() >= 50 {
                        let batch_idx = {
                            let mut c = batch_counter.lock().unwrap();
                            let idx = *c;
                            *c += 1;
                            idx
                        };
                        let count = local_batch.len();
                        let _ = window.emit("scan-batch", ScanBatchEvent {
                            files: std::mem::replace(&mut local_batch, Vec::with_capacity(50)),
                            directory: dir_str.clone(),
                            batch_index: batch_idx,
                            total_files: *total_for_progress,
                        });
                        *total_emitted.lock().unwrap() += count;
                    }
                }

                // Emit remaining
                if !local_batch.is_empty() {
                    let batch_idx = {
                        let mut c = batch_counter.lock().unwrap();
                        let idx = *c;
                        *c += 1;
                        idx
                    };
                    let count = local_batch.len();
                    let _ = window.emit("scan-batch", ScanBatchEvent {
                        files: local_batch,
                        directory: dir_str.clone(),
                        batch_index: batch_idx,
                        total_files: *total_for_progress,
                    });
                    *total_emitted.lock().unwrap() += count;
                }
            }));
        }

        for handle in handles {
            let _ = handle.join();
        }
    });

    let final_count = *total_emitted.lock().unwrap();
    let _ = window.emit("scan-complete", ScanCompleteEvent {
        directory: dir_path.to_string(),
        total_files: final_count,
    });
}

fn scan_directory_internal(
    dir_path: &str,
    mapper_name: Option<String>,
    known_files: Option<HashMap<String, f64>>,
) -> ScanDirectoryPayload {
    let root = PathBuf::from(dir_path);
    if !root.exists() || !root.is_dir() {
        return ScanDirectoryPayload {
            files: vec![],
            directory: dir_path.to_string(),
        };
    }

    let osu_entries = find_osu_files_with_mtime(&root);
    if osu_entries.is_empty() {
        return ScanDirectoryPayload {
            files: vec![],
            directory: dir_path.to_string(),
        };
    }

    let known = Arc::new(known_files.unwrap_or_default());
    let mappers_raw = mapper_name.unwrap_or_default();
    let mappers: Arc<Vec<String>> = Arc::new(
        mappers_raw
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    );

    let parallelism = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4);
    let max_threads = (parallelism.saturating_mul(2)).clamp(4, 32);
    let worker_count = max_threads.min(osu_entries.len());
    let chunk_size = osu_entries.len().div_ceil(worker_count);

    let mut files: Vec<ScanFilePayload> = Vec::with_capacity(osu_entries.len());

    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(worker_count);

        for chunk in osu_entries.chunks(chunk_size) {
            let chunk_entries: Vec<_> = chunk.to_vec();
            let known = Arc::clone(&known);
            let mappers = Arc::clone(&mappers);

            handles.push(scope.spawn(move || {
                let mut out = Vec::with_capacity(chunk_entries.len());
                for (file_path, mtime_ms) in &chunk_entries {
                    if let Some(payload) = scan_single_osu_file(
                        file_path,
                        *mtime_ms,
                        &known,
                        mappers.as_ref(),
                    ) {
                        out.push(payload);
                    }
                }
                out
            }));
        }

        for handle in handles {
            if let Ok(mut partial) = handle.join() {
                files.append(&mut partial);
            }
        }
    });

    files.sort_unstable_by(|a, b| a.file_path.cmp(&b.file_path));

    ScanDirectoryPayload {
        files,
        directory: dir_path.to_string(),
    }
}

fn resolve_app_version(app_handle: &tauri::AppHandle) -> String {
    static PACKAGE_VERSION: OnceLock<Option<String>> = OnceLock::new();
    let pkg_version = PACKAGE_VERSION.get_or_init(|| {
        // package.json lives at the repo root (two levels up from src-tauri/src)
        serde_json::from_str::<Value>(include_str!("../../package.json")).ok().and_then(|json| {
            json.get("version").and_then(Value::as_str).map(|s| s.to_string())
        })
    });
    pkg_version
        .clone()
        .unwrap_or_else(|| app_handle.package_info().version.to_string())
}

#[tauri::command]
fn get_app_version(app_handle: tauri::AppHandle) -> String {
    resolve_app_version(&app_handle)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        open::that(url).map_err(|err| err.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn open_in_text_editor(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("Beatmap file not found".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("notepad")
            .arg(&path)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        open::that(path).map_err(|err| err.to_string())
    }
}

#[tauri::command]
async fn check_for_updates(app_handle: tauri::AppHandle) -> UpdateInfoPayload {
    let current_version = resolve_app_version(&app_handle);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build();

    let client = match client {
        Ok(client) => client,
        Err(err) => {
            return UpdateInfoPayload {
                current_version,
                latest_version: String::new(),
                html_url: String::new(),
                error: Some(err.to_string()),
            }
        }
    };

    let response = client
        .get("https://api.github.com/repos/fax1015/mosu/releases/latest")
        .header("User-Agent", "mosu-app")
        .send()
        .await;

    match response {
        Ok(resp) => {
            if !resp.status().is_success() {
                return UpdateInfoPayload {
                    current_version,
                    latest_version: String::new(),
                    html_url: String::new(),
                    error: Some("Failed to fetch latest release".to_string()),
                };
            }

            let json: Value = match resp.json().await {
                Ok(value) => value,
                Err(err) => {
                    return UpdateInfoPayload {
                        current_version,
                        latest_version: String::new(),
                        html_url: String::new(),
                        error: Some(err.to_string()),
                    }
                }
            };

            let latest_version = json
                .get("tag_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim_start_matches('v')
                .to_string();

            let html_url = json
                .get("html_url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            UpdateInfoPayload {
                current_version,
                latest_version,
                html_url,
                error: None,
            }
        }
        Err(err) => UpdateInfoPayload {
            current_version,
            latest_version: String::new(),
            html_url: String::new(),
            error: Some(err.to_string()),
        },
    }
}

#[tauri::command]
fn read_image_file(file_path: String) -> Option<String> {
    let path = PathBuf::from(file_path);
    let bytes = fs::read(&path).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", get_mime_type(&path), encoded))
}

#[tauri::command]
fn read_binary_file(file_path: String) -> Option<Vec<u8>> {
    fs::read(file_path).ok()
}

#[tauri::command]
fn read_osu_file(file_path: String) -> Option<OsuFilePayload> {
    let content = fs::read_to_string(&file_path).ok()?;
    let mtime_ms = get_mtime_ms(Path::new(&file_path)).ok()?;
    Some(OsuFilePayload {
        file_path,
        content,
        stat: FileStatPayload { mtime_ms },
    })
}

#[tauri::command]
fn get_audio_duration(file_path: String) -> Option<f64> {
    use lofty::probe::Probe;
    use lofty::prelude::*;
    let path = Path::new(&file_path);
    let tagged_file = Probe::open(path).ok()?.read().ok()?;
    let duration = tagged_file.properties().duration();
    Some(duration.as_millis() as f64)
}

#[tauri::command]
async fn calculate_star_rating(file_path: String) -> Option<f64> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(file_path).ok()?;
        let map = Beatmap::from_bytes(&bytes).ok()?;
        let stars = Difficulty::new().calculate(&map).stars();
        if stars.is_finite() && stars >= 0.0 {
            Some(stars)
        } else {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn stat_file(file_path: String) -> Option<FileStatPayload> {
    let mtime_ms = get_mtime_ms(Path::new(&file_path)).ok()?;
    Some(FileStatPayload { mtime_ms })
}

#[tauri::command]
fn show_item_in_folder(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        
        // Canonicalize to get an absolute path with backslashes.
        // Explorer /select requires backslashes — forward slashes cause it
        // to silently fall back to opening the Documents folder.
        let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
        let canonical_str = canonical.to_string_lossy();
        // Strip the \\?\ prefix that canonicalize adds on Windows
        let clean_path = canonical_str.strip_prefix("\\\\?\\").unwrap_or(&canonical_str);
        
        // IMPORTANT: Use raw_arg instead of arg — Rust's .arg() auto-quotes 
        // arguments containing spaces, but explorer.exe /select, does NOT 
        // support quoted arguments and silently falls back to Documents.
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", clean_path))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let target = path.parent().unwrap_or(Path::new(&file_path));
        open::that(target).map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn open_osu_file() -> Option<OpenOsuFilePayload> {
    let files = rfd::FileDialog::new()
        .add_filter("osu! beatmap", &["osu"])
        .set_title("Select a beatmap (.osu) file")
        .pick_files()?;

    let mut results: Vec<OsuFilePayload> = Vec::new();
    for path in files {
        let file_path = path.to_string_lossy().to_string();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mtime_ms) = get_mtime_ms(&path) {
                results.push(OsuFilePayload {
                    file_path,
                    content,
                    stat: FileStatPayload { mtime_ms },
                });
            }
        }
    }

    if results.is_empty() {
        None
    } else {
        Some(OpenOsuFilePayload { files: results })
    }
}

#[tauri::command]
async fn scan_directory_osu_files(
    window: tauri::Window,
    dir_path: String,
    mapper_name: Option<String>,
    known_files: Option<HashMap<String, f64>>,
) -> ScanDirectoryPayload {
    let dir_clone = dir_path.clone();
    let fallback_dir = dir_path.clone();
    // Use streaming: emit batches via events, return empty payload
    // The renderer listens for scan-batch and scan-complete events
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_clone, mapper_name, known_files, &window);
    })
    .await
    .ok();
    ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    }
}

#[tauri::command]
async fn list_directory_osu_files(
    window: tauri::Window,
    dir_path: String,
    mapper_name: Option<String>,
) -> ScanDirectoryPayload {
    let dir_clone = dir_path.clone();
    let fallback_dir = dir_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_clone, mapper_name, Some(HashMap::new()), &window);
    })
    .await
    .ok();
    ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    }
}

#[tauri::command]
async fn open_mapper_osu_files(window: tauri::Window, mapper_name: String) -> Option<ScanDirectoryPayload> {
    let dir = rfd::FileDialog::new()
        .set_title(format!(
            "Select the Songs folder to search for maps by \"{}\"",
            mapper_name
        ))
        .pick_folder()?;

    let dir_path = dir.to_string_lossy().to_string();
    let fallback_dir = dir_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_path, Some(mapper_name), Some(HashMap::new()), &window);
    })
    .await
    .ok();
    Some(ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    })
}

#[tauri::command]
async fn open_folder_osu_files(window: tauri::Window) -> Option<ScanDirectoryPayload> {
    let dir = rfd::FileDialog::new()
        .set_title("Select a songs folder to scan for .osu files")
        .pick_folder()?;

    let dir_path = dir.to_string_lossy().to_string();
    let fallback_dir = dir_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_path, None, Some(HashMap::new()), &window);
    })
    .await
    .ok();
    Some(ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    })
}

#[tauri::command]
fn select_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select Folder")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn analysis_state(_is_analyzing: bool) {}

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|err| err.to_string())
}

#[tauri::command]
fn window_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|err| err.to_string())? {
        window.unmaximize().map_err(|err| err.to_string())
    } else {
        window.maximize().map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|err| err.to_string())
}

#[tauri::command]
async fn embed_sync(url: String, api_key: String, data: Value) -> EmbedSyncPayload {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build();

    let client = match client {
        Ok(client) => client,
        Err(err) => {
            return EmbedSyncPayload {
                success: false,
                status: None,
                data: None,
                error: Some(err.to_string()),
            }
        }
    };

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&data)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.json::<Value>().await.ok();
            EmbedSyncPayload {
                success: (200..300).contains(&status),
                status: Some(status),
                data: body,
                error: None,
            }
        }
        Err(err) => EmbedSyncPayload {
            success: false,
            status: None,
            data: None,
            error: Some(err.to_string()),
        },
    }
}

#[tauri::command]
async fn get_osu_user_data(url_or_id: String) -> Result<OsuUserData, String> {
    println!("[mosu] Fetching osu! user data for: {}", url_or_id);
    let id_str = if url_or_id.starts_with("http") {
        url_or_id
            .split('/')
            .last()
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        url_or_id
    };

    if id_str.is_empty() {
        return Err("Invalid osu! user URL or ID".to_string());
    }
    
    println!("[mosu] Normalized user ID: {}", id_str);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://osu.ppy.sh/users/{}", id_str);
    let response = client.get(&url).send().await.map_err(|e| {
        println!("[mosu] Request failed: {}", e);
        e.to_string()
    })?;
    
    if !response.status().is_success() {
        println!("[mosu] Profile fetch returned status: {}", response.status());
        return Err(format!("Failed to fetch profile: {}", response.status()));
    }

    let html = response.text().await.map_err(|e| e.to_string())?;
    let document = scraper::Html::parse_document(&html);
    
    // Modern osu! profiles store data in a JSON blob within a .js-react element
    let react_selector = scraper::Selector::parse(".js-react").map_err(|_| "Selector error")?;
    let element = document.select(&react_selector)
        .find(|e| e.value().attr("data-initial-data").is_some())
        .ok_or_else(|| {
            println!("[mosu] Could not find .js-react element with data-initial-data");
            "Could not find profile data on page".to_string()
        })?;
    
    let json_str = element.value().attr("data-initial-data").unwrap();
    let data: Value = serde_json::from_str(json_str).map_err(|e| {
        println!("[mosu] JSON parse error: {}", e);
        format!("Failed to parse profile JSON: {}", e)
    })?;
    
    // The structure is usually { "user": { ... } }
    let user = data.get("user").ok_or_else(|| {
        println!("[mosu] 'user' key not found in JSON data");
        "User data not found in profile".to_string()
    })?;
    
    let actual_id = user.get("id")
        .and_then(|v| {
            if let Some(i) = v.as_i64() { Some(i.to_string()) }
            else if let Some(s) = v.as_str() { Some(s.to_string()) }
            else { None }
        })
        .ok_or_else(|| "User ID not found in JSON".to_string())?;
        
    let username = user.get("username")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Username not found in JSON".to_string())?;
    
    let mut names = vec![username.to_string()];
    println!("[mosu] Found primary username: {}", username);
    
    if let Some(previous) = user.get("previous_usernames").and_then(|v| v.as_array()) {
        for name_val in previous {
            if let Some(name) = name_val.as_str() {
                if !name.is_empty() {
                    names.push(name.to_string());
                }
            }
        }
    }

    // Remove duplicates while preserving order (primary name stays first)
    let mut seen = std::collections::HashSet::new();
    names.retain(|n| seen.insert(n.to_lowercase()));
    println!("[mosu] Total unique names found (order preserved): {:?}", names);

    Ok(OsuUserData { id: actual_id, names })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_external_url,
            check_for_updates,
            read_image_file,
            read_binary_file,
            read_osu_file,
            stat_file,
            show_item_in_folder,
            open_in_text_editor,
            open_osu_file,
            scan_directory_osu_files,
            list_directory_osu_files,
            open_mapper_osu_files,
            open_folder_osu_files,
            select_directory,
            analysis_state,
            window_minimize,
            window_maximize,
            window_close,
            embed_sync,
            get_audio_duration,
            calculate_star_rating,
            get_osu_user_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

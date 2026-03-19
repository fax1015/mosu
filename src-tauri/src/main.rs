#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use lofty::file::FileType;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read, Write};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    beatmap_hash: Option<String>,
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
    resolved_audio_path: String,
    resolved_background_path: String,
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
    beatmap_hash: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OsuCollectionPayload {
    name: String,
    beatmap_hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionMutationPayload {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
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

#[derive(Debug, Clone)]
struct StableCollectionsDb {
    version: i32,
    collections: Vec<OsuCollectionPayload>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OsuClient {
    Stable,
    Lazer,
}

impl OsuClient {
    fn from_option(value: Option<String>) -> Self {
        match value.as_deref() {
            Some("lazer") => Self::Lazer,
            _ => Self::Stable,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct SidecarResolvedEntry {
    h: String,
    a: Option<String>,
    b: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SidecarManifestFileEntry {
    n: String,
    p: String,
}

#[derive(Debug, Clone, Deserialize)]
struct SidecarManifestEntry {
    h: String,
    o: Option<String>,
    f: Vec<SidecarManifestFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LazerSessionFileEntry {
    relative_path: String,
    source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LazerSessionState {
    source_file_path: String,
    unpacked_osu_relative_path: Option<String>,
    files: Vec<LazerSessionFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LazerPreparedSession {
    session_dir: String,
    unpacked_dir: String,
    unpacked_osu_path: Option<String>,
}

/// Pre-resolved audio/background paths for all beatmaps, keyed by beatmap hash.
#[derive(Debug, Clone)]
struct LazerResolvedAssets {
    map: HashMap<String, (Option<String>, Option<String>)>,
}

#[derive(Debug, Clone)]
struct CachedLazerResolver {
    assets: Arc<LazerResolvedAssets>,
    realm_mtime_ms: f64,
}

static LAZER_RESOLVER_CACHE: OnceLock<Mutex<HashMap<String, CachedLazerResolver>>> = OnceLock::new();
const LAZER_SESSION_META_FILE: &str = ".mosu-lazer-session.json";

const MD5_SHIFT_AMOUNTS: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_TABLE: [u32; 64] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

fn compute_osu_md5_hex(bytes: &[u8]) -> String {
    let mut message = bytes.to_vec();
    let bit_len = (message.len() as u64).wrapping_mul(8);

    message.push(0x80);
    while (message.len() % 64) != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_le_bytes());

    let mut a0 = 0x67452301_u32;
    let mut b0 = 0xefcdab89_u32;
    let mut c0 = 0x98badcfe_u32;
    let mut d0 = 0x10325476_u32;

    for chunk in message.chunks_exact(64) {
        let mut words = [0_u32; 16];
        for (index, word) in words.iter_mut().enumerate() {
            let offset = index * 4;
            *word = u32::from_le_bytes([
                chunk[offset],
                chunk[offset + 1],
                chunk[offset + 2],
                chunk[offset + 3],
            ]);
        }

        let mut a = a0;
        let mut b = b0;
        let mut c = c0;
        let mut d = d0;

        for round in 0..64 {
            let (f, g) = match round {
                0..=15 => ((b & c) | ((!b) & d), round),
                16..=31 => ((d & b) | ((!d) & c), (5 * round + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * round + 5) % 16),
                _ => (c ^ (b | !d), (7 * round) % 16),
            };

            let rotated = a
                .wrapping_add(f)
                .wrapping_add(MD5_TABLE[round])
                .wrapping_add(words[g])
                .rotate_left(MD5_SHIFT_AMOUNTS[round]);

            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }

        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut digest = [0_u8; 16];
    digest[..4].copy_from_slice(&a0.to_le_bytes());
    digest[4..8].copy_from_slice(&b0.to_le_bytes());
    digest[8..12].copy_from_slice(&c0.to_le_bytes());
    digest[12..16].copy_from_slice(&d0.to_le_bytes());

    let mut out = String::with_capacity(32);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn read_i32_le<R: Read>(reader: &mut R) -> Result<i32, String> {
    let mut buf = [0_u8; 4];
    reader.read_exact(&mut buf).map_err(|err| err.to_string())?;
    Ok(i32::from_le_bytes(buf))
}

fn write_i32_le<W: Write>(writer: &mut W, value: i32) -> Result<(), String> {
    writer
        .write_all(&value.to_le_bytes())
        .map_err(|err| err.to_string())
}

fn read_uleb128<R: Read>(reader: &mut R) -> Result<usize, String> {
    let mut result = 0_usize;
    let mut shift = 0_u32;

    loop {
        let mut buf = [0_u8; 1];
        reader.read_exact(&mut buf).map_err(|err| err.to_string())?;
        let byte = buf[0];
        result |= usize::from(byte & 0x7f) << shift;

        if (byte & 0x80) == 0 {
            return Ok(result);
        }

        shift += 7;
        if shift > 28 {
            return Err("osu string length prefix is too large".to_string());
        }
    }
}

fn write_uleb128<W: Write>(writer: &mut W, mut value: usize) -> Result<(), String> {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }

        writer.write_all(&[byte]).map_err(|err| err.to_string())?;

        if value == 0 {
            return Ok(());
        }
    }
}

fn read_osu_string<R: Read>(reader: &mut R) -> Result<Option<String>, String> {
    let mut indicator = [0_u8; 1];
    reader
        .read_exact(&mut indicator)
        .map_err(|err| err.to_string())?;

    match indicator[0] {
        0x00 => Ok(None),
        0x0b => {
            let length = read_uleb128(reader)?;
            let mut bytes = vec![0_u8; length];
            reader
                .read_exact(&mut bytes)
                .map_err(|err| err.to_string())?;
            String::from_utf8(bytes)
                .map(Some)
                .map_err(|err| err.to_string())
        }
        other => Err(format!("unexpected osu string indicator byte: {other:#04x}")),
    }
}

fn write_osu_string<W: Write>(writer: &mut W, value: Option<&str>) -> Result<(), String> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return writer.write_all(&[0x00]).map_err(|err| err.to_string());
    };

    writer.write_all(&[0x0b]).map_err(|err| err.to_string())?;
    write_uleb128(writer, value.len())?;
    writer
        .write_all(value.as_bytes())
        .map_err(|err| err.to_string())
}

fn parse_stable_collections_bytes(bytes: &[u8]) -> Result<StableCollectionsDb, String> {
    let mut reader = std::io::Cursor::new(bytes);
    let version = read_i32_le(&mut reader)?;
    let collection_count = read_i32_le(&mut reader)?;
    if collection_count < 0 {
        return Err("collection count was negative".to_string());
    }

    let mut collections = Vec::with_capacity(collection_count as usize);
    for _ in 0..collection_count {
        let name = read_osu_string(&mut reader)?.unwrap_or_default();
        let beatmap_count = read_i32_le(&mut reader)?;
        if beatmap_count < 0 {
            return Err(format!("collection '{name}' had a negative beatmap count"));
        }

        let mut beatmap_hashes = Vec::with_capacity(beatmap_count as usize);
        for _ in 0..beatmap_count {
            if let Some(hash) = read_osu_string(&mut reader)? {
                let normalized = hash.trim().to_ascii_lowercase();
                if !normalized.is_empty() {
                    beatmap_hashes.push(normalized);
                }
            }
        }

        collections.push(OsuCollectionPayload { name, beatmap_hashes });
    }

    Ok(StableCollectionsDb { version, collections })
}

fn write_stable_collections_bytes(db: &StableCollectionsDb) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(4096);
    write_i32_le(&mut out, db.version)?;
    write_i32_le(&mut out, db.collections.len() as i32)?;

    for collection in &db.collections {
        write_osu_string(&mut out, Some(collection.name.as_str()))?;
        write_i32_le(&mut out, collection.beatmap_hashes.len() as i32)?;

        for hash in &collection.beatmap_hashes {
            let normalized = hash.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                write_osu_string(&mut out, None)?;
            } else {
                write_osu_string(&mut out, Some(normalized.as_str()))?;
            }
        }
    }

    Ok(out)
}

fn read_stable_collections_file(path: &Path) -> Result<StableCollectionsDb, String> {
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    parse_stable_collections_bytes(&bytes)
}

fn is_locked_io_error(error: &std::io::Error) -> bool {
    if matches!(error.kind(), std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock) {
        return true;
    }

    let message = error.to_string().to_ascii_lowercase();
    message.contains("being used by another process")
        || message.contains("sharing violation")
        || message.contains("file is in use")
        || message.contains("locked")
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

fn sniff_audio_mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && bytes[0] == 0x49 && bytes[1] == 0x44 && bytes[2] == 0x33 {
        return Some("audio/mpeg");
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && (bytes[1] & 0xf6) == 0xf0 {
        return Some("audio/aac");
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0 {
        return Some("audio/mpeg");
    }
    if bytes.len() >= 4 && bytes[0] == 0x4f && bytes[1] == 0x67 && bytes[2] == 0x67 && bytes[3] == 0x53 {
        return Some("audio/ogg");
    }
    if bytes.len() >= 4 && bytes[0] == 0x66 && bytes[1] == 0x4c && bytes[2] == 0x61 && bytes[3] == 0x43 {
        return Some("audio/flac");
    }
    if bytes.len() >= 12
        && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46
        && bytes[8] == 0x57 && bytes[9] == 0x41 && bytes[10] == 0x56 && bytes[11] == 0x45
    {
        return Some("audio/wav");
    }
    if bytes.len() >= 12
        && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70
    {
        return Some("audio/mp4");
    }
    None
}

fn audio_mime_type_from_hint(file_name_hint: Option<&str>) -> Option<&'static str> {
    match file_name_hint
        .and_then(|name| Path::new(name).extension())
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => Some("audio/mpeg"),
        Some("ogg") | Some("oga") | Some("opus") => Some("audio/ogg"),
        Some("wav") => Some("audio/wav"),
        Some("flac") => Some("audio/flac"),
        Some("m4a") | Some("mp4") => Some("audio/mp4"),
        Some("aac") => Some("audio/aac"),
        Some("webm") => Some("audio/webm"),
        _ => None,
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

fn resolve_scan_root(dir_path: &str, client: OsuClient) -> PathBuf {
    let root = PathBuf::from(dir_path);
    if client == OsuClient::Lazer {
        let files_root = root.join("files");
        if files_root.is_dir() {
            return files_root;
        }
    }
    root
}

fn resolve_lazer_data_root(dir_path: &str) -> Option<PathBuf> {
    let root = PathBuf::from(dir_path);
    if root.join("client.realm").is_file() {
        return Some(root);
    }

    if root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("files"))
    {
        let parent = root.parent()?;
        if parent.join("client.realm").is_file() {
            return Some(parent.to_path_buf());
        }
    }

    None
}

fn path_cache_key(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_ascii_lowercase()
}

fn find_realm_resolver_exe() -> Option<PathBuf> {
    // Look for the sidecar next to the current executable
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent()?;
        // Check alongside the app binary
        let candidate = dir.join("realm-resolver").with_extension(std::env::consts::EXE_EXTENSION);
        if candidate.is_file() {
            return Some(candidate);
        }
        // Check in sidecar publish directory (development)
        let dev_candidate = dir
            .ancestors()
            .find(|p| p.join("src-tauri").is_dir())
            .map(|root| root.join("src-tauri/sidecar/realm-resolver/publish/realm-resolver").with_extension(std::env::consts::EXE_EXTENSION));
        if let Some(path) = dev_candidate {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn build_lazer_resolver(data_root: &Path) -> Result<Arc<LazerResolvedAssets>, String> {
    let exe = find_realm_resolver_exe()
        .ok_or_else(|| "realm-resolver sidecar not found".to_string())?;

    let output = Command::new(&exe)
        .arg(data_root.as_os_str())
        .arg("resolve-all")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|err| format!("failed to run realm-resolver: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("realm-resolver failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map = HashMap::new();
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<SidecarResolvedEntry>(line) {
            map.insert(entry.h, (entry.a, entry.b));
        }
    }

    Ok(Arc::new(LazerResolvedAssets { map }))
}

fn get_lazer_resolver(dir_path: &str) -> Result<Option<Arc<LazerResolvedAssets>>, String> {
    let Some(data_root) = resolve_lazer_data_root(dir_path) else {
        return Ok(None);
    };

    let realm_path = data_root.join("client.realm");
    let realm_mtime_ms = get_mtime_ms(&realm_path)?;
    let cache_key = path_cache_key(&data_root);
    let cache = LAZER_RESOLVER_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    {
        let cache_guard = cache.lock().unwrap();
        if let Some(cached) = cache_guard.get(&cache_key) {
            if (cached.realm_mtime_ms - realm_mtime_ms).abs() < 0.5 {
                return Ok(Some(Arc::clone(&cached.assets)));
            }
        }
    }

    let resolver = build_lazer_resolver(&data_root)?;

    let mut cache_guard = cache.lock().unwrap();
    cache_guard.insert(
        cache_key,
        CachedLazerResolver {
            assets: Arc::clone(&resolver),
            realm_mtime_ms,
        },
    );

    Ok(Some(resolver))
}

fn get_lazer_manifest(data_root: &Path, beatmap_hash: &str) -> Result<SidecarManifestEntry, String> {
    let exe = find_realm_resolver_exe()
        .ok_or_else(|| "realm-resolver sidecar not found".to_string())?;

    let output = Command::new(&exe)
        .arg(data_root.as_os_str())
        .arg("manifest")
        .arg(beatmap_hash)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|err| format!("failed to run realm-resolver: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("realm-resolver failed: {stderr}"));
    }

    serde_json::from_slice::<SidecarManifestEntry>(&output.stdout)
        .map_err(|err| format!("failed to parse realm-resolver manifest: {err}"))
}

fn normalize_relative_session_path(name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let mut out = PathBuf::new();

    for component in Path::new(&normalized).components() {
        match component {
            std::path::Component::Normal(part) => out.push(part),
            std::path::Component::CurDir => {}
            _ => {}
        }
    }

    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

fn create_lazer_session_dir(beatmap_hash: &str) -> Result<PathBuf, String> {
    let base = std::env::temp_dir().join("mosu-lazer-sessions");
    fs::create_dir_all(&base).map_err(|err| err.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis();
    let safe_hash = beatmap_hash
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(16)
        .collect::<String>();
    let dir = base.join(format!(
        "{}-{}",
        if safe_hash.is_empty() { "map" } else { &safe_hash },
        stamp
    ));
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn write_lazer_session_state(session_dir: &Path, state: &LazerSessionState) -> Result<(), String> {
    let meta_path = session_dir.join(LAZER_SESSION_META_FILE);
    let json = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    fs::write(meta_path, json).map_err(|err| err.to_string())
}

fn read_lazer_session_state(session_dir: &Path) -> Result<LazerSessionState, String> {
    let meta_path = session_dir.join(LAZER_SESSION_META_FILE);
    let bytes = fs::read(meta_path).map_err(|err| err.to_string())?;
    serde_json::from_slice::<LazerSessionState>(&bytes).map_err(|err| err.to_string())
}

fn beatmap_hash_from_lazer_path(file_path: &str) -> Option<String> {
    Path::new(file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
}

fn is_probable_lazer_osu_file(path: &Path, file_size: u64) -> bool {
    if file_size == 0 || file_size > 4 * 1024 * 1024 {
        return false;
    }

    let Ok(file) = fs::File::open(path) else {
        return false;
    };

    let mut reader = BufReader::with_capacity(64, file);
    let mut buf = [0_u8; 32];
    let Ok(bytes_read) = reader.read(&mut buf) else {
        return false;
    };

    if bytes_read == 0 {
        return false;
    }

    let header = String::from_utf8_lossy(&buf[..bytes_read]);
    header.starts_with("osu file format v")
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
    const SLIDER_GAP_FILL_BEATS: f64 = 2.0;
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
    let mut hit_gap_thresholds: Vec<i32> = Vec::with_capacity(512);
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

                if obj_type & 2 != 0 {
                    // Slider
                    if field_count >= 8 {
                        let slides = csv_field(trimmed, 6).unwrap_or("1").trim().parse::<f64>().unwrap_or(1.0);
                        let length = csv_field(trimmed, 7).unwrap_or("0").trim().parse::<f64>().unwrap_or(0.0);

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
                            let prev_gap_threshold = hit_gap_thresholds.last().copied().unwrap_or(0);
                            if *prev_end < start_time && start_time - *prev_end <= prev_gap_threshold {
                                *prev_end = start_time;
                            }
                        }
                    }
                }

                hit_starts.push(start_time);
                hit_ends.push(end_time.max(start_time));
                hit_types.push(obj_type);
                hit_gap_thresholds.push(if obj_type & 2 != 0 {
                    (active_beat * SLIDER_GAP_FILL_BEATS).max(0.0).floor() as i32
                } else {
                    0
                });
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

/// Discover osu beatmap files and their mtimes using WalkDir metadata.
/// Stable scans use the .osu extension; lazer scans sniff beatmap text files in the hashed store.
fn find_osu_files_with_mtime(
    root: &Path,
    client: OsuClient,
    status: Option<(&tauri::Window, &str)>,
) -> Vec<(String, f64)> {
    match client {
        OsuClient::Stable => {
            let mut results = Vec::with_capacity(4096);
            for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
                if !entry.file_type().is_file() {
                    continue;
                }

                let path = entry.path();
                if !path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("osu"))
                    .unwrap_or(false)
                {
                    continue;
                }

                let metadata = match entry.metadata() {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };

                let mtime_ms = metadata
                    .modified()
                    .ok()
                    .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);
                results.push((path.to_string_lossy().to_string(), mtime_ms));
            }
            results
        }
        OsuClient::Lazer => {
            let mut candidates = Vec::with_capacity(8192);
            for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
                if !entry.file_type().is_file() {
                    continue;
                }

                let metadata = match entry.metadata() {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let mtime_ms = metadata
                    .modified()
                    .ok()
                    .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);

                candidates.push((
                    entry.path().to_string_lossy().to_string(),
                    metadata.len(),
                    mtime_ms,
                ));
            }

            let total_candidates = candidates.len();
            if let Some((window, dir_path)) = status {
                emit_scan_status(window, dir_path, "discovering", 0, total_candidates, Some(0));
            }

            let mut results = Vec::with_capacity((total_candidates / 8).max(256));
            let mut discovered = 0_usize;

            for (index, (file_path, file_size, mtime_ms)) in candidates.into_iter().enumerate() {
                if is_probable_lazer_osu_file(Path::new(&file_path), file_size) {
                    discovered += 1;
                    results.push((file_path, mtime_ms));
                }

                let current = index + 1;
                if let Some((window, dir_path)) = status {
                    if should_emit_scan_status(current, total_candidates) {
                        emit_scan_status(
                            window,
                            dir_path,
                            "discovering",
                            current,
                            total_candidates,
                            Some(discovered),
                        );
                    }
                }
            }

            results
        }
    }
}

fn count_matching_entries(
    osu_entries: &[(String, f64)],
    mappers: &[String],
    status: Option<(&tauri::Window, &str)>,
) -> usize {
    if mappers.is_empty() {
        return osu_entries.len();
    }

    let total = osu_entries.len();
    if let Some((window, dir_path)) = status {
        emit_scan_status(window, dir_path, "filtering", 0, total, None);
    }

    let mut matched = 0_usize;
    for (index, (path, _)) in osu_entries.iter().enumerate() {
        if file_matches_mapper(path, mappers) {
            matched += 1;
        }

        let current = index + 1;
        if let Some((window, dir_path)) = status {
            if should_emit_scan_status(current, total) {
                emit_scan_status(window, dir_path, "filtering", current, total, None);
            }
        }
    }

    matched
}

/// Process a single .osu file. `mtime_ms` is pre-fetched from WalkDir.
fn scan_single_osu_file(
    file_path: &str,
    mtime_ms: f64,
    known: &HashMap<String, f64>,
    mappers: &[String],
    lazer_resolver: Option<&LazerResolvedAssets>,
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
                beatmap_hash: beatmap_hash_from_lazer_path(file_path),
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
    let mut bytes = Vec::with_capacity(32768);
    reader.read_to_end(&mut bytes).ok()?;
    let content = String::from_utf8_lossy(&bytes);

    let mut parsed = parse_osu_content(&content);
    let beatmap_hash = match lazer_resolver {
        Some(_) => beatmap_hash_from_lazer_path(file_path),
        None => Some(compute_osu_md5_hex(&bytes)),
    };

    if let (Some(resolver), Some(beatmap_hash)) =
        (lazer_resolver, beatmap_hash.as_deref())
    {
        if let Some((audio_path, bg_path)) = resolver.map.get(beatmap_hash) {
            if let Some(audio) = audio_path {
                parsed.metadata.resolved_audio_path = audio.clone();
            }
            if let Some(bg) = bg_path {
                parsed.metadata.resolved_background_path = bg.clone();
            }
        }
    }

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
        beatmap_hash,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanStatusEvent {
    directory: String,
    stage: String,
    current: usize,
    total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    discovered_files: Option<usize>,
}

#[inline]
fn should_emit_scan_status(current: usize, total: usize) -> bool {
    current == total || current == 1 || current % 250 == 0
}

fn emit_scan_status(
    window: &tauri::Window,
    dir_path: &str,
    stage: &str,
    current: usize,
    total: usize,
    discovered_files: Option<usize>,
) {
    let _ = window.emit("scan-status", ScanStatusEvent {
        directory: dir_path.to_string(),
        stage: stage.to_string(),
        current,
        total,
        discovered_files,
    });
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
    client: OsuClient,
    window: &tauri::Window,
) {
    let root = resolve_scan_root(dir_path, client);
    if !root.exists() || !root.is_dir() {
        let _ = window.emit("scan-complete", ScanCompleteEvent {
            directory: dir_path.to_string(),
            total_files: 0,
        });
        return;
    }

    // Phase 1: Discover all .osu files with their mtimes in one WalkDir pass
    let osu_entries = find_osu_files_with_mtime(&root, client, Some((window, dir_path)));
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
    let lazer_resolver = if client == OsuClient::Lazer {
        emit_scan_status(window, dir_path, "resolving-media", 0, 0, None);
        match get_lazer_resolver(dir_path) {
            Ok(resolver) => resolver,
            Err(err) => {
                eprintln!("failed to resolve lazer media from {dir_path}: {err}");
                None
            }
        }
    } else {
        None
    };

    // When mapper filter is active, pre-count matching files for accurate progress
    let total_for_progress = count_matching_entries(
        &osu_entries,
        mappers.as_ref(),
        if has_mapper { Some((window, dir_path)) } else { None },
    );

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
            let lazer_resolver = lazer_resolver.clone();
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
                        lazer_resolver.as_deref(),
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
    client: OsuClient,
) -> ScanDirectoryPayload {
    let root = resolve_scan_root(dir_path, client);
    if !root.exists() || !root.is_dir() {
        return ScanDirectoryPayload {
            files: vec![],
            directory: dir_path.to_string(),
        };
    }

    let osu_entries = find_osu_files_with_mtime(&root, client, None);
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
    let lazer_resolver = if client == OsuClient::Lazer {
        match get_lazer_resolver(dir_path) {
            Ok(resolver) => resolver,
            Err(err) => {
                eprintln!("failed to resolve lazer media from {dir_path}: {err}");
                None
            }
        }
    } else {
        None
    };
    let total_for_progress = count_matching_entries(&osu_entries, mappers.as_ref(), None);

    let parallelism = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4);
    let max_threads = (parallelism.saturating_mul(2)).clamp(4, 32);
    let worker_count = max_threads.min(osu_entries.len());
    let chunk_size = osu_entries.len().div_ceil(worker_count);

    let mut files: Vec<ScanFilePayload> = Vec::with_capacity(total_for_progress);

    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(worker_count);

        for chunk in osu_entries.chunks(chunk_size) {
            let chunk_entries: Vec<_> = chunk.to_vec();
            let known = Arc::clone(&known);
            let mappers = Arc::clone(&mappers);
            let lazer_resolver = lazer_resolver.clone();

            handles.push(scope.spawn(move || {
                let mut out = Vec::with_capacity(chunk_entries.len());
                for (file_path, mtime_ms) in &chunk_entries {
                    if let Some(payload) = scan_single_osu_file(
                        file_path,
                        *mtime_ms,
                        &known,
                        mappers.as_ref(),
                        lazer_resolver.as_deref(),
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
fn read_audio_file(file_path: String, file_name_hint: Option<String>) -> Option<String> {
    let bytes = fs::read(&file_path).ok()?;
    let mime = sniff_audio_mime_type(&bytes)
        .or_else(|| audio_mime_type_from_hint(file_name_hint.as_deref()))
        .unwrap_or("application/octet-stream");
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", mime, encoded))
}

#[tauri::command]
fn read_osu_file(file_path: String) -> Option<OsuFilePayload> {
    let content = fs::read_to_string(&file_path).ok()?;
    let mtime_ms = get_mtime_ms(Path::new(&file_path)).ok()?;
    Some(OsuFilePayload {
        file_path,
        content,
        stat: FileStatPayload { mtime_ms },
        beatmap_hash: None,
    })
}

#[tauri::command]
fn get_audio_duration(file_path: String, file_name_hint: Option<String>) -> Option<f64> {
    use lofty::probe::Probe;
    use lofty::prelude::*;
    use std::fs::File;
    use std::io::BufReader;

    let path = Path::new(&file_path);
    let hinted_type = file_name_hint
        .as_deref()
        .and_then(|name| Path::new(name).extension())
        .and_then(|ext| ext.to_str())
        .and_then(FileType::from_ext);

    let tagged_file = if let Ok(probe) = Probe::open(path) {
        match probe.read() {
            Ok(tagged_file) => tagged_file,
            Err(_) => {
                let file = File::open(path).ok()?;
                let reader = BufReader::new(file);
                if let Some(file_type) = hinted_type {
                    Probe::with_file_type(reader, file_type).read().ok()?
                } else {
                    Probe::new(reader).guess_file_type().ok()?.read().ok()?
                }
            }
        }
    } else {
        let file = File::open(path).ok()?;
        let reader = BufReader::new(file);
        if let Some(file_type) = hinted_type {
            Probe::with_file_type(reader, file_type).read().ok()?
        } else {
            Probe::new(reader).guess_file_type().ok()?.read().ok()?
        }
    };
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
fn prepare_lazer_map_session(file_path: String, data_root: String) -> Result<LazerPreparedSession, String> {
    let data_root_path = resolve_lazer_data_root(&data_root)
        .ok_or_else(|| "osu!lazer data folder not found".to_string())?;
    let beatmap_hash = beatmap_hash_from_lazer_path(&file_path)
        .ok_or_else(|| "failed to derive lazer beatmap hash".to_string())?;
    let manifest = get_lazer_manifest(&data_root_path, &beatmap_hash)?;

    if !manifest.h.eq_ignore_ascii_case(&beatmap_hash) {
        return Err("realm-resolver returned a mismatched beatmap manifest".to_string());
    }

    if manifest.f.is_empty() {
        return Err("no files available to unpack for this beatmap set".to_string());
    }

    let session_dir = create_lazer_session_dir(&beatmap_hash)?;
    let unpacked_dir = session_dir.join("unpacked");
    fs::create_dir_all(&unpacked_dir).map_err(|err| err.to_string())?;

    let mut files = Vec::with_capacity(manifest.f.len());
    let target_osu_name = manifest.o.as_deref().map(|name| name.replace('\\', "/").to_ascii_lowercase());
    let mut unpacked_osu_relative_path: Option<String> = None;

    for entry in manifest.f {
        let Some(relative_path) = normalize_relative_session_path(&entry.n) else {
            continue;
        };

        let destination = unpacked_dir.join(&relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        fs::copy(&entry.p, &destination).map_err(|err| {
            format!("failed to unpack {}: {err}", relative_path.to_string_lossy())
        })?;

        let relative_string = relative_path.to_string_lossy().replace('\\', "/");
        if unpacked_osu_relative_path.is_none() {
            let is_target = target_osu_name
                .as_deref()
                .is_some_and(|target| target == relative_string.to_ascii_lowercase());
            let is_osu_file = relative_string.to_ascii_lowercase().ends_with(".osu");
            if is_target || is_osu_file {
                unpacked_osu_relative_path = Some(relative_string.clone());
            }
        }

        files.push(LazerSessionFileEntry {
            relative_path: relative_string,
            source_path: entry.p,
        });
    }

    if files.is_empty() {
        return Err("no unpackable files were found for this beatmap set".to_string());
    }

    let state = LazerSessionState {
        source_file_path: file_path,
        unpacked_osu_relative_path: unpacked_osu_relative_path.clone(),
        files,
    };
    write_lazer_session_state(&session_dir, &state)?;

    let unpacked_osu_path = unpacked_osu_relative_path
        .as_ref()
        .map(|relative| unpacked_dir.join(relative).to_string_lossy().to_string());

    Ok(LazerPreparedSession {
        session_dir: session_dir.to_string_lossy().to_string(),
        unpacked_dir: unpacked_dir.to_string_lossy().to_string(),
        unpacked_osu_path,
    })
}

#[tauri::command]
fn commit_lazer_map_session(session_dir: String) -> Result<(), String> {
    let session_dir_path = PathBuf::from(&session_dir);
    let unpacked_dir = session_dir_path.join("unpacked");
    let state = read_lazer_session_state(&session_dir_path)?;

    for file in &state.files {
        let relative_path = Path::new(&file.relative_path);
        let unpacked_path = unpacked_dir.join(relative_path);
        if !unpacked_path.is_file() {
            continue;
        }

        if let Some(parent) = Path::new(&file.source_path).parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        fs::copy(&unpacked_path, &file.source_path).map_err(|err| {
            format!("failed to repack {}: {err}", file.relative_path)
        })?;
    }

    let _ = fs::remove_dir_all(&session_dir_path);
    Ok(())
}

#[tauri::command]
fn parse_stable_collections(path: String) -> Result<Vec<OsuCollectionPayload>, String> {
    let db = read_stable_collections_file(Path::new(&path))?;
    Ok(db.collections)
}

#[tauri::command]
fn add_to_stable_collection(
    collection_db_path: String,
    collection_name: String,
    beatmap_hash: String,
) -> CollectionMutationPayload {
    let path = PathBuf::from(&collection_db_path);
    let normalized_name = collection_name.trim();
    let normalized_hash = beatmap_hash.trim().to_ascii_lowercase();

    if normalized_name.is_empty() || normalized_hash.is_empty() {
        return CollectionMutationPayload {
            success: false,
            error: Some("invalid_input".to_string()),
        };
    }

    let mut db = match read_stable_collections_file(&path) {
        Ok(db) => db,
        Err(error) => {
            let locked = fs::File::open(&path)
                .err()
                .is_some_and(|err| is_locked_io_error(&err));
            return CollectionMutationPayload {
                success: false,
                error: Some(if locked { "file_locked".to_string() } else { error }),
            };
        }
    };

    let Some(collection) = db.collections.iter_mut().find(|collection| {
        collection.name.eq_ignore_ascii_case(normalized_name)
    }) else {
        return CollectionMutationPayload {
            success: false,
            error: Some("collection not found".to_string()),
        };
    };

    if collection
        .beatmap_hashes
        .iter()
        .any(|hash| hash.eq_ignore_ascii_case(&normalized_hash))
    {
        return CollectionMutationPayload {
            success: true,
            error: None,
        };
    }

    collection.beatmap_hashes.push(normalized_hash);
    let bytes = match write_stable_collections_bytes(&db) {
        Ok(bytes) => bytes,
        Err(error) => {
            return CollectionMutationPayload {
                success: false,
                error: Some(error),
            };
        }
    };

    match fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&path)
    {
        Ok(mut file) => {
            if let Err(error) = file.write_all(&bytes) {
                return CollectionMutationPayload {
                    success: false,
                    error: Some(if is_locked_io_error(&error) {
                        "file_locked".to_string()
                    } else {
                        error.to_string()
                    }),
                };
            }
        }
        Err(error) => {
            return CollectionMutationPayload {
                success: false,
                error: Some(if is_locked_io_error(&error) {
                    "file_locked".to_string()
                } else {
                    error.to_string()
                }),
            };
        }
    }

    CollectionMutationPayload {
        success: true,
        error: None,
    }
}

#[tauri::command]
fn get_lazer_collections(data_root: Option<String>) -> Result<Vec<OsuCollectionPayload>, String> {
    let exe = find_realm_resolver_exe()
        .ok_or_else(|| "realm-resolver sidecar not found".to_string())?;

    let mut command = Command::new(&exe);
    if let Some(data_root) = data_root.as_ref().filter(|value| !value.trim().is_empty()) {
        command.arg(data_root);
    }
    let output = command
        .arg("list-collections")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|err| format!("failed to run realm-resolver: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("realm-resolver failed: {stderr}"));
    }

    serde_json::from_slice::<Vec<OsuCollectionPayload>>(&output.stdout)
        .map_err(|err| format!("failed to parse lazer collections: {err}"))
}

#[tauri::command]
fn add_to_lazer_collection(
    data_root: Option<String>,
    collection_name: String,
    beatmap_hash: String,
) -> CollectionMutationPayload {
    let exe = match find_realm_resolver_exe() {
        Some(exe) => exe,
        None => {
            return CollectionMutationPayload {
                success: false,
                error: Some("realm-resolver sidecar not found".to_string()),
            };
        }
    };

    let mut command = Command::new(&exe);
    if let Some(data_root) = data_root.as_ref().filter(|value| !value.trim().is_empty()) {
        command.arg(data_root);
    }
    let output = match command
        .arg("add-to-collection")
        .arg("--collection-name")
        .arg(collection_name)
        .arg("--beatmap-hash")
        .arg(beatmap_hash)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return CollectionMutationPayload {
                success: false,
                error: Some(error.to_string()),
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Ok(payload) = serde_json::from_str::<CollectionMutationPayload>(&stdout) {
        return payload;
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CollectionMutationPayload {
            success: false,
            error: Some(if stderr.trim().is_empty() {
                "realm-resolver failed".to_string()
            } else {
                stderr.trim().to_string()
            }),
        };
    }

    CollectionMutationPayload {
        success: false,
        error: Some("invalid_sidecar_response".to_string()),
    }
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
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(mtime_ms) = get_mtime_ms(&path) {
                let content = String::from_utf8_lossy(&bytes).to_string();
                results.push(OsuFilePayload {
                    file_path,
                    content,
                    stat: FileStatPayload { mtime_ms },
                    beatmap_hash: Some(compute_osu_md5_hex(&bytes)),
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
    client_type: Option<String>,
) -> ScanDirectoryPayload {
    let dir_clone = dir_path.clone();
    let fallback_dir = dir_path.clone();
    let client = OsuClient::from_option(client_type);
    // Use streaming: emit batches via events, return empty payload
    // The renderer listens for scan-batch and scan-complete events
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_clone, mapper_name, known_files, client, &window);
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
    client_type: Option<String>,
) -> ScanDirectoryPayload {
    let dir_clone = dir_path.clone();
    let fallback_dir = dir_path.clone();
    let client = OsuClient::from_option(client_type);
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_clone, mapper_name, Some(HashMap::new()), client, &window);
    })
    .await
    .ok();
    ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    }
}

#[tauri::command]
async fn open_mapper_osu_files(
    window: tauri::Window,
    mapper_name: String,
    client_type: Option<String>,
) -> Option<ScanDirectoryPayload> {
    let client = OsuClient::from_option(client_type);
    let dir = rfd::FileDialog::new()
        .set_title(format!(
            "{} to search for maps by \"{}\"",
            if client == OsuClient::Lazer {
                "Select the osu!lazer data folder"
            } else {
                "Select the Songs folder"
            },
            mapper_name,
        ))
        .pick_folder()?;

    let dir_path = dir.to_string_lossy().to_string();
    let fallback_dir = dir_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_path, Some(mapper_name), Some(HashMap::new()), client, &window);
    })
    .await
    .ok();
    Some(ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    })
}

#[tauri::command]
async fn open_folder_osu_files(
    window: tauri::Window,
    client_type: Option<String>,
) -> Option<ScanDirectoryPayload> {
    let client = OsuClient::from_option(client_type);
    let dir = rfd::FileDialog::new()
        .set_title(if client == OsuClient::Lazer {
            "Select an osu!lazer data folder to scan for maps"
        } else {
            "Select a songs folder to scan for .osu files"
        })
        .pick_folder()?;

    let dir_path = dir.to_string_lossy().to_string();
    let fallback_dir = dir_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_directory_streaming(&dir_path, None, Some(HashMap::new()), client, &window);
    })
    .await
    .ok();
    Some(ScanDirectoryPayload {
        files: vec![],
        directory: fallback_dir,
    })
}

#[tauri::command]
fn select_directory(title: Option<String>) -> Option<String> {
    let dialog = rfd::FileDialog::new();
    let dialog = if let Some(title) = title {
        dialog.set_title(title)
    } else {
        dialog.set_title("Select Folder")
    };

    dialog
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
            read_audio_file,
            read_osu_file,
            stat_file,
            parse_stable_collections,
            add_to_stable_collection,
            get_lazer_collections,
            add_to_lazer_collection,
            prepare_lazer_map_session,
            commit_lazer_map_session,
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

//! File replacement and complete book snapshots. No settings or credentials enter snapshots.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// All native filesystem mutations share this lock, including snapshot copy/restore.
pub static IO_LOCK: Mutex<()> = Mutex::new(());
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}
fn token() -> String {
    format!("{}-{}-{}", millis(), std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed))
}
fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}
fn simple_name(name: &str) -> io::Result<()> {
    if name.is_empty() || name.contains(['/', '\\', ':'])
        || !matches!(Path::new(name).components().next(), Some(Component::Normal(_)))
        || Path::new(name).components().count() != 1 {
        return Err(invalid("无效的快照路径"));
    }
    Ok(())
}

/// The original is never unlinked. A failed replacement leaves the original intact.
pub fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let name = path.file_name().ok_or_else(|| invalid("文件名为空"))?.to_string_lossy();
    let temporary = parent.join(format!(".{}.{}.tmp", name, token()));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

pub fn ensure_no_pending_restore(path: &Path) -> io::Result<()> {
    for parent in path.ancestors().skip(1) {
        if parent.join(JOURNAL).exists() {
            return Err(invalid("作品恢复尚未完成。请重新打开这本书以回滚恢复；暂不写入。"));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileRecord { path: String, bytes: u64, checksum: String }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    created_at: u64,
    scope: String,
    files: Vec<FileRecord>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub name: String,
    pub legacy: bool,
    pub valid: bool,
    pub created_at: u64,
    pub error: Option<String>,
}

// FNV-1a is a corruption check, not a security signature.
fn checksum(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes { hash ^= *byte as u64; hash = hash.wrapping_mul(0x100000001b3); }
    format!("{:016x}", hash)
}

fn collect(base: &Path, dir: &Path, records: &mut Vec<FileRecord>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() { return Err(invalid("快照不支持符号链接")); }
        if kind.is_dir() { collect(base, &entry.path(), records)?; }
        else if kind.is_file() {
            let path = entry.path();
            let relative = path.strip_prefix(base).map_err(|_| invalid("文件越界"))?
                .to_string_lossy().replace('\\', "/");
            if relative == "manifest.json" { continue; }
            let bytes = fs::read(&path)?;
            if path.extension().is_some_and(|e| e == "json") {
                serde_json::from_slice::<Value>(&bytes).map_err(|e| invalid(format!("JSON 损坏：{}：{}", relative, e)))?;
            }
            records.push(FileRecord { path: relative, bytes: bytes.len() as u64, checksum: checksum(&bytes) });
        }
    }
    Ok(())
}

fn inventory(base: &Path) -> io::Result<Vec<FileRecord>> {
    let mut records = vec![];
    collect(base, base, &mut records)?;
    records.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(records)
}

fn validate_book(dir: &Path) -> io::Result<()> {
    let book: Value = serde_json::from_slice(&fs::read(dir.join("book.json"))?).map_err(|e| invalid(e.to_string()))?;
    if book["protocolVersion"].as_u64() != Some(1) || !book["id"].is_string() {
        return Err(invalid("作品格式不受支持"));
    }
    let chapters = book["chapters"].as_array().ok_or_else(|| invalid("作品缺少章节目录"))?;
    let mut seen = std::collections::HashSet::new();
    for chapter in chapters {
        let id = chapter["id"].as_str().ok_or_else(|| invalid("章节 ID 缺失"))?;
        simple_name(id)?;
        if !seen.insert(id) { return Err(invalid("章节 ID 重复")); }
        let value: Value = serde_json::from_slice(&fs::read(dir.join("chapters").join(format!("{}.json", id)))?)
            .map_err(|e| invalid(e.to_string()))?;
        if value["doc"]["type"] != "doc" || value["meta"]["id"] != id {
            return Err(invalid(format!("章节内容不完整：{}", id)));
        }
    }
    Ok(())
}

fn validate_snapshot(dir: &Path) -> io::Result<bool> {
    validate_book(dir)?;
    let manifest_path = dir.join("manifest.json");
    if !manifest_path.exists() { return Ok(true); }
    let manifest: Manifest = serde_json::from_slice(&fs::read(manifest_path)?).map_err(|e| invalid(e.to_string()))?;
    if manifest.version != 2 || manifest.scope != "book+chapters+entities" {
        return Err(invalid("快照版本不受支持"));
    }
    if !dir.join("entities").is_dir() || inventory(dir)? != manifest.files {
        return Err(invalid("快照校验失败：文件缺失、增加或内容改变"));
    }
    Ok(false)
}

fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() { return Err(invalid("不复制符号链接")); }
        if kind.is_dir() { copy_tree(&entry.path(), &dst.join(entry.file_name()))?; }
        else {
            let bytes = fs::read(entry.path())?;
            atomic_write(&dst.join(entry.file_name()), &bytes)?;
        }
    }
    Ok(())
}

pub fn list_snapshots(book: &Path) -> io::Result<Vec<SnapshotInfo>> {
    let mut out = vec![];
    let root = book.join("snapshots");
    if !root.exists() { return Ok(out); }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') { continue; }
        let modified = entry.metadata()?.modified()?.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let result = validate_snapshot(&entry.path());
        let created_at = fs::read(entry.path().join("manifest.json")).ok()
            .and_then(|b| serde_json::from_slice::<Manifest>(&b).ok()).map_or(modified, |m| m.created_at);
        out.push(SnapshotInfo {
            name, legacy: result.as_ref().copied().unwrap_or(false), valid: result.is_ok(), created_at,
            error: result.err().map(|e| e.to_string()),
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.name.cmp(&a.name)));
    Ok(out)
}

fn prune(book: &Path) -> io::Result<()> {
    let all = list_snapshots(book)?;
    for (auto, keep) in [(true, 7), (false, 20)] {
        for snapshot in all.iter().filter(|s| s.valid && s.name.starts_with("auto-") == auto).skip(keep) {
            // Only names returned from the snapshots directory can be removed here.
            simple_name(&snapshot.name)?;
            fs::remove_dir_all(book.join("snapshots").join(&snapshot.name))?;
        }
    }
    Ok(())
}

fn create_inner(book: &Path, base: &str, rotate: bool) -> io::Result<String> {
    simple_name(base)?;
    validate_book(book)?;
    let root = book.join("snapshots");
    fs::create_dir_all(&root)?;
    let name = format!("{}-{}", base, token());
    let pending = root.join(format!(".pending-{}", name));
    fs::create_dir(&pending)?;
    copy_tree(&book.join("chapters"), &pending.join("chapters"))?;
    if book.join("entities").exists() { copy_tree(&book.join("entities"), &pending.join("entities"))?; }
    else { fs::create_dir(pending.join("entities"))?; }
    atomic_write(&pending.join("book.json"), &fs::read(book.join("book.json"))?)?;
    if book.join("refs.json").exists() { atomic_write(&pending.join("refs.json"), &fs::read(book.join("refs.json"))?)?; }
    let manifest = Manifest { version: 2, created_at: millis(), scope: "book+chapters+entities".into(), files: inventory(&pending)? };
    atomic_write(&pending.join("manifest.json"), &serde_json::to_vec_pretty(&manifest)?)?;
    validate_snapshot(&pending)?;
    fs::rename(&pending, root.join(&name))?;
    // A retention failure must not turn a successful backup into an apparent failure.
    if rotate { let _ = prune(book); }
    Ok(name)
}

pub fn create_snapshot(book: &Path, base: &str) -> io::Result<String> {
    recover_restore(book)?;
    create_inner(book, base, true)
}

#[derive(Serialize, Deserialize)]
struct RestoreItem { name: String, existed: bool, incoming: bool }
#[derive(Serialize, Deserialize)]
struct Journal { work: String, committed: bool, items: Vec<RestoreItem> }
const JOURNAL: &str = ".restore-journal.json";

fn read_journal(book: &Path) -> io::Result<Journal> {
    let journal: Journal = serde_json::from_slice(&fs::read(book.join(JOURNAL))?).map_err(|e| invalid(e.to_string()))?;
    simple_name(&journal.work)?;
    if !journal.work.starts_with(".restore-") || journal.items.is_empty() {
        return Err(invalid("恢复记录无效，已停止写入"));
    }
    let mut names = std::collections::HashSet::new();
    for item in &journal.items {
        if !["book.json", "chapters", "entities", "refs.json"].contains(&item.name.as_str()) || !names.insert(&item.name) {
            return Err(invalid("恢复记录包含无效路径"));
        }
    }
    Ok(journal)
}

/// An interrupted, uncommitted install always rolls back before the book is opened.
pub fn recover_restore(book: &Path) -> io::Result<bool> {
    if !book.join(JOURNAL).exists() { return Ok(false); }
    let journal = read_journal(book)?;
    let work = book.join(&journal.work);
    if !journal.committed {
        for item in journal.items.iter().rev() {
            let live = book.join(&item.name);
            let old = work.join("old").join(&item.name);
            let incoming = work.join("new").join(&item.name);
            if old.exists() {
                if live.exists() {
                    let discard = work.join(format!("discard-{}", token()));
                    fs::rename(&live, discard)?;
                }
                fs::rename(old, live)?;
            } else if !item.existed && item.incoming && !incoming.exists() && live.exists() {
                fs::rename(live, work.join(format!("discard-{}", token())))?;
            }
        }
    }
    validate_book(book)?;
    fs::remove_file(book.join(JOURNAL))?;
    let _ = fs::remove_dir_all(work);
    Ok(!journal.committed)
}

pub fn restore_snapshot(book: &Path, name: &str) -> io::Result<bool> {
    restore_inner(book, name, None)
}

fn restore_inner(book: &Path, name: &str, fail_after: Option<usize>) -> io::Result<bool> {
    simple_name(name)?;
    recover_restore(book)?;
    let source = book.join("snapshots").join(name);
    let legacy = validate_snapshot(&source)?;
    let work_name = format!(".restore-{}", token());
    let work = book.join(&work_name);
    let incoming = work.join("new");
    fs::create_dir_all(&incoming)?;
    fs::create_dir(work.join("old"))?;
    copy_tree(&source.join("chapters"), &incoming.join("chapters"))?;
    atomic_write(&incoming.join("book.json"), &fs::read(source.join("book.json"))?)?;
    if !legacy { copy_tree(&source.join("entities"), &incoming.join("entities"))?; }
    if source.join("refs.json").exists() { atomic_write(&incoming.join("refs.json"), &fs::read(source.join("refs.json"))?)?; }
    validate_book(&incoming)?;
    // Verify the recovery point before touching current content. Do not prune the selected source.
    create_inner(book, "before-restore", false)?;
    let names = if legacy { vec!["book.json", "chapters", "refs.json"] }
        else { vec!["book.json", "chapters", "entities", "refs.json"] };
    let mut journal = Journal {
        work: work_name, committed: false,
        items: names.iter().map(|name| RestoreItem {
            name: (*name).into(), existed: book.join(name).exists(), incoming: incoming.join(name).exists(),
        }).collect(),
    };
    atomic_write(&book.join(JOURNAL), &serde_json::to_vec(&journal)?)?;
    let result = (|| {
        for (index, item) in journal.items.iter().enumerate() {
            let live = book.join(&item.name);
            if item.existed { fs::rename(&live, work.join("old").join(&item.name))?; }
            if fail_after == Some(index) { return Err(invalid("模拟恢复中断")); }
            if item.incoming { fs::rename(incoming.join(&item.name), live)?; }
        }
        validate_book(book)?;
        journal.committed = true;
        atomic_write(&book.join(JOURNAL), &serde_json::to_vec(&journal)?)?;
        Ok(())
    })();
    if let Err(error) = result {
        recover_restore(book).map_err(|rollback| invalid(format!("恢复失败：{}；回滚未完成：{}。请保留作品文件夹。", error, rollback)))?;
        return Err(error);
    }
    recover_restore(book)?; // committed: clean up, do not roll back
    let _ = prune(book);
    Ok(legacy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!("drwrite-storage-test-{}", token()));
        fs::create_dir_all(path.join("chapters")).unwrap();
        fs::create_dir_all(path.join("entities")).unwrap();
        fs::write(path.join("book.json"), br#"{"id":"test","protocolVersion":1,"chapters":[{"id":"one"}]}"#).unwrap();
        fs::write(path.join("chapters/one.json"), br#"{"meta":{"id":"one"},"doc":{"type":"doc","content":[]}}"#).unwrap();
        fs::write(path.join("entities/person.json"), br#"{"name":"before"}"#).unwrap();
        path
    }
    #[test]
    fn replacement_and_failed_replacement_preserve_original() {
        let root = fixture();
        let path = root.join("中文稿件.json");
        atomic_write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        let directory = root.join("existing-directory");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("keep"), b"keep").unwrap();
        assert!(atomic_write(&directory, b"replacement").is_err());
        assert_eq!(fs::read(directory.join("keep")).unwrap(), b"keep");
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            let held = OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
            assert!(atomic_write(&path, b"lost").is_err());
            assert_eq!(fs::read(&path).unwrap(), b"new");
            drop(held);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn snapshot_restores_entities_and_detects_corruption() {
        let root = fixture();
        let name = create_snapshot(&root, "20261026-120000").unwrap();
        fs::write(root.join("entities/person.json"), br#"{"name":"after"}"#).unwrap();
        fs::write(root.join("entities/added-after.json"), b"[]").unwrap();
        assert!(!restore_snapshot(&root, &name).unwrap());
        assert_eq!(fs::read(root.join("entities/person.json")).unwrap(), br#"{"name":"before"}"#);
        assert!(!root.join("entities/added-after.json").exists());
        fs::write(root.join("snapshots").join(&name).join("entities/person.json"), br#"{"name":"tampered"}"#).unwrap();
        assert!(restore_snapshot(&root, &name).is_err());
        assert_eq!(fs::read(root.join("entities/person.json")).unwrap(), br#"{"name":"before"}"#);
        assert!(list_snapshots(&root).unwrap().iter().any(|s| s.name == name && !s.valid));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_restore_rolls_back_all_current_data() {
        let root = fixture();
        let name = create_snapshot(&root, "baseline").unwrap();
        fs::write(root.join("entities/person.json"), br#"{"name":"current"}"#).unwrap();
        for index in 0..4 {
            assert!(restore_inner(&root, &name, Some(index)).is_err());
            validate_book(&root).unwrap();
            assert_eq!(fs::read(root.join("entities/person.json")).unwrap(), br#"{"name":"current"}"#);
            assert!(!root.join(JOURNAL).exists());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_restore_keeps_entities_and_path_traversal_is_rejected() {
        let root = fixture();
        let old = root.join("snapshots/legacy");
        copy_tree(&root.join("chapters"), &old.join("chapters")).unwrap();
        fs::copy(root.join("book.json"), old.join("book.json")).unwrap();
        fs::write(root.join("entities/person.json"), br#"{"name":"current"}"#).unwrap();
        assert!(restore_snapshot(&root, "legacy").unwrap());
        assert_eq!(fs::read(root.join("entities/person.json")).unwrap(), br#"{"name":"current"}"#);
        assert!(restore_snapshot(&root, "../escape").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn interrupted_install_is_rolled_back_when_book_is_reopened() {
        let root = fixture();
        let work = root.join(".restore-interrupted");
        fs::create_dir_all(work.join("old")).unwrap();
        fs::create_dir_all(work.join("new")).unwrap();
        fs::rename(root.join("chapters"), work.join("old/chapters")).unwrap();
        fs::create_dir(root.join("chapters")).unwrap();
        let journal = Journal {
            work: ".restore-interrupted".into(), committed: false,
            items: vec![RestoreItem { name: "chapters".into(), existed: true, incoming: true }],
        };
        atomic_write(&root.join(JOURNAL), &serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(ensure_no_pending_restore(&root.join("entities/person.json")).is_err());
        assert!(recover_restore(&root).unwrap());
        validate_book(&root).unwrap();
        assert!(!recover_restore(&root).unwrap());
        assert!(ensure_no_pending_restore(&root.join("entities/person.json")).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}

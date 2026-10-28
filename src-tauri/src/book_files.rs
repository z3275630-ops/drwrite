//! Read-only snapshot views and verified external copies. No global settings are copied.
use serde::{Serialize, Deserialize};
use serde_json::Value;
use std::{fs, io, io::Write, path::{Component, Path, PathBuf}};
use crate::{book_lease, storage};
fn invalid(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, message) }
fn leaf(name: &str) -> io::Result<()> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() || name.ends_with(['.', ' ']) || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name.chars().any(|ch| ch.is_control()) || Path::new(name).components().count() != 1 || !matches!(Path::new(name).components().next(), Some(Component::Normal(_)))
        || ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit()) {
        return Err(invalid("名称不适用于 Windows 文件系统"));
    } Ok(())
}
pub(crate) fn reject_link(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return Err(invalid("不读取或复制符号链接与目录联接")); } }
    if metadata.file_type().is_symlink() { return Err(invalid("不读取或复制符号链接")); } Ok(())
}
fn snapshot_path(book: &Path, name: &str) -> io::Result<PathBuf> {
    leaf(name)?; let root = book.join("snapshots"); reject_link(&root)?;
    let path = root.join(name); reject_link(&path)?;
    if !fs::canonicalize(&path)?.starts_with(fs::canonicalize(book)?) { return Err(invalid("快照路径越界")); } Ok(path)
}
#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all="camelCase")]
pub struct Record { path: String, bytes: u64, checksum: String }
fn hash(bytes: &[u8]) -> String { let mut value=0xcbf29ce484222325u64; for byte in bytes { value ^= *byte as u64; value=value.wrapping_mul(0x100000001b3); } format!("{:016x}",value) }
fn scan(root: &Path, dir: &Path, records: &mut Vec<Record>) -> io::Result<()> {
    reject_link(dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?; let name = entry.file_name(); let name = name.to_string_lossy();
        if book_lease::is_runtime_entry(&name) { continue; }
        reject_link(&entry.path())?;
        if entry.file_type()?.is_dir() { scan(root, &entry.path(), records)?; }
        else if entry.file_type()?.is_file() {
            let data = fs::read(entry.path())?;
            records.push(Record { path: entry.path().strip_prefix(root).map_err(|_| invalid("路径越界"))?.to_string_lossy().replace('\\',"/"), bytes: data.len() as u64, checksum: hash(&data) });
        }
    } Ok(())
}
fn inventory(root: &Path) -> io::Result<Vec<Record>> { let mut records=vec![]; scan(root,root,&mut records)?; records.sort_by(|a,b|a.path.cmp(&b.path)); Ok(records) }
fn directories(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry=entry?; if book_lease::is_runtime_entry(&entry.file_name().to_string_lossy()) { continue; }
        reject_link(&entry.path())?;
        if entry.file_type()?.is_dir() { out.push(entry.path().strip_prefix(root).map_err(|_|invalid("路径越界"))?.to_path_buf()); directories(root,&entry.path(),out)?; }
    } Ok(())
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct FileChange { path: String, state: String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SnapshotView { book: Value, legacy: bool, changes: Vec<FileChange> }
pub fn preview_snapshot(book: &Path, name: &str) -> io::Result<SnapshotView> {
    let path = snapshot_path(book,name)?;
    let legacy = storage::validate_snapshot(&path)?;
    let before = if path.join("entities").exists() { inventory(&path.join("entities"))? } else { vec![] };
    let after = if book.join("entities").exists() { inventory(&book.join("entities"))? } else { vec![] };
    let mut keys = std::collections::BTreeSet::new(); for item in before.iter().chain(after.iter()) { keys.insert(item.path.clone()); }
    let changes = keys.into_iter().filter_map(|key| {
        let old=before.iter().find(|item|item.path==key); let current=after.iter().find(|item|item.path==key);
        let state=match (old,current) { (None,Some(_))=>"当前新增", (Some(_),None)=>"当前缺失", (Some(a),Some(b)) if a!=b=>"内容不同", _=>return None };
        Some(FileChange { path:key,state:state.into() })
    }).collect();
    let value = serde_json::from_slice(&fs::read(path.join("book.json"))?).map_err(|error|invalid(&error.to_string()))?;
    Ok(SnapshotView { book:value,legacy,changes })
}
pub fn snapshot_chapter(book: &Path, name: &str, id: &str) -> io::Result<Value> {
    leaf(id)?; let root=snapshot_path(book,name)?; let chapters=root.join("chapters"); reject_link(&chapters)?;
    let meta: Value=serde_json::from_slice(&fs::read(root.join("book.json"))?).map_err(|error|invalid(&error.to_string()))?;
    if !meta["chapters"].as_array().is_some_and(|list|list.iter().any(|chapter|chapter["id"]==id)) { return Err(invalid("快照中没有此章节")); }
    let chapter=chapters.join(format!("{}.json",id)); reject_link(&chapter)?; let bytes=fs::read(&chapter)?;
    if root.join("manifest.json").exists() {
        let manifest: Value=serde_json::from_slice(&fs::read(root.join("manifest.json"))?).map_err(|error|invalid(&error.to_string()))?;
        let relative=format!("chapters/{}.json",id);
        let record=manifest["files"].as_array().and_then(|files|files.iter().find(|file|file["path"]==relative)).ok_or_else(||invalid("清单缺少章节"))?;
        if record["checksum"]!=hash(&bytes) || record["bytes"].as_u64()!=Some(bytes.len() as u64) { return Err(invalid("快照章节校验失败")); }
    }
    serde_json::from_slice(&bytes).map_err(|error|invalid(&error.to_string()))
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CopyResult { path: String, files: usize, bytes: u64 }
#[derive(Deserialize)]
pub struct ExportFile { name: String, content: String }
pub fn export_files(parent: &Path, folder: &str, files: Vec<ExportFile>) -> io::Result<CopyResult> {
    leaf(folder)?; let parent=fs::canonicalize(parent)?; let target=parent.join(folder);
    if target.exists() { return Err(invalid("导出目录已存在，请换一个名称；未覆盖任何文件")); }
    if files.is_empty() { return Err(invalid("没有待导出的文件")); }
    let mut seen=std::collections::HashSet::new();
    for file in &files { leaf(&file.name)?; if !seen.insert(file.name.to_lowercase()) { return Err(invalid("导出文件名重复")); } }
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let pending=parent.join(format!(".pending-export-{}-{}",std::process::id(),stamp)); fs::create_dir(&pending)?;
    let result=(|| {
        let mut bytes=0;
        for file in &files {
            let data=file.content.as_bytes(); let mut file_handle=fs::OpenOptions::new().create_new(true).write(true).open(pending.join(&file.name))?;
            file_handle.write_all(data)?; file_handle.sync_all()?; drop(file_handle);
            if fs::read(pending.join(&file.name))?!=data { return Err(invalid("导出内容校验失败")); } bytes+=data.len() as u64;
        }
        if target.exists() { return Err(invalid("导出目标已被创建，未覆盖")); }
        fs::rename(&pending,&target)?; Ok(CopyResult { path:target.to_string_lossy().into_owned(),files:files.len(),bytes })
    })();
    result.map_err(|error:io::Error|io::Error::new(error.kind(),format!("{}；临时残留如有位于 {}，正式目录未确认发布",error,pending.display())))
}
pub fn external_copy(book: &Path, parent: &Path, name: &str, mut progress: impl FnMut(usize,usize,u64)) -> io::Result<CopyResult> {
    leaf(name)?; book_lease::assert_closed(book)?; storage::ensure_no_pending_restore(&book.join("book.json"))?;
    let source=fs::canonicalize(book)?; let parent=fs::canonicalize(parent)?;
    if !parent.is_dir() || parent.starts_with(&source) { return Err(invalid("副本目标不能位于源作品内部")); }
    let destination=parent.join(name); if destination.exists() { return Err(invalid("目标已存在，不会覆盖；请换一个名称")); }
    let records=inventory(&source)?;
    let mut folders=vec![]; directories(&source,&source,&mut folders)?; folders.sort();
    if !records.iter().any(|record|record.path=="book.json") { return Err(invalid("源目录缺少 book.json")); }
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let pending=parent.join(format!(".pending-{}-{}-{}",name,std::process::id(),stamp)); fs::create_dir(&pending)?;
    let result=(|| {
        let mut bytes=0;
        for folder in &folders { fs::create_dir_all(pending.join(folder))?; }
        for (index,record) in records.iter().enumerate() {
            let from=source.join(&record.path); reject_link(&from)?; let data=fs::read(from)?;
            if hash(&data)!=record.checksum { return Err(invalid("复制期间源文件变化，未发布副本")); }
            storage::atomic_write(&pending.join(&record.path),&data)?; bytes+=record.bytes; progress(index+1,records.len(),bytes);
        }
        let mut copied_folders=vec![]; directories(&pending,&pending,&mut copied_folders)?; copied_folders.sort();
        let mut source_folders=vec![]; directories(&source,&source,&mut source_folders)?; source_folders.sort();
        if inventory(&pending)?!=records || inventory(&source)?!=records || copied_folders!=folders || source_folders!=folders { return Err(invalid("副本清单校验不一致，未发布")); }
        if destination.exists() { return Err(invalid("目标已被创建，未覆盖")); }
        fs::rename(&pending,&destination)?;
        Ok(CopyResult { path:destination.to_string_lossy().into_owned(),files:records.len(),bytes })
    })();
    result.map_err(|error:io::Error|io::Error::new(error.kind(),format!("{}；正式副本未发布或未确认。临时文件如有残留位于 {}",error,pending.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let root=std::env::temp_dir().join(format!("drwrite-files-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("chapters")).unwrap(); fs::create_dir_all(root.join("entities/empty")).unwrap();
        storage::atomic_write(&root.join("book.json"),br#"{"protocolVersion":1,"id":"fixture","chapters":[{"id":"one","title":"one"}]}"#).unwrap();
        storage::atomic_write(&root.join("chapters/one.json"),br#"{"meta":{"id":"one"},"doc":{"type":"doc","content":[]}}"#).unwrap();
        storage::atomic_write(&root.join("entities/card.json"),br#"{"name":"old"}"#).unwrap(); root
    }
    #[test]
    fn snapshot_preview_is_read_only_and_checks_requested_chapter() {
        let root=fixture(); let name=storage::create_snapshot(&root,"fixture").unwrap();
        storage::atomic_write(&root.join("entities/card.json"),br#"{"name":"new"}"#).unwrap();
        let before=inventory(&root).unwrap();
        let preview=preview_snapshot(&root,&name).unwrap(); assert!(!preview.legacy); assert_eq!(preview.changes.len(),1);
        assert_eq!(snapshot_chapter(&root,&name,"one").unwrap()["meta"]["id"],"one");
        assert!(snapshot_chapter(&root,&name,"../one").is_err()); assert!(preview_snapshot(&root,"..").is_err());
        assert!(before==inventory(&root).unwrap());
        fs::write(root.join("snapshots").join(&name).join("chapters/one.json"),b"{}").unwrap();
        assert!(snapshot_chapter(&root,&name,"one").is_err()); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn verified_copy_preserves_empty_folders_never_overwrites_or_recurses() {
        let root=fixture(); let parent=root.parent().unwrap().to_path_buf(); let name=format!("copy-{}",root.file_name().unwrap().to_string_lossy());
        let result=external_copy(&root,&parent,&name,|_,_,_|{}).unwrap(); let copy=Path::new(&result.path);
        assert!(inventory(&root).unwrap()==inventory(copy).unwrap()); assert!(copy.join("entities/empty").is_dir());
        assert!(external_copy(&root,&parent,&name,|_,_,_|{}).is_err());
        assert!(external_copy(&root,&root.join("entities"),"nested",|_,_,_|{}).is_err());
        assert!(external_copy(&root,&parent,"CON.txt",|_,_,_|{}).is_err());
        fs::remove_dir_all(copy).unwrap(); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn export_publishes_only_a_new_directory_and_rejects_name_collisions() {
        let root=fixture();
        let file=||ExportFile { name:"001-first.md".into(),content:"synthetic export".into() };
        let result=export_files(&root,"export",vec![file()]).unwrap();
        assert_eq!(fs::read_to_string(Path::new(&result.path).join("001-first.md")).unwrap(),"synthetic export");
        assert!(export_files(&root,"export",vec![file()]).is_err());
        assert!(export_files(&root,"bad",vec![file(),ExportFile { name:"001-FIRST.md".into(),content:"different".into() }]).is_err());
        assert!(!root.join("bad").exists());
        assert!(export_files(&root,"invalid",vec![ExportFile { name:"../outside.txt".into(),content:"no".into() }]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

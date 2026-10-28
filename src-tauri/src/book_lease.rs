//! Cooperative ownership across Drwrite processes; the OS releases locks after a crash.
use std::{collections::{HashMap, HashSet}, fs::{self, File}, io, path::{Path, PathBuf}, sync::{LazyLock, Mutex}};
const LOCK_NAME: &str = ".drwrite-writer.lock";
struct Lease { _file: File, tokens: HashSet<String> }
static LEASES: LazyLock<Mutex<HashMap<PathBuf, Lease>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
fn busy() -> io::Error { io::Error::new(io::ErrorKind::WouldBlock, "另一个 Drwrite 正在编辑此作品，请先在那个窗口回到书架或关闭作品") }
fn open_lock(book: &Path) -> io::Result<File> { File::options().create(true).truncate(false).read(true).write(true).open(book.join(LOCK_NAME)) }
pub fn acquire(book: &Path, token: String) -> io::Result<()> {
    let path = fs::canonicalize(book)?;
    let mut leases = LEASES.lock().map_err(|_| busy())?;
    if let Some(lease) = leases.get_mut(&path) { lease.tokens.insert(token); return Ok(()); }
    let file = open_lock(&path)?; file.try_lock().map_err(|_| busy())?;
    leases.insert(path, Lease { _file: file, tokens: HashSet::from([token]) }); Ok(())
}
pub fn release(book: &Path, token: &str) -> io::Result<()> {
    let path = fs::canonicalize(book)?;
    let mut leases = LEASES.lock().map_err(|_| busy())?;
    if let Some(lease) = leases.get_mut(&path) { lease.tokens.remove(token); if lease.tokens.is_empty() { leases.remove(&path); } }
    Ok(())
}
/// Called while io_job holds the process-wide and cross-process IO locks.
pub fn assert_access(book: &Path) -> io::Result<()> {
    let path = fs::canonicalize(book)?;
    if LEASES.lock().map_err(|_| busy())?.contains_key(&path) { return Ok(()); }
    if path.join(LOCK_NAME).exists() { let file = open_lock(&path)?; file.try_lock().map_err(|_| busy())?; }
    Ok(())
}
pub fn assert_path_access(path: &Path) -> io::Result<()> {
    for parent in path.ancestors() {
        if parent.join(LOCK_NAME).exists() { return assert_access(parent); }
    }
    Ok(())
}
pub fn assert_closed(book: &Path) -> io::Result<()> {
    let path=fs::canonicalize(book)?;
    if LEASES.lock().map_err(|_|busy())?.contains_key(&path) {
        return Err(io::Error::new(io::ErrorKind::WouldBlock,"作品仍在编辑或完成后台保存，请回到书架后稍候重试完整副本"));
    }
    assert_access(&path)
}
pub fn is_runtime_entry(name: &str) -> bool { name == LOCK_NAME || name.starts_with(".pending-") || name.starts_with(".restore-") }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multiple_react_effects_do_not_release_each_others_lease() {
        let root = std::env::temp_dir().join(format!("drwrite-lease-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        acquire(&root, "first".into()).unwrap(); acquire(&root, "second".into()).unwrap(); release(&root, "first").unwrap();
        let external = open_lock(&root).unwrap(); assert!(external.try_lock().is_err());
        release(&root, "second").unwrap(); assert!(external.try_lock().is_ok()); drop(external);
        fs::remove_dir_all(root).unwrap();
    }
}

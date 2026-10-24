/**
 * Drwrite 桌面外壳：所有磁盘读写都走这里，前端只通过 invoke 调用。
 * 不用 fs 插件的 scope 体系 —— 自己的命令天然只暴露明确的能力，边界更清楚。
 */
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::Manager;

/// 读一个 JSON 文件
#[tauri::command]
fn read_json_file(path: String) -> Result<Value, String> {
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

/// 写 JSON 文件（先写临时文件再替换，防止写一半崩溃毁掉原文件）
#[tauri::command]
fn write_json_file(path: String, value: Value) -> Result<(), String> {
    let s = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    write_text_file(path, s + "\n")
}

/// 写纯文本文件，同样走临时文件替换
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = format!("{}.tmp", path);
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    // Windows 上 rename 不能覆盖已存在文件，先删旧的
    if Path::new(&path).exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 列目录：目录项带结尾 "/"，文件不带；按名称排序
#[tauri::command]
fn list_dir_entries(path: String) -> Result<Vec<String>, String> {
    let mut out: Vec<(bool, String)> = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push((is_dir, entry.file_name().to_string_lossy().to_string()));
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(out
        .into_iter()
        .map(|(is_dir, name)| if is_dir { format!("{}/", name) } else { name })
        .collect())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// 删除整个目录（删除作品 / 清理旧快照用），调用前前端必须弹确认
#[tauri::command]
fn delete_dir(path: String) -> Result<(), String> {
    fs::remove_dir_all(&path).map_err(|e| e.to_string())
}

/// 递归复制目录（做快照 / 恢复快照用）
#[tauri::command]
fn copy_tree(src: String, dst: String) -> Result<(), String> {
    let src_path = Path::new(&src);
    if !src_path.is_dir() {
        return Err(format!("源目录不存在: {}", src));
    }
    copy_dir_inner(src_path, Path::new(&dst)).map_err(|e| e.to_string())
}

fn copy_dir_inner(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_inner(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// 默认书库位置：文档\Drwrite 书库
#[tauri::command]
fn default_library_dir(app: tauri::AppHandle) -> Result<String, String> {
    let doc = app.path().document_dir().map_err(|e| e.to_string())?;
    Ok(doc
        .join("Drwrite 书库")
        .to_string_lossy()
        .into_owned())
}

/// 全局设置文件路径（appdata 下的 settings.json）
#[tauri::command]
fn app_settings_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json").to_string_lossy().into_owned())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_json_file,
            write_json_file,
            write_text_file,
            list_dir_entries,
            path_exists,
            create_dir,
            delete_file,
            delete_dir,
            copy_tree,
            default_library_dir,
            app_settings_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

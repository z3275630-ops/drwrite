/**
 * Drwrite 桌面外壳：所有磁盘读写都走这里，前端只通过 invoke 调用。
 * 不用 fs 插件的 scope 体系 —— 自己的命令天然只暴露明确的能力，边界更清楚。
 */
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::Manager;
mod storage;

fn io_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    storage::IO_LOCK.lock().map_err(|_| "文件操作未完成，请重启后重试".into())
}

/// 读一个 JSON 文件
#[tauri::command]
fn read_json_file(path: String) -> Result<Value, String> {
    let _guard = io_guard()?;
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
    let _guard = io_guard()?;
    storage::ensure_no_pending_restore(Path::new(&path)).map_err(|e| e.to_string())?;
    storage::atomic_write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

/// 列目录：目录项带结尾 "/"，文件不带；按名称排序
#[tauri::command]
fn list_dir_entries(path: String) -> Result<Vec<String>, String> {
    let _guard = io_guard()?;
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
    let _guard = io_guard()?;
    storage::ensure_no_pending_restore(Path::new(&path)).map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let _guard = io_guard()?;
    storage::ensure_no_pending_restore(Path::new(&path)).map_err(|e| e.to_string())?;
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// 删除整个目录（删除作品 / 清理旧快照用），调用前前端必须弹确认
#[tauri::command]
fn delete_dir(path: String) -> Result<(), String> {
    let _guard = io_guard()?;
    storage::ensure_no_pending_restore(Path::new(&path)).map_err(|e| e.to_string())?;
    fs::remove_dir_all(&path).map_err(|e| e.to_string())
}

/// 递归复制目录（做快照 / 恢复快照用）
#[tauri::command]
fn copy_tree(src: String, dst: String) -> Result<(), String> {
    let _guard = io_guard()?;
    storage::ensure_no_pending_restore(Path::new(&dst)).map_err(|e| e.to_string())?;
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

#[tauri::command]
fn create_book_snapshot(book_dir: String, name_base: String) -> Result<String, String> {
    let _guard = io_guard()?;
    storage::create_snapshot(Path::new(&book_dir), &name_base).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_book_snapshots(book_dir: String) -> Result<Vec<storage::SnapshotInfo>, String> {
    let _guard = io_guard()?;
    storage::list_snapshots(Path::new(&book_dir)).map_err(|e| e.to_string())
}

#[tauri::command]
fn restore_book_snapshot(book_dir: String, name: String) -> Result<bool, String> {
    let _guard = io_guard()?;
    storage::restore_snapshot(Path::new(&book_dir), &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn recover_book_restore(book_dir: String) -> Result<bool, String> {
    let _guard = io_guard()?;
    storage::recover_restore(Path::new(&book_dir)).map_err(|e| e.to_string())
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

/* ---------- AI 网关（OpenAI 兼容 /chat/completions） ---------- */

#[derive(serde::Serialize, serde::Deserialize)]
struct AiMessage {
    role: String,
    content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatArgs {
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<AiMessage>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    effort: Option<String>,
}

/// 在 Rust 侧直连模型接口：不受 WebView CORS 限制，Ollama 这类本地端点也能用。
/// 异步命令跑在线程池上，阻塞等待不会卡界面。
#[tauri::command]
async fn ai_chat(args: AiChatArgs) -> Result<Value, String> {
    let url = format!("{}/chat/completions", args.base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
        "max_tokens": args.max_tokens.unwrap_or(2048),
        "temperature": args.temperature.unwrap_or(0.8),
        "stream": false,
    });
    if let Some(effort) = &args.effort {
        body["effort"] = serde_json::Value::String(effort.clone());
    }
    let req = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(180))
        .set("Authorization", format!("Bearer {}", args.api_key).as_str());
    let resp = match req.send_json(body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            return Err(format!("接口返回 {}：{}", code, shorten(&detail, 300)));
        }
        Err(e) => {
            return Err(format!(
                "连接失败（检查地址与网络）：{}",
                shorten(&e.to_string(), 200)
            ))
        }
    };
    resp.into_json::<Value>().map_err(|e| format!("响应解析失败：{}", e))
}

/// 流式对话补全：SSE 逐块读，把增量经 Channel 推给前端，结束返回汇总。
/// 事件格式（JSON 字符串）：{"t":"c","v":"全文sofar"} 正文；{"t":"r","n":字数} 思考进度；
/// 最后 invoke 返回 {"content":..,"finish_reason":..,"usage":..,"reasoning_chars":..}
#[tauri::command]
async fn ai_chat_stream(
    args: AiChatArgs,
    on_event: tauri::ipc::Channel<String>,
) -> Result<Value, String> {
    use std::io::BufRead;

    let url = format!("{}/chat/completions", args.base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
        "max_tokens": args.max_tokens.unwrap_or(2048),
        "temperature": args.temperature.unwrap_or(0.8),
        "stream": true,
    });
    if let Some(effort) = &args.effort {
        body["effort"] = serde_json::Value::String(effort.clone());
    }
    // 只限连接与单次读取超时，不限总时长：流式响应可能持续几分钟
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120))
        .build();
    let req = agent
        .post(&url)
        .set("Authorization", format!("Bearer {}", args.api_key).as_str());
    let resp = match req.send_json(body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            return Err(format!("接口返回 {}：{}", code, shorten(&detail, 300)));
        }
        Err(e) => {
            return Err(format!(
                "连接失败（检查地址与网络）：{}",
                shorten(&e.to_string(), 200)
            ))
        }
    };

    let reader = resp.into_reader();
    let mut buf = std::io::BufReader::new(reader);
    let mut line = String::new();
    let mut content = String::new();
    let mut reasoning_chars: usize = 0;
    let mut finish: Option<String> = None;
    let mut usage = serde_json::json!({});

    loop {
        line.clear();
        let n = buf.read_line(&mut line).map_err(|e| format!("读取中断：{}", e))?;
        if n == 0 {
            break;
        }
        let l = line.trim();
        if !l.starts_with("data:") {
            continue;
        }
        let payload = l[5..].trim();
        if payload == "[DONE]" {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        if let Some(choice) = chunk["choices"].get(0) {
            if let Some(d) = choice["delta"]["content"].as_str() {
                if !d.is_empty() {
                    content.push_str(d);
                    let _ = on_event.send(serde_json::json!({ "t": "c", "v": content }).to_string());
                }
            }
            if let Some(r) = choice["delta"]["reasoning_content"].as_str() {
                if !r.is_empty() {
                    reasoning_chars += r.chars().count();
                    let _ = on_event.send(serde_json::json!({ "t": "r", "n": reasoning_chars }).to_string());
                }
            }
            if let Some(f) = choice["finish_reason"].as_str() {
                finish = Some(f.to_string());
            }
        }
        if chunk.get("usage").map(|u| u.is_object()).unwrap_or(false) {
            usage = chunk["usage"].clone();
        }
    }

    Ok(serde_json::json!({
        "content": content,
        "finish_reason": finish,
        "usage": usage,
        "reasoning_chars": reasoning_chars,
    }))
}

/// 读纯文本文件：先按 UTF-8，失败按 GBK 解码（老 TXT 导入用）
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => {
            let (cow, _, had_errors) = encoding_rs::GBK.decode(&bytes);
            if had_errors {
                return Err("文件既不是 UTF-8 也不是 GBK 编码".into());
            }
            Ok(cow.into_owned())
        }
    }
}

/// 关窗兜底：窗口销毁被 ACL 拦下时也能真正退出（调用前正文已落盘）
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn shorten(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut cut = max;
        while cut > 0 && !s.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &s[..cut])
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_json_file,
            write_json_file,
            write_text_file,
            read_text_file,
            list_dir_entries,
            path_exists,
            create_dir,
            delete_file,
            delete_dir,
            copy_tree,
            create_book_snapshot,
            list_book_snapshots,
            restore_book_snapshot,
            recover_book_restore,
            default_library_dir,
            app_settings_path,
            ai_chat,
            ai_chat_stream,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

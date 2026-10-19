use crate::app::Host;
use riftmind_core::contracts::*;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;
pub async fn check(app: &AppHandle, install: bool) -> Result<UpdateStatus> {
    let (Some(endpoint), Some(key)) = (
        option_env!("RIFTMIND_UPDATE_URL"),
        option_env!("RIFTMIND_UPDATE_PUBLIC_KEY"),
    ) else {
        return Ok(UpdateStatus {
            state: "unavailable".into(),
            version: None,
            downloaded: 0.,
            total: None,
            reason: Some(ErrorCode::UpdateNotConfigured),
        });
    };
    let url = reqwest::Url::parse(endpoint).map_err(|_| AppError::new(ErrorCode::UpdateFailed))?;
    if url.scheme() != "https" {
        return Err(AppError::new(ErrorCode::UpdateFailed));
    }
    let host_service = app.state::<Host>().service.read().await.clone();
    let exit_app = app.clone();
    let updater = app
        .updater_builder()
        .pubkey(key)
        .on_before_exit(move || {
            if let Some(service) = &host_service {
                let result = tokio::task::block_in_place(|| {
                    tauri::async_runtime::block_on(service.shutdown())
                });
                if let Err(error) = result {
                    log::error!(
                        "update shutdown request={} code={:?}",
                        error.request_id,
                        error.code
                    );
                }
            }
            exit_app
                .state::<Host>()
                .quitting
                .store(true, std::sync::atomic::Ordering::SeqCst);
        })
        .endpoints(vec![url])
        .map_err(|_| AppError::new(ErrorCode::UpdateFailed))?
        .build()
        .map_err(|_| AppError::new(ErrorCode::UpdateFailed))?;
    let update = updater
        .check()
        .await
        .map_err(|_| AppError::new(ErrorCode::UpdateFailed))?;
    if let Some(update) = update {
        let version = update.version.clone();
        if install {
            let service = app
                .state::<Host>()
                .service
                .read()
                .await
                .clone()
                .ok_or(AppError::new(ErrorCode::AppNotReady))?;
            let events = service.clone();
            let mut downloaded = 0_u64;
            let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
            let progress_version = version.clone();
            let bytes = update
                .download(
                    move |chunk, total| {
                        downloaded += chunk as u64;
                        if last.elapsed() < std::time::Duration::from_millis(250) {
                            return;
                        }
                        last = std::time::Instant::now();
                        let events = events.clone();
                        let version = progress_version.clone();
                        tauri::async_runtime::spawn(async move {
                            let status = UpdateStatus {
                                state: "downloading".into(),
                                version: Some(version),
                                downloaded: downloaded as f64,
                                total: total.map(|n| n as f64),
                                reason: None,
                            };
                            events.state.write().await.update_status = status;
                            events.emit("update-changed", None, 0).await;
                        });
                    },
                    || {},
                )
                .await
                .map_err(|_| AppError::new(ErrorCode::UpdateFailed))?;
            // Signature verification finishes before the updater's safe-exit hook runs.
            update
                .install(bytes)
                .map_err(|_| AppError::new(ErrorCode::UpdateFailed))?;
        }
        Ok(UpdateStatus {
            state: if install { "installed" } else { "available" }.into(),
            version: Some(version),
            downloaded: 0.,
            total: None,
            reason: None,
        })
    } else {
        Ok(UpdateStatus {
            state: "up_to_date".into(),
            version: None,
            downloaded: 0.,
            total: None,
            reason: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
    };
    #[tokio::test]
    async fn updater_verifies_signed_payload_and_rejects_tampering() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let tampered = Arc::new(AtomicBool::new(false));
        let flag = tampered.clone();
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming().take(4) {
                let mut stream = stream.unwrap();
                let mut request = [0; 4096];
                let n = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..n]);
                let (mime, body) = if request.starts_with("GET /latest ") {
                    ("application/json",serde_json::to_vec(&serde_json::json!({"version":"9.9.9","notes":"Synthetic signed fixture","url":format!("http://{address}/payload"),"signature":include_str!("../../../tests/fixtures/update-artifact.bin.sig").trim()})).unwrap())
                } else {
                    (
                        "application/octet-stream",
                        if flag.load(Ordering::SeqCst) {
                            b"tampered payload".to_vec()
                        } else {
                            include_bytes!("../../../tests/fixtures/update-artifact.bin").to_vec()
                        },
                    )
                };
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert("updater".into(),serde_json::json!({"pubkey":include_str!("../../../tests/fixtures/update-test.pub").trim(),"dangerousInsecureTransportProtocol":true,"requireSignedVersion":true}));
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("windows-x86_64")
            .endpoints(vec![format!("http://{address}/latest").parse().unwrap()])
            .unwrap()
            .build()
            .unwrap();
        let update = updater.check().await.unwrap().unwrap();
        let payload = update.download(|_, _| {}, || {}).await.unwrap();
        assert_eq!(
            payload,
            include_bytes!("../../../tests/fixtures/update-artifact.bin")
        );
        tampered.store(true, Ordering::SeqCst);
        let update = updater.check().await.unwrap().unwrap();
        assert!(update.download(|_, _| {}, || {}).await.is_err());
        thread.join().unwrap();
    }
}

use riftmind_core::{
    clients::{HttpRemote, LcuClient},
    contracts::*,
    domain,
    services::Service,
};
use std::{sync::Arc, time::Duration};
use sysinfo::System;
struct Candidate {
    public: ClientInstance,
    lcu: LcuClient,
}
fn discover() -> Vec<Candidate> {
    let system = System::new_all();
    system
        .processes()
        .iter()
        .filter_map(|(pid, p)| {
            if !p
                .name()
                .to_string_lossy()
                .eq_ignore_ascii_case("LeagueClientUx.exe")
            {
                return None;
            }
            let cmd = p
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            #[cfg(target_os = "windows")]
            let cmd = if cmd.is_empty() {
                super::client_process_arguments::read_command_line(pid.as_u32())?
            } else {
                cmd
            };
            let port = domain::command_line_value(&cmd, "app-port")?
                .parse::<u16>()
                .ok()?;
            let token = domain::command_line_value(&cmd, "remoting-auth-token")?;
            let public = ClientInstance {
                id: format!("{}-{}", pid, p.start_time()),
                pid: pid.to_string(),
                started_at: p.start_time().to_string(),
                identification: domain::parse_identification(&cmd),
            };
            Some(Candidate {
                public,
                lcu: LcuClient::new(port, token).ok()?,
            })
        })
        .collect()
}
pub async fn monitor(service: Arc<Service>) {
    let wake = Arc::new(tokio::sync::Notify::new());
    let mut ws_id = String::new();
    let mut ws_task: Option<tokio::task::JoinHandle<()>> = None;
    loop {
        if service.state.read().await.phase == AppPhase::ShuttingDown {
            if let Some(task) = ws_task.take() {
                task.abort();
            }
            return;
        }
        if !service.settings.lock().await.auto_connect {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }
        let candidates = tokio::task::spawn_blocking(discover)
            .await
            .unwrap_or_default();
        *service.instances.write().await = candidates.iter().map(|c| c.public.clone()).collect();
        let selected = service
            .connection
            .read()
            .await
            .instance
            .as_ref()
            .map(|i| i.id.clone());
        let candidate = if candidates.len() == 1 {
            candidates.into_iter().next()
        } else {
            candidates
                .into_iter()
                .find(|c| Some(&c.public.id) == selected.as_ref())
        };
        if let Some(candidate) = candidate {
            let lcu = candidate.lcu;
            if ws_id != candidate.public.id {
                if let Some(task) = ws_task.take() {
                    task.abort();
                }
                ws_id = candidate.public.id.clone();
                let client = lcu.clone();
                let notify = wake.clone();
                ws_task = Some(tokio::spawn(async move {
                    use futures_util::StreamExt;
                    let mut delay = 1;
                    loop {
                        match client.subscribe().await {
                            Ok(mut socket) => {
                                delay = 1;
                                // Reconcile after subscribing, including reconnects that missed events.
                                notify.notify_one();
                                while let Some(Ok(message)) = socket.next().await {
                                    if message.is_text() {
                                        notify.notify_one();
                                    }
                                }
                            }
                            Err(_) => {}
                        }
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                        delay = (delay * 2).min(30);
                    }
                }));
            }
            let summoner = lcu.get("/lol-summoner/v1/current-summoner").await;
            let mut c = ConnectionState {
                instance: Some(candidate.public.clone()),
                phase: ConnectionPhase::WaitingAuth,
                ..ConnectionState::default()
            };
            if let Ok(s) = summoner {
                let session = lcu.get("/riotclient/region-locale").await.ok();
                let ident = domain::identify(
                    candidate.public.identification.region.as_deref(),
                    candidate.public.identification.rso_platform_id.as_deref(),
                    session
                        .as_ref()
                        .and_then(|v| v.get("region"))
                        .and_then(|v| v.as_str())
                        .filter(|v| *v != "TENCENT"),
                );
                c.identification = Some(ident.clone());
                if let (Some(server), Some(_)) = (
                    ident.server_id.as_ref(),
                    s.get("puuid")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty()),
                ) {
                    if let Ok(player) = riftmind_core::clients::player_from_summoner(&s, server, "")
                    {
                        let tokens = lcu.tokens().await.unwrap_or_default();
                        c.sgp_ready = tokens.rso.is_some();
                        c.lcu_ready = true;
                        c.player = Some(player);
                        c.phase = if ident.environment != "live" {
                            ConnectionPhase::Unsupported
                        } else if c.sgp_ready {
                            ConnectionPhase::Connected
                        } else {
                            ConnectionPhase::WaitingAuth
                        };
                        if let Some(server) =
                            domain::servers().into_iter().find(|s| s.id == *server)
                        {
                            let remote =
                                Arc::new(HttpRemote::new(Some(lcu.clone()), server, tokens));
                            let _ = service.set_connection(c, Some(remote)).await;
                        }
                    }
                } else {
                    c.phase = if ident.evidence.iter().any(|e| e == "conflict") {
                        ConnectionPhase::Conflict
                    } else {
                        ConnectionPhase::Unsupported
                    };
                    let _ = service.set_connection(c, None).await;
                }
            } else {
                let _ = service.set_connection(c, None).await;
            }
            if service.refresh_live().await.is_err() {
                service.live.write().await.stale = true;
                service.emit("live-changed", None, 0).await;
            }
        } else {
            if let Some(task) = ws_task.take() {
                task.abort();
            }
            ws_id.clear();
            let mut c = ConnectionState::default();
            if service.instances.read().await.len() > 1 {
                c.phase = ConnectionPhase::Selecting;
            }
            let _ = service.set_connection(c, None).await;
        }
        tokio::select! {_=tokio::time::sleep(Duration::from_secs(3))=>{},_=wake.notified()=>{}}
    }
}

use async_trait::async_trait;
use riftmind_core::{
    clients::{self, MatchRemote},
    contracts::*,
    domain,
    services::Service,
    settings::JsonSettingsStore,
    storage,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;

#[test]
fn summoner_identity_uses_real_fields_and_keeps_missing_or_invalid_metadata_absent() {
    let raw = json!({
        "puuid": "real-player",
        "gameName": "Player",
        "tagLine": "NA1",
        "profileIconId": 5091,
        "summonerLevel": 182
    });
    let player = clients::player_from_summoner(&raw, "NA1", "").unwrap();
    assert_eq!(player.display_name, "Player#NA1");
    assert_eq!(player.profile_icon_id, Some(5091));
    assert_eq!(player.summoner_level, Some(182));
    for metadata in [
        json!({}),
        json!({"profileIconId": -1, "summonerLevel": 0}),
        json!({"profileIconId": 4294967296_u64, "summonerLevel": "182"}),
    ] {
        let mut raw = json!({"puuid": "real-player", "displayName": "Player"});
        raw.as_object_mut()
            .unwrap()
            .extend(metadata.as_object().unwrap().clone());
        let player = clients::player_from_summoner(&raw, "NA1", "").unwrap();
        assert_eq!(player.profile_icon_id, None);
        assert_eq!(player.summoner_level, None);
    }
    let legacy: Player = serde_json::from_value(json!({
        "playerKey": "NA1:old-player",
        "serverId": "NA1",
        "puuid": "old-player",
        "displayName": "Old Player",
        "updatedAt": "2026-10-19T08:00:00Z"
    }))
    .unwrap();
    assert_eq!(legacy.profile_icon_id, None);
    assert_eq!(legacy.summoner_level, None);
}

#[tokio::test]
async fn old_workspace_upgrade_preserves_players_and_metadata_survives_incomplete_updates_and_restart()
 {
    let root = tempfile::tempdir_in(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.tmp")).unwrap();
    let path = root.path().join("riftmind.db");
    let old_pool = storage::connect(&path).await.unwrap();
    for (_, _, migration) in &storage::SCHEMA_MIGRATIONS[..5] {
        sqlx::Executor::execute(&old_pool, *migration)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO players VALUES(?,?,?,?,?)")
        .bind("NA1:legacy-player")
        .bind("NA1")
        .bind("legacy-player")
        .bind("Original name")
        .bind("2026-10-19T08:00:00Z")
        .execute(&old_pool)
        .await
        .unwrap();
    old_pool.close().await;
    let pool = storage::open(&path).await.unwrap();
    let mut player = storage::players(&pool).await.unwrap().remove(0);
    assert_eq!(player.display_name, "Original name");
    assert_eq!(player.profile_icon_id, None);
    assert_eq!(player.summoner_level, None);
    player.profile_icon_id = Some(5091);
    player.summoner_level = Some(182);
    storage::save_player(&pool, &player).await.unwrap();
    player.display_name.clear();
    player.profile_icon_id = None;
    player.summoner_level = None;
    let merged = storage::save_player(&pool, &player).await.unwrap();
    assert_eq!(merged.display_name, "Original name");
    assert_eq!(merged.profile_icon_id, Some(5091));
    assert_eq!(merged.summoner_level, Some(182));
    pool.close().await;
    let restarted = storage::open(&path).await.unwrap();
    let saved = storage::players(&restarted).await.unwrap().remove(0);
    assert_eq!(saved.profile_icon_id, Some(5091));
    assert_eq!(saved.summoner_level, Some(182));
    restarted.close().await;
}

struct SummonerRemote(Mutex<Value>);
#[async_trait]
impl MatchRemote for SummonerRemote {
    async fn search(&self, _: &str) -> Result<Value> {
        Ok(self.0.lock().await.clone())
    }
    async fn page(&self, _: &Player, _: u32, _: Source) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
}

#[tokio::test]
async fn search_and_connection_preserve_profile_metadata_through_backup_and_offline_restore() {
    let root = tempfile::tempdir_in(concat!(env!("CARGO_MANIFEST_DIR"), "/../../.tmp")).unwrap();
    let path = root.path().join("riftmind.db");
    let service = Service::new(
        storage::open(&path).await.unwrap(),
        root.path().into(),
        Arc::new(JsonSettingsStore(root.path().join("settings.json"))),
    )
    .await
    .unwrap();
    service.settings.lock().await.auto_sync = false;
    let remote = Arc::new(SummonerRemote(Mutex::new(json!({
        "puuid": "searched-player",
        "gameName": "Search Player",
        "tagLine": "NA1",
        "profileIconId": 5091,
        "summonerLevel": 182
    }))));
    let mut current = clients::synthetic_player("NA1");
    current.profile_icon_id = Some(12);
    current.summoner_level = Some(30);
    let mut connection = ConnectionState {
        phase: ConnectionPhase::Connected,
        player: Some(current.clone()),
        identification: Some(domain::identify(Some("NA"), None, None)),
        sgp_ready: true,
        ..ConnectionState::default()
    };
    service
        .set_connection(connection.clone(), Some(remote.clone()))
        .await
        .unwrap();
    connection.player.as_mut().unwrap().profile_icon_id = None;
    connection.player.as_mut().unwrap().summoner_level = None;
    service
        .set_connection(connection, Some(remote.clone()))
        .await
        .unwrap();
    assert_eq!(
        service
            .connection
            .read()
            .await
            .player
            .as_ref()
            .unwrap()
            .profile_icon_id,
        Some(12)
    );
    let searched = service
        .search_player(PlayerSearch {
            query: "Search Player#NA1".into(),
        })
        .await
        .unwrap();
    assert_eq!(searched.profile_icon_id, Some(5091));
    assert_eq!(searched.summoner_level, Some(182));
    remote
        .0
        .lock()
        .await
        .as_object_mut()
        .unwrap()
        .remove("profileIconId");
    remote
        .0
        .lock()
        .await
        .as_object_mut()
        .unwrap()
        .remove("summonerLevel");
    let incomplete = service
        .search_player(PlayerSearch {
            query: "Search Player#NA1".into(),
        })
        .await
        .unwrap();
    assert_eq!(incomplete.profile_icon_id, Some(5091));
    assert_eq!(incomplete.summoner_level, Some(182));
    let metric = json!({"value": null, "samples": 0, "excluded": {}});
    let mut legacy_player = serde_json::to_value(&incomplete).unwrap();
    legacy_player
        .as_object_mut()
        .unwrap()
        .remove("profileIconId");
    legacy_player
        .as_object_mut()
        .unwrap()
        .remove("summonerLevel");
    let cached_profile = json!({
        "player": legacy_player, "source": "lcu", "collectedAt": storage::now(),
        "ranks": [], "rankError": null, "queueId": null, "games": 0,
        "winRate": metric, "kda": metric, "champions": [], "championGames": 0,
        "championWinRate": metric, "championKda": metric
    });
    sqlx::query("INSERT INTO player_profiles VALUES(?,?,?,?)")
        .bind(&incomplete.player_key)
        .bind("all")
        .bind(storage::now())
        .bind(cached_profile.to_string())
        .execute(&service.pool)
        .await
        .unwrap();
    let cached = service
        .player_profile(PlayerProfileQuery {
            player_key: incomplete.player_key.clone(),
            queue_id: None,
            champion_id: None,
        })
        .await
        .unwrap();
    assert_eq!(cached.player.profile_icon_id, Some(5091));
    assert_eq!(cached.player.summoner_level, Some(182));
    let backup = service.backup().await.unwrap();
    let mut changed = searched;
    changed.summoner_level = Some(183);
    storage::save_player(&service.pool, &changed).await.unwrap();
    service.restore(&backup.reference).await.unwrap();
    service.pool.close().await;
    let offline = storage::open(&path).await.unwrap();
    let restored = storage::players(&offline).await.unwrap();
    let searched = restored
        .iter()
        .find(|player| player.puuid == "searched-player")
        .unwrap();
    assert_eq!(searched.profile_icon_id, Some(5091));
    assert_eq!(searched.summoner_level, Some(182));
    offline.close().await;
}

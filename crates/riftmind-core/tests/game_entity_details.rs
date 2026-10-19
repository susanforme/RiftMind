use axum::{Router, extract::OriginalUri, http::StatusCode, response::IntoResponse, routing::get};
use riftmind_core::{contracts::*, services::resources::ResourceClient, storage};
use serde_json::json;
use std::path::Path;

#[tokio::test]
async fn loadout_details_preserve_patch_locale_and_catalogue_values_without_images() {
    let app = Router::new().fallback(get(|uri: OriginalUri| async move {
        assert!(uri.path().starts_with("/16.20/plugins/rcp-be-lol-game-data/global/"));
        if uri.path().contains("/zh_cn/") {
            return StatusCode::NOT_FOUND.into_response();
        }
        let catalogue = if uri.path().ends_with("items.json") {
            json!([{"id":3089,"name":"Hat","description":"<stats>130 Ability Power</stats><br>Increase ability power.","price":1200,"priceTotal":3600}])
        } else if uri.path().ends_with("perks.json") {
            json!([{"id":8112,"name":"Electrocute","longDesc":"Hit a champion 3 times for bonus damage.","shortDesc":"Bonus damage","tooltip":"@Unresolved@"}])
        } else if uri.path().ends_with("perkstyles.json") {
            json!({"styles":[{"id":8200,"name":"Sorcery","tooltip":"Empowered abilities"}]})
        } else if uri.path().ends_with("summoner-spells.json") {
            json!([{"id":4,"name":"Flash","description":"Teleport a short distance.","cooldown":300}])
        } else {
            return StatusCode::NOT_FOUND.into_response();
        };
        axum::Json(catalogue).into_response()
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let upstream = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let root =
        tempfile::tempdir_in(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp")).unwrap();
    let pool = storage::open(&root.path().join("riftmind.db"))
        .await
        .unwrap();
    let client = ResourceClient::fixture(base).unwrap();
    let assets = client
        .resolve(
            &pool,
            root.path(),
            AssetRequest {
                version: "16.20.1".into(),
                locale: "zh-CN".into(),
                champion_ids: vec![],
                resource_ids: Some(vec![
                    ResourceId {
                        kind: ResourceKind::Item,
                        id: 3089,
                    },
                    ResourceId {
                        kind: ResourceKind::Rune,
                        id: 8112,
                    },
                    ResourceId {
                        kind: ResourceKind::Rune,
                        id: 8200,
                    },
                    ResourceId {
                        kind: ResourceKind::Spell,
                        id: 4,
                    },
                    ResourceId {
                        kind: ResourceKind::Item,
                        id: 999999,
                    },
                ]),
            },
        )
        .await
        .unwrap();
    assert_eq!(assets[0].price, Some(3600));
    assert!(
        assets[0]
            .description
            .as_deref()
            .unwrap()
            .contains("130 Ability Power")
    );
    assert_eq!(
        assets[1].description.as_deref(),
        Some("Hit a champion 3 times for bonus damage.")
    );
    assert_eq!(
        assets[2].description.as_deref(),
        Some("Empowered abilities")
    );
    assert_eq!(
        assets[3].description.as_deref(),
        Some("Teleport a short distance.")
    );
    assert_eq!(assets[3].cooldown, Some(300));
    assert!(assets[4].description.is_none());
    assert!(assets[4].price.is_none());
    assert!(assets[4].cooldown.is_none());
    for asset in &assets[..4] {
        assert!(asset.reference.is_none());
        assert_eq!(asset.actual_version.as_deref(), Some("16.20"));
        assert_eq!(asset.requested_version, "16.20.1");
        assert_eq!(asset.locale, "zh-CN");
    }
    upstream.abort();
}

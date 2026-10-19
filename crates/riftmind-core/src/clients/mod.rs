use crate::{contracts::*, domain, storage};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[async_trait]
pub trait MatchRemote: Send + Sync {
    fn item_sets_verified(&self) -> bool {
        false
    }
    async fn item_set_identity(&self) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn item_sets(&self, _summoner_id: u64) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn put_item_sets(&self, _summoner_id: u64, _collection: Value) -> Result<()> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn current_match(&self) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn search(&self, _query: &str) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn ranks(&self, _p: &Player) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    async fn recent(&self, p: &Player, source: Source) -> Result<Value> {
        self.page(p, 0, source).await
    }
    async fn page(&self, player: &Player, offset: u32, source: Source) -> Result<Value>;
    async fn single(&self, _m: &MatchSummary, _timeline: bool, _source: Source) -> Result<Value> {
        Err(AppError::new(ErrorCode::EndpointUnsupported))
    }
    fn lcu_timeline_equivalent(&self) -> bool {
        false
    }
}
#[derive(Clone)]
pub struct LcuClient {
    client: reqwest::Client,
    base: String,
    token: String,
}
impl LcuClient {
    pub fn new(port: u16, token: String) -> Result<Self> {
        if port == 0 || token.is_empty() {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        Ok(Self {
            client: reqwest::Client::builder()
                .no_proxy()
                .danger_accept_invalid_certs(true)
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?,
            base: format!("https://127.0.0.1:{port}"),
            token,
        })
    }
    // Loopback-only synthetic endpoint used by core integration tests, never an IPC input.
    pub fn for_test(port: u16) -> Result<Self> {
        let mut client = Self::new(port, "synthetic-lcu".into())?;
        client.base = format!("http://127.0.0.1:{port}");
        Ok(client)
    }
    pub async fn get(&self, path: &str) -> Result<Value> {
        if ![
            "/lol-summoner/v1/current-summoner",
            "/riotclient/region-locale",
            "/lol-rso-auth/v1/authorization",
            "/entitlements/v1/token",
            "/lol-league-session/v1/league-session-token",
            "/lol-gameflow/v1/gameflow-phase",
            "/lol-gameflow/v1/session",
            "/lol-champ-select/v1/session",
        ]
        .contains(&path)
            && !path.starts_with("/lol-item-sets/v1/item-sets/")
            && !path.starts_with("/lol-summoner/v1/riot-alias/")
            && !path.starts_with("/lol-summoner/v1/summoners?name=")
            && !path.starts_with("/lol-ranked/v1/ranked-stats/")
            && !path.starts_with("/lol-match-history/v1/products/lol/")
            && !path.starts_with("/lol-match-history/v1/games/")
            && !path.starts_with("/lol-match-history/v1/game-timelines/")
        {
            return Err(AppError::new(ErrorCode::Forbidden));
        }
        let res = self
            .client
            .get(format!("{}{path}", self.base))
            .basic_auth("riot", Some(&self.token))
            .send()
            .await
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        bounded_json(res).await
    }
    pub async fn put_item_sets(&self, summoner_id: u64, collection: Value) -> Result<()> {
        if summoner_id == 0 {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        let response = self
            .client
            .put(format!(
                "{}/lol-item-sets/v1/item-sets/{summoner_id}/sets",
                self.base
            ))
            .basic_auth("riot", Some(&self.token))
            .json(&collection)
            .send()
            .await
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        if !response.status().is_success() {
            return Err(AppError::new(match response.status().as_u16() {
                401 => ErrorCode::WaitingAuth,
                403 => ErrorCode::Forbidden,
                429 => ErrorCode::RateLimited,
                _ => ErrorCode::NetworkUnavailable,
            }));
        }
        Ok(())
    }
    pub fn ws_credentials(&self) -> (&str, &str) {
        (&self.base, &self.token)
    }
    pub async fn tokens(&self) -> Result<Tokens> {
        let rso = self.get("/entitlements/v1/token").await?;
        let league = self
            .get("/lol-league-session/v1/league-session-token")
            .await
            .ok();
        Ok(Tokens {
            rso: rso
                .get("accessToken")
                .and_then(Value::as_str)
                .map(str::to_string),
            league: league.as_ref().and_then(Value::as_str).map(str::to_string),
        })
    }
}
#[derive(Default)]
pub struct Tokens {
    pub rso: Option<String>,
    pub league: Option<String>,
}
pub struct HttpRemote {
    pub lcu: Option<LcuClient>,
    pub server: domain::Server,
    pub sgp_base: Option<String>,
    pub tokens: Mutex<Tokens>,
    client: reqwest::Client,
    pub refresh_lock: Mutex<u32>,
    simulated_item_sets: bool,
}
impl HttpRemote {
    pub fn new(lcu: Option<LcuClient>, server: domain::Server, tokens: Tokens) -> Self {
        Self {
            lcu,
            server,
            sgp_base: None,
            tokens: Mutex::new(tokens),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap(),
            refresh_lock: Mutex::new(0),
            simulated_item_sets: false,
        }
    }
    // Test bridges inject loopback mock origins; the production command registry exposes no override.
    pub fn for_test(base: String, server: domain::Server) -> Self {
        let mut r = Self::new(
            None,
            server,
            Tokens {
                rso: Some("synthetic-rso".into()),
                league: Some("synthetic-league".into()),
            },
        );
        r.sgp_base = Some(base);
        r.simulated_item_sets = true;
        r
    }
    async fn sgp_request(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        let mut generation = *self.refresh_lock.lock().await;
        for attempt in 0..3 {
            let token = {
                let t = self.tokens.lock().await;
                t.rso.clone()
            }
            .ok_or(AppError::new(ErrorCode::WaitingAuth))?;
            let base = self.sgp_base.as_ref().unwrap_or(&self.server.match_history);
            let url = format!("{base}{path}");
            let res = self
                .client
                .get(url)
                .query(query)
                .bearer_auth(token)
                .send()
                .await;
            match res {
                Ok(res) if res.status().as_u16() == 401 && attempt == 0 => {
                    let mut current = self.refresh_lock.lock().await;
                    if *current == generation {
                        let lcu = self
                            .lcu
                            .as_ref()
                            .ok_or(AppError::new(ErrorCode::WaitingAuth))?;
                        *self.tokens.lock().await = lcu.tokens().await?;
                        *current += 1;
                    }
                    generation = *current;
                }
                Ok(res) if res.status().is_server_error() && attempt < 2 => {
                    tokio::time::sleep(Duration::from_millis(100 * (1 << attempt))).await
                }
                Ok(res) => return bounded_json(res).await,
                Err(_) if attempt < 2 => {
                    tokio::time::sleep(Duration::from_millis(100 * (1 << attempt))).await
                }
                Err(_) => return Err(AppError::new(ErrorCode::NetworkUnavailable)),
            }
        }
        Err(AppError::new(ErrorCode::NetworkUnavailable))
    }
}
#[async_trait]
impl MatchRemote for HttpRemote {
    // Only the explicitly constructed loopback test adapter has verified synthetic shapes.
    fn item_sets_verified(&self) -> bool {
        self.simulated_item_sets
    }
    async fn item_set_identity(&self) -> Result<Value> {
        if self.simulated_item_sets {
            return self.sgp_request("/test/item-set-identity", &[]).await;
        }
        self.lcu
            .as_ref()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?
            .get("/lol-summoner/v1/current-summoner")
            .await
    }
    async fn item_sets(&self, summoner_id: u64) -> Result<Value> {
        if self.simulated_item_sets {
            return self
                .sgp_request(
                    "/test/item-sets",
                    &[("summonerId", summoner_id.to_string())],
                )
                .await;
        }
        self.lcu
            .as_ref()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?
            .get(&format!("/lol-item-sets/v1/item-sets/{summoner_id}/sets"))
            .await
    }
    async fn put_item_sets(&self, summoner_id: u64, collection: Value) -> Result<()> {
        if self.simulated_item_sets {
            let base = self
                .sgp_base
                .as_ref()
                .ok_or(AppError::new(ErrorCode::Forbidden))?;
            let response = self
                .client
                .put(format!("{base}/test/item-sets"))
                .query(&[("summonerId", summoner_id)])
                .json(&collection)
                .send()
                .await
                .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
            if !response.status().is_success() {
                return Err(AppError::new(ErrorCode::NetworkUnavailable));
            }
            return Ok(());
        }
        self.lcu
            .as_ref()
            .ok_or(AppError::new(ErrorCode::ClientNotFound))?
            .put_item_sets(summoner_id, collection)
            .await
    }

    async fn current_match(&self) -> Result<Value> {
        if let Some(lcu) = &self.lcu {
            let phase = lcu.get("/lol-gameflow/v1/gameflow-phase").await?;
            let game = match lcu.get("/lol-gameflow/v1/session").await {
                Ok(v) => v,
                Err(e) if e.code == ErrorCode::EndpointUnsupported => Value::Null,
                Err(e) => return Err(e),
            };
            let champ = if phase == "ChampSelect" {
                lcu.get("/lol-champ-select/v1/session").await?
            } else {
                Value::Null
            };
            if lcu.get("/lol-gameflow/v1/gameflow-phase").await? != phase {
                return Err(AppError::new(ErrorCode::SessionChanged));
            }
            Ok(json!({"phase":phase,"game":game,"champSelect":champ}))
        } else if self.sgp_base.is_some() {
            self.sgp_request("/test/live", &[]).await
        } else {
            Err(AppError::new(ErrorCode::EndpointUnsupported))
        }
    }
    async fn search(&self, query: &str) -> Result<Value> {
        if let Some(lcu) = &self.lcu {
            let path = if let Some((name, tag)) = query.rsplit_once('#') {
                let mut url =
                    reqwest::Url::parse("https://localhost/lol-summoner/v1/riot-alias/").unwrap();
                url.path_segments_mut()
                    .unwrap()
                    .pop_if_empty()
                    .push(name)
                    .push(tag);
                url.path().to_string()
            } else {
                let mut url =
                    reqwest::Url::parse("https://localhost/lol-summoner/v1/summoners").unwrap();
                url.query_pairs_mut().append_pair("name", query);
                format!("{}?{}", url.path(), url.query().unwrap())
            };
            let v = lcu.get(&path).await.map_err(|mut e| {
                if e.params.get("httpStatus").is_some_and(|s| s == "404") {
                    e.code = ErrorCode::NotFound;
                }
                e
            })?;
            if v["puuid"].as_str().is_none_or(|s| s.is_empty()) {
                return Err(AppError::new(ErrorCode::NotFound));
            }
            Ok(v)
        } else if self.sgp_base.is_some() {
            self.sgp_request("/test/search", &[("query", query.into())])
                .await
        } else {
            Err(AppError::new(ErrorCode::EndpointUnsupported))
        }
    }
    async fn ranks(&self, p: &Player) -> Result<Value> {
        domain::validate_key(&p.puuid)?;
        if p.server_id != self.server.id || p.player_key != format!("{}:{}", p.server_id, p.puuid) {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        if let Some(lcu) = &self.lcu {
            lcu.get(&format!("/lol-ranked/v1/ranked-stats/{}", p.puuid))
                .await
        } else if self.sgp_base.is_some() {
            self.sgp_request("/test/ranks", &[]).await
        } else {
            Err(AppError::new(ErrorCode::EndpointUnsupported))
        }
    }
    async fn recent(&self, p: &Player, source: Source) -> Result<Value> {
        domain::validate_key(&p.puuid)?;
        if p.server_id != self.server.id || p.player_key != format!("{}:{}", p.server_id, p.puuid) {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        match source {
            Source::Sgp => {
                self.sgp_request(
                    &format!(
                        "/match-history-query/v1/products/lol/player/{}/SUMMARY",
                        p.puuid
                    ),
                    &[("startIndex", "0".into()), ("count", "20".into())],
                )
                .await
            }
            Source::Lcu => {
                self.lcu
                    .as_ref()
                    .ok_or(AppError::new(ErrorCode::EndpointUnsupported))?
                    .get(&format!(
                        "/lol-match-history/v1/products/lol/{}/matches?begIndex=0&endIndex=19",
                        p.puuid
                    ))
                    .await
            }
        }
    }

    async fn single(&self, m: &MatchSummary, timeline: bool, source: Source) -> Result<Value> {
        domain::validate_key(&m.game_id)?;
        if m.server_id != self.server.id || m.match_key != format!("{}:{}", m.server_id, m.game_id)
        {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        match source {
            Source::Sgp => {
                self.sgp_request(
                    &format!(
                        "/match-history-query/v1/products/lol/{}_{}/{}",
                        self.server.region_path,
                        m.game_id,
                        if timeline { "DETAILS" } else { "SUMMARY" }
                    ),
                    &[],
                )
                .await
            }
            Source::Lcu => {
                self.lcu
                    .as_ref()
                    .ok_or(AppError::new(ErrorCode::EndpointUnsupported))?
                    .get(&format!(
                        "/lol-match-history/v1/{}/{}",
                        if timeline { "game-timelines" } else { "games" },
                        m.game_id
                    ))
                    .await
            }
        }
    }
    async fn page(&self, p: &Player, offset: u32, source: Source) -> Result<Value> {
        domain::validate_key(&p.puuid)?;
        if p.server_id != self.server.id || p.player_key != format!("{}:{}", p.server_id, p.puuid) {
            return Err(AppError::new(ErrorCode::RegionConflict));
        }
        match source {
            Source::Sgp => {
                self.sgp_request(
                    &format!(
                        "/match-history-query/v1/products/lol/player/{}/SUMMARY",
                        p.puuid
                    ),
                    &[("startIndex", offset.to_string()), ("count", "50".into())],
                )
                .await
            }
            Source::Lcu => self
                .lcu
                .as_ref()
                .ok_or(AppError::new(ErrorCode::EndpointUnsupported))?
                .get(&format!(
                    "/lol-match-history/v1/products/lol/{}/matches?begIndex={offset}&endIndex={}",
                    p.puuid,
                    offset + 49
                ))
                .await,
        }
    }
}
pub async fn bounded_json(res: reqwest::Response) -> Result<Value> {
    let code = match res.status().as_u16() {
        200..=299 => None,
        401 => Some(ErrorCode::WaitingAuth),
        403 => Some(ErrorCode::Forbidden),
        404 | 405 => Some(ErrorCode::EndpointUnsupported),
        429 => Some(ErrorCode::RateLimited),
        _ => Some(ErrorCode::NetworkUnavailable),
    };
    if let Some(code) = code {
        let mut e = AppError::new(code);
        e.params
            .insert("httpStatus".into(), res.status().as_u16().to_string());
        if e.code == ErrorCode::RateLimited {
            e.params.insert(
                "retryAfter".into(),
                res.headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("60")
                    .into(),
            );
        }
        return Err(e);
    }
    if res.content_length().is_some_and(|l| l > 8 * 1024 * 1024) {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    let mut bytes = Vec::new();
    let mut res = res;
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err(AppError::new(ErrorCode::InvalidInput));
        }
        bytes.extend(chunk)
    }
    Ok(serde_json::from_slice(&bytes)?)
}
fn u(v: &Value, key: &str) -> Option<u32> {
    v.get(key)?.as_u64().and_then(|n| n.try_into().ok())
}
fn identifier(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        Some(s.into())
    } else {
        v.as_u64().map(|n| n.to_string())
    }
}
pub fn normalize(
    raw: &Value,
    p: &Player,
    source: Source,
    fallback: Option<String>,
) -> Result<Vec<MatchSummary>> {
    let list = raw
        .get("games")
        .and_then(|v| {
            v.as_array()
                .or_else(|| v.get("games").and_then(Value::as_array))
        })
        .or_else(|| raw.as_array())
        .ok_or(AppError::new(ErrorCode::InvalidInput))?;
    if list.len() > 100 {
        return Err(AppError::new(ErrorCode::InvalidInput));
    }
    list.iter()
        .map(|g| {
            let g = g.get("json").unwrap_or(g);
            let info = g.get("info").unwrap_or(g);
            if let Some(platform) = info.get("platformId").and_then(Value::as_str) {
                let platform = platform.to_uppercase();
                let server = if p.server_id.starts_with("TENCENT_") {
                    format!(
                        "TENCENT_{}",
                        platform.strip_prefix("TENCENT_").unwrap_or(&platform)
                    )
                } else {
                    domain::alias(&platform)
                };
                if server != p.server_id {
                    return Err(AppError::new(ErrorCode::RegionConflict));
                }
            }
            let game_id = identifier(
                info.get("gameId")
                    .or_else(|| g.get("gameId"))
                    .ok_or(AppError::new(ErrorCode::InvalidInput))?,
            )
            .ok_or(AppError::new(ErrorCode::InvalidInput))?;
            domain::validate_key(&game_id)?;
            let participants = info
                .get("participants")
                .and_then(Value::as_array)
                .ok_or(AppError::new(ErrorCode::InvalidInput))?;
            let participant_id = info
                .get("participantIdentities")
                .and_then(Value::as_array)
                .and_then(|ids| {
                    ids.iter().find(|v| {
                        v.pointer("/player/puuid").and_then(Value::as_str) == Some(&p.puuid)
                    })
                })
                .and_then(|v| v.get("participantId"));
            let part = participants
                .iter()
                .find(|v| {
                    v.get("puuid").and_then(Value::as_str) == Some(&p.puuid)
                        || participant_id.is_some_and(|id| v.get("participantId") == Some(id))
                })
                .ok_or(AppError::new(ErrorCode::InvalidInput))?;
            let stats = part.get("stats").unwrap_or(part);
            let timestamp = info
                .get("gameCreation")
                .or_else(|| info.get("gameStartTimestamp"))
                .and_then(Value::as_i64);
            let started = timestamp
                .and_then(chrono::DateTime::from_timestamp_millis)
                .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
                .or_else(|| {
                    info.get("gameCreationDate")
                        .and_then(Value::as_str)
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                        .map(|d| {
                            d.with_timezone(&chrono::Utc)
                                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                        })
                })
                .ok_or(AppError::new(ErrorCode::InvalidInput))?;
            let outcome = if stats
                .get("gameEndedInEarlySurrender")
                .and_then(Value::as_bool)
                == Some(true)
                && u(info, "gameDuration").is_some_and(|s| s < 300)
            {
                Outcome::Remake
            } else {
                match stats.get("win").and_then(Value::as_bool) {
                    Some(true) => Outcome::Win,
                    Some(false) => Outcome::Loss,
                    None => Outcome::Unknown,
                }
            };
            let items = (0..7)
                .filter_map(|n| u(stats, &format!("item{n}")))
                .filter(|n| *n > 0)
                .collect();
            Ok(MatchSummary {
                match_key: format!("{}:{game_id}", p.server_id),
                player_key: p.player_key.clone(),
                game_id,
                server_id: p.server_id.clone(),
                started_at: started,
                queue_id: u(info, "queueId"),
                champion_id: u(part, "championId"),
                version: info
                    .get("gameVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .into(),
                outcome,
                kills: u(stats, "kills"),
                deaths: u(stats, "deaths"),
                assists: u(stats, "assists"),
                duration: u(info, "gameDuration"),
                position: part
                    .get("teamPosition")
                    .and_then(Value::as_str)
                    .filter(|s| ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].contains(s))
                    .map(str::to_string),
                cs: u(stats, "totalMinionsKilled")
                    .zip(u(stats, "neutralMinionsKilled"))
                    .map(|(a, b)| a.saturating_add(b))
                    .or_else(|| u(stats, "totalMinionsKilled")),
                items,
                source: source.clone(),
                fallback_reason: fallback.clone(),
                revision: 1,
                review_state: None,
            })
        })
        .collect()
}
pub type Remote = Arc<dyn MatchRemote>;
pub fn synthetic_page(p: &Player, offset: u32) -> Value {
    let games:Vec<_>=(offset..(offset+50).min(125)).map(|i|json!({"json":{"gameId":format!("900719925474{}",100+i),"gameCreation":1792108800000_i64-i as i64*3600000,"gameVersion":"16.20.1","queueId":if i%3==0{450}else{420},"gameDuration":1500+i*3,"participants":[{"puuid":p.puuid,"championId":if i%2==0{103}else{64},"kills":8+i%6,"deaths":3+i%4,"assists":12,"totalMinionsKilled":180,"teamPosition":"MIDDLE","win":i%3!=0,"item0":3089,"item1":3020}]}})).collect();
    json!({"games":games})
}
pub fn player_from_summoner(raw: &Value, server: &str, fallback_name: &str) -> Result<Player> {
    let puuid = raw["puuid"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    domain::validate_key(puuid)?;
    if raw["serverId"].as_str().is_some_and(|id| id != server) {
        return Err(AppError::new(ErrorCode::RegionConflict));
    }
    let name = ["gameName", "displayName", "summonerName"]
        .iter()
        .find_map(|key| raw[key].as_str().filter(|value| !value.is_empty()))
        .unwrap_or(fallback_name);
    let display_name = match raw["tagLine"].as_str().filter(|value| !value.is_empty()) {
        Some(tag) => format!("{name}#{tag}"),
        None => name.into(),
    };
    Ok(Player {
        player_key: format!("{server}:{puuid}"),
        server_id: server.into(),
        puuid: puuid.into(),
        display_name,
        profile_icon_id: raw["profileIconId"]
            .as_u64()
            .and_then(|value| value.try_into().ok()),
        summoner_level: raw["summonerLevel"]
            .as_u64()
            .and_then(|value| value.try_into().ok())
            .filter(|value| *value > 0),
        updated_at: storage::now(),
    })
}
pub fn synthetic_player(server: &str) -> Player {
    Player {
        player_key: format!("{server}:synthetic-player"),
        server_id: server.into(),
        puuid: "synthetic-player".into(),
        display_name: "Rift Walker #DEMO".into(),
        profile_icon_id: None,
        summoner_level: None,
        updated_at: storage::now(),
    }
}

impl LcuClient {
    pub async fn subscribe(
        &self,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    > {
        use base64::Engine;
        use futures_util::SinkExt;
        use tokio_tungstenite::{
            Connector,
            tungstenite::{Message, client::IntoClientRequest},
        };
        let url = self
            .base
            .replacen("https:", "wss:", 1)
            .replacen("http:", "ws:", 1);
        let mut request = url
            .into_client_request()
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        let auth = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", self.token))
        );
        request.headers_mut().insert(
            "Authorization",
            auth.parse()
                .map_err(|_| AppError::new(ErrorCode::InvalidInput))?,
        );
        // This connector is used only for the discovered loopback LCU, never SGP or resources.
        let tls = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .build()
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        let (mut socket, _) = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async_tls_with_config(
                request,
                None,
                true,
                Some(Connector::NativeTls(tls)),
            ),
        )
        .await
        .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?
        .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        socket
            .send(Message::Text("[5,\"OnJsonApiEvent\"]".into()))
            .await
            .map_err(|_| AppError::new(ErrorCode::NetworkUnavailable))?;
        Ok(socket)
    }
}

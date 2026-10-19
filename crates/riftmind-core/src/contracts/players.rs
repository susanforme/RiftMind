dto!(PlayerSearch { query: String });
dto!(FavoriteChange {
    workspace_epoch: String,
    player_key: String,
    favorite: bool
});
dto!(PlayerProfileQuery {player_key:String, queue_id:Option<u32>, champion_id:Option<u32>});
dto!(PlayerOverviewQuery {player_key:String, queue_id:Option<u32>, days:Option<u32>});
dto!(RankSnapshot {
    collected_at: String,
    rank: RankEntry
});
dto!(PlayerOverview {profile:PlayerProfile, matches:Vec<MatchSummary>, rank_history:Vec<RankSnapshot>, is_self:bool, history_error:Option<ErrorCode>});
dto!(RankEntry {queue:String, tier:Option<String>, division:Option<String>, points:Option<u32>});
dto!(SampleMetric {value:Option<f64>, samples:u32, excluded:BTreeMap<String,u32>});
dto!(ChampionRecent {
    champion_id: u32,
    games: u32,
    wins: u32,
    decided: u32,
    kda: SampleMetric
});
dto!(PlayerProfile {player:Player, source:Source, collected_at:String, ranks:Vec<RankEntry>, rank_error:Option<ErrorCode>, queue_id:Option<u32>, games:u32, win_rate:SampleMetric, kda:SampleMetric, champions:Vec<ChampionRecent>, champion_games:u32, champion_win_rate:SampleMetric, champion_kda:SampleMetric});

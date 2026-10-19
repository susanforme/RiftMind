use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

macro_rules! dto { ($name:ident {$($f:ident: $t:ty),* $(,)?}) => {
 #[derive(Debug, Clone, Serialize, Deserialize, TS)]
 #[serde(rename_all="camelCase", deny_unknown_fields)]
 pub struct $name { $(pub $f: $t),* }
}; }
macro_rules! enumeration { ($name:ident {$($v:ident),*}) => {
 #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
 #[serde(rename_all="snake_case")]
 pub enum $name {$($v),*}
}; }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    AppNotReady,
    ClientNotFound,
    WaitingAuth,
    RegionUnknown,
    RegionConflict,
    EndpointUnsupported,
    RateLimited,
    SettingsConflict,
    StorageUnavailable,
    StorageFull,
    StorageLocked,
    StorageCorrupt,
    UpdateNotConfigured,
    InvalidInput,
    SessionChanged,
    Forbidden,
    NetworkUnavailable,
    BackupInvalid,
    Cancelled,
    NotFound,
    SettingsInvalid,
    UpdateFailed,
    DataIncomplete,
    AnalysisUnsupported,
    RevisionConflict,
    EvidenceUnavailable,
}
dto!(AppError {code:ErrorCode, params:BTreeMap<String,String>, retryable:bool, request_id:String, task_id:Option<String>});
impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        let retryable = matches!(
            code,
            ErrorCode::NetworkUnavailable
                | ErrorCode::StorageUnavailable
                | ErrorCode::RateLimited
                | ErrorCode::AppNotReady
        );
        Self {
            code,
            params: BTreeMap::new(),
            retryable,
            request_id: uuid::Uuid::new_v4().to_string(),
            task_id: None,
        }
    }
}
pub type Result<T> = std::result::Result<T, AppError>;
impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        let code = error
            .as_database_error()
            .and_then(|e| e.code())
            .map(|s| s.into_owned());
        Self::new(match code.as_deref() {
            Some("5" | "6") => ErrorCode::StorageLocked,
            Some("11" | "26") => ErrorCode::StorageCorrupt,
            Some("13") => ErrorCode::StorageFull,
            _ => ErrorCode::StorageUnavailable,
        })
    }
}
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new(if error.kind() == std::io::ErrorKind::StorageFull {
            ErrorCode::StorageFull
        } else {
            ErrorCode::StorageUnavailable
        })
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::new(ErrorCode::InvalidInput)
    }
}
enumeration!(AppPhase {
    Booting,
    Migrating,
    Ready,
    RecoveryRequired,
    ShuttingDown
});
enumeration!(ConnectionPhase {
    Disconnected,
    Discovering,
    Selecting,
    WaitingAuth,
    Resolving,
    Connected,
    Conflict,
    Unsupported,
    CoolingDown
});
enumeration!(ColorMode {
    Light,
    Dark,
    System
});
enumeration!(CloseBehavior { Tray, Exit });
enumeration!(JobKind {
    Sync,
    Backup,
    Restore,
    Diagnostics,
    FetchDetails,
    GenerateReview,
    EvaluateGoal
});
enumeration!(JobState {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
    Interrupted
});
enumeration!(Source { Sgp, Lcu });
enumeration!(Outcome {
    Win,
    Loss,
    Remake,
    Unknown
});
dto!(WorkspaceTab {id:String, player_key:Option<String>, kind:String, search:String});
dto!(Settings {schema_version:u32, revision:u32, language_preference:String, theme_id:String, color_mode_preference:ColorMode, sidebar_collapsed:bool, close_behavior:CloseBehavior, auto_connect:bool, auto_sync:bool, sync_pages:u32, workspace_tabs:Vec<WorkspaceTab>, active_tab:String});
impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            language_preference: "system".into(),
            theme_id: "default".into(),
            color_mode_preference: ColorMode::System,
            sidebar_collapsed: false,
            close_behavior: CloseBehavior::Tray,
            auto_connect: true,
            auto_sync: true,
            sync_pages: 3,
            workspace_tabs: vec![],
            active_tab: String::new(),
        }
    }
}
dto!(SettingsPatch {language_preference:Option<String>, theme_id:Option<String>, color_mode_preference:Option<ColorMode>, sidebar_collapsed:Option<bool>, close_behavior:Option<CloseBehavior>, auto_connect:Option<bool>, auto_sync:Option<bool>, sync_pages:Option<u32>, workspace_tabs:Option<Vec<WorkspaceTab>>, active_tab:Option<String>});
dto!(UpdateSettings {
    expected_revision: u32,
    patch: SettingsPatch
});
dto!(Identification {realm:String, environment:String, server_id:Option<String>, region:Option<String>, rso_platform_id:Option<String>, mapping_version:String, evidence:Vec<String>, verification:String});
dto!(ClientInstance {
    id: String,
    pid: String,
    started_at: String,
    identification: Identification
});
dto!(Player {
    player_key: String,
    server_id: String,
    puuid: String,
    display_name: String,
    updated_at: String
});
dto!(ConnectionState {phase:ConnectionPhase, session_epoch:String, instance:Option<ClientInstance>, player:Option<Player>, identification:Option<Identification>, sgp_ready:bool, lcu_ready:bool, retry_at:Option<String>});
impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            phase: ConnectionPhase::Disconnected,
            session_epoch: uuid::Uuid::new_v4().to_string(),
            instance: None,
            player: None,
            identification: None,
            sgp_ready: false,
            lcu_ready: false,
            retry_at: None,
        }
    }
}
dto!(AppState {
    phase: AppPhase,
    runtime_id: String,
    workspace_epoch: String,
    app_version: String,
    database_version: u32,
    settings_version: u32,
    update_status: UpdateStatus
});
dto!(MatchSummary {match_key:String,player_key:String,game_id:String,server_id:String,started_at:String,queue_id:Option<u32>,champion_id:Option<u32>,version:String,outcome:Outcome,kills:Option<u32>,deaths:Option<u32>,assists:Option<u32>,duration:Option<u32>,position:Option<String>,cs:Option<u32>,items:Vec<u32>,source:Source,fallback_reason:Option<String>,revision:u32,review_state:Option<String>});
dto!(MatchQuery {player_key:String,queue_id:Option<u32>,champion_id:Option<u32>,from:Option<String>,to:Option<String>,cursor:Option<String>,page_size:Option<u32>});
dto!(MatchPage {items:Vec<MatchSummary>,next_cursor:Option<String>,total:u32,coverage:Option<Coverage>,last_task:Option<Task>});
dto!(Coverage {
    last_sync: String,
    pages: u32,
    matches_count: u32,
    exhausted: bool
});
dto!(SyncRequest {
    player_key: String,
    pages: u32
});
dto!(Task {id:String,player_key:Option<String>,kind:JobKind,state:JobState,checkpoint:u32,budget:u32,session_epoch:String,updated_at:String,error:Option<AppError>,result:Option<MaintenanceResult>,stage:Option<String>,retry_at:Option<String>});
dto!(IdInput { id: String });
dto!(Empty {});
enumeration!(ResourceKind {
    Champion,
    Item,
    Rune,
    Spell
});
dto!(ResourceId {
    kind: ResourceKind,
    id: u32
});
dto!(AssetRequest {version:String,locale:String,champion_ids:Vec<u32>,resource_ids:Option<Vec<ResourceId>>});
dto!(Asset {resource_id:String,requested_version:String,actual_version:Option<String>,locale:String,name:Option<String>,reference:Option<String>,hash:Option<String>,availability:String});
dto!(StorageUsage {
    database_bytes: f64,
    asset_bytes: f64,
    backup_bytes: f64
});
dto!(MaintenanceResult {
    reference: String,
    workspace_epoch: String
});
dto!(UpdateStatus {state:String,version:Option<String>,downloaded:f64,total:Option<f64>,reason:Option<ErrorCode>});
dto!(EventEnvelope {event_version:u32,runtime_id:String,workspace_epoch:String,sequence:u32,revision:u32,kind:String,object_key:Option<String>});

include!("review.rs");

// This registry generates both command names and input/output types, including nullable IDs.
macro_rules! registry {($($name:ident : $input:ty => $output:ty),* $(,)?) => {
 #[derive(Debug,Deserialize,Serialize,TS)]
 #[serde(tag="command",content="args",rename_all="snake_case")]
 #[allow(non_camel_case_types)]
 pub enum Command { $($name($input)),* }
 pub fn command_map()->String{let mut s=String::from("export interface CommandMap {\n");$(s.push_str(&format!("  {}: {{ input: {}; output: {} }};\n",stringify!($name),<$input>::name(),<$output>::name()));)*s.push_str("}\n");s}
};}
registry! {
 get_app_state:Empty=>AppState,
 get_connection_state:Empty=>ConnectionState,
 list_client_instances:Empty=>Vec<ClientInstance>,
 select_client_instance:IdInput=>ConnectionState,
 retry_connection:Empty=>ConnectionState,
 get_settings:Empty=>Settings,
 update_settings:UpdateSettings=>Settings,
 list_players:Empty=>Vec<Player>,
 list_matches:MatchQuery=>MatchPage,
 sync_player_matches:SyncRequest=>Task,
 get_task_status:IdInput=>Task,
 cancel_task:IdInput=>Task,
 resolve_assets:AssetRequest=>Vec<Asset>,
 get_storage_usage:Empty=>StorageUsage,
 clear_asset_cache:Empty=>StorageUsage,
 create_backup:Empty=>Task,
 restore_backup:IdInput=>Task,
 export_diagnostics:Empty=>Task,
 check_for_updates:Empty=>UpdateStatus,
 install_update:Empty=>UpdateStatus,
 get_match_review_data:ReviewQuery=>ReviewData,
 fetch_match_details:MatchRef=>Task,
 get_timeline_slice:TimelineQuery=>TimelineSlice,
 get_match_metrics:ChartQuery=>ChartData,
 generate_review:GenerateReview=>Task,
 get_review:IdInput=>ReviewReport,
 get_review_evidence:EvidenceQuery=>EvidenceData,
 get_review_annotations:AnnotationsQuery=>ReviewAnnotations,
 save_review_note:SaveNote=>ReviewNote,
 delete_review_note:DeleteNote=>Empty,
 save_review_feedback:SaveFeedback=>ReviewFeedback,
 save_training_goal:SaveGoal=>TrainingGoal,
 list_training_goals:GoalQuery=>GoalPage,
 get_goal_progress:GoalProgressQuery=>GoalProgress,
 evaluate_training_goal:IdInput=>Task,
 get_player_progress:PlayerProgressQuery=>PlayerProgress
}
pub fn generate_types() -> String {
    let mut s = String::from(
        "// Generated by riftmind-core; do not edit.\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n",
    );
    macro_rules! types {($($t:ty),*)=>{$(s.push_str("export ");s.push_str(&<$t>::decl());s.push('\n');)*};}
    types!(
        ErrorCode,
        AppError,
        AppPhase,
        ConnectionPhase,
        ColorMode,
        CloseBehavior,
        JobState,
        JobKind,
        Source,
        Outcome,
        WorkspaceTab,
        Settings,
        SettingsPatch,
        UpdateSettings,
        Identification,
        ClientInstance,
        Player,
        ConnectionState,
        AppState,
        MatchSummary,
        MatchQuery,
        MatchPage,
        Coverage,
        SyncRequest,
        Task,
        IdInput,
        Empty,
        ResourceKind,
        ResourceId,
        AssetRequest,
        Asset,
        StorageUsage,
        MaintenanceResult,
        UpdateStatus,
        EventEnvelope,
        Command,
        DataStatus,
        MetricStatus,
        GoalState,
        MatchRef,
        ReviewQuery,
        InputRef,
        Capability,
        Participant,
        MatchContext,
        FramePoint,
        TimelineEvent,
        AnalysisInput,
        MetricResult,
        EvidenceRef,
        Finding,
        ReviewReport,
        ReviewData,
        GenerateReview,
        TimelineQuery,
        TimelineSlice,
        ChartQuery,
        ChartPoint,
        ChartData,
        EvidenceQuery,
        EvidenceData,
        ReviewNote,
        SaveNote,
        DeleteNote,
        ReviewFeedback,
        SaveFeedback,
        AnnotationsQuery,
        ReviewAnnotations,
        GoalScope,
        GoalMember,
        TrainingGoal,
        SaveGoal,
        GoalQuery,
        GoalPage,
        GoalProgressQuery,
        GoalEvaluation,
        GoalProgress,
        PlayerProgressQuery,
        TrendPoint,
        PlayerProgress
    );
    s.push_str(&command_map());
    s
}

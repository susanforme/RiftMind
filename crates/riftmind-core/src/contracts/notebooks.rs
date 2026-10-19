enumeration!(NotebookKind {
    Note,
    Combo,
    Matchup,
    Build
});
enumeration!(ComboAction {
    Skill,
    Attack,
    Move,
    Spell,
    Item,
    Text
});
enumeration!(PracticeState {
    Pending,
    Practicing,
    Mastered
});
dto!(ComboStep {action:ComboAction, entity_id:Option<u32>, label:String});
dto!(BuildItem {
    id: u32,
    count: u32
});
dto!(BuildGroup {name:String, items:Vec<BuildItem>});
dto!(NotebookLink {
    entry_id: String,
    revision: u32
});
dto!(NotebookSource {match_key:String, player_key:String, report_id:Option<String>, evidence_id:Option<String>});
dto!(NotebookContent {champion_id:u32, kind:NotebookKind, title:String, text:String, pinned:bool, opponent_id:Option<u32>, position:Option<String>, tags:Vec<String>, steps:Vec<ComboStep>, groups:Vec<BuildGroup>, map_id:Option<u32>, resource_version:Option<String>, confirmed_patch:Option<String>, links:Vec<NotebookLink>, sources:Vec<NotebookSource>, skill_order:Option<Vec<u32>>});
dto!(NotebookEntry {id:String, revision:u32, content:NotebookContent, reviewed_revision:Option<u32>, deleted:bool, updated_at:String});
dto!(NotebookQuery {champion_id:Option<u32>, kind:Option<NotebookKind>, search:String, opponent_id:Option<u32>, trash:bool});
dto!(SaveNotebook {workspace_epoch:String, id:Option<String>, expected_revision:u32, content:NotebookContent, confirm_patch:Option<String>});
dto!(ChangeNotebook {workspace_epoch:String, id:String, expected_revision:u32, action:String, restore_revision:Option<u32>, confirm_permanent:bool});
dto!(NotebookHistory {entry_id:String, revisions:Vec<NotebookEntry>});
dto!(PracticeEntry {id:String, champion_id:u32, title:String, source_id:Option<String>, source_revision:Option<u32>, state:PracticeState, notes:String, revision:u32, updated_at:String});
dto!(SavePractice {
    workspace_epoch: String,
    entry: PracticeEntry,
    expected_revision: u32,
    delete: bool
});
dto!(NotebookExport {format:String, version:u32, champion_id:u32, entries:Vec<NotebookEntry>});
dto!(NotebookTransfer {workspace_epoch:String, json:String, commit:bool, replacements:BTreeMap<String,NotebookLink>});
dto!(ImportPreview {champion_id:u32, added:u32, duplicates:u32, conflicts:u32, missing_links:u32, entries:Vec<NotebookEntry>});
dto!(ItemCatalogueQuery {
    version: String,
    locale: String
});
dto!(CatalogueItem {id:u32, name:String, maps:Vec<u32>, purchasable:bool});
dto!(ItemCatalogue {version:String, items:Vec<CatalogueItem>});
dto!(BuildExportQuery {
    entry_id: String,
    target_version: String,
    map_id: u32
});
dto!(BuildExport {json:String, issues:Vec<String>});
dto!(BuildApplyQuery {
    workspace_epoch: String,
    entry_id: String,
    expected_revision: u32,
    target_version: String,
    map_id: u32,
    save_as_new: bool,
    overwrite_remote: bool
});
dto!(BuildApplication {entry_id:String, player_key:Option<String>, remote_uid:Option<String>, state:String, reason:Option<String>});
dto!(BuildSyncQuery {champion_id:Option<u32>});
dto!(SaveBuildSyncRule {
    workspace_epoch: String,
    entry_id: String,
    expected_revision: u32,
    enabled: bool
});
dto!(BuildSyncRule {champion_id:u32, map_id:u32, entry_id:String, enabled:bool, revision:u32, state:String, error:Option<ErrorCode>, application:Option<BuildApplication>, updated_at:String});

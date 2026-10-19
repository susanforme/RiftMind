use crate::contracts::*;
use serde::{Deserialize,Serialize};

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Server {pub id:String,pub match_history:String,pub region_path:String,pub tencent:bool,pub environment:String,pub verification:String}
pub fn servers()->Vec<Server>{serde_json::from_str(include_str!("servers.json")).expect("bundled server config")}
pub fn alias(s:&str)->String{match s.to_uppercase().as_str(){"NA"=>"NA1","BR"=>"BR1","TR"=>"TR1","LAN"=>"LA1","LAS"=>"LA2","OCE"=>"OC1","EUW1"=>"EUW","JP1"=>"JP","PBE1"=>"PBE",_=>return s.to_uppercase()}.into()}
pub fn identify(region:Option<&str>,platform:Option<&str>,session_platform:Option<&str>)->Identification {
 let r=region.map(str::to_uppercase);let p=platform.map(str::to_uppercase);let sp=session_platform.map(str::to_uppercase);
 let id=match (r.as_deref(),p.as_deref()) { (Some("TENCENT"),Some(p))=>Some(format!("TENCENT_{p}")),(Some("TENCENT"),None)|(None,_)=>None,(Some(r),_)=>Some(alias(r))};
 let conflict=match (r.as_deref(),p.as_deref(),sp.as_deref()) { (Some("TENCENT"),Some(p),Some(sp))=>p!=sp,(_,_,Some(sp))=>id.as_ref().is_some_and(|id|alias(sp)!=*id),_=>false};
 let server=id.as_ref().and_then(|id|servers().into_iter().find(|s|s.id==*id));
 Identification{realm:if conflict||server.is_none(){"unknown"}else if r.as_deref()==Some("TENCENT"){"tencent"}else{"riot"}.into(),environment:server.as_ref().map(|s|s.environment.clone()).unwrap_or("unknown".into()),server_id:if conflict{None}else{server.as_ref().map(|s|s.id.clone())},region:r,rso_platform_id:p,mapping_version:"akari-56cdfde-2026-07-18".into(),evidence:vec![if conflict{"conflict"}else if server.is_some(){"explicit_region_platform"}else{"missing_or_unsupported"}.into()],verification:"reference_only".into()}
}
pub fn command_line_value(args:&str,name:&str)->Option<String>{
 args.split_whitespace().find_map(|a|a.trim_matches('"').strip_prefix(&format!("--{name}=")).map(|v|v.trim_matches('"').to_string()))
}
pub fn parse_identification(args:&str)->Identification {identify(command_line_value(args,"region").as_deref(),command_line_value(args,"rso_platform_id").or_else(||command_line_value(args,"rso-platform-id")).as_deref(),None)}
pub fn validate_key(s:&str)->Result<()> { if s.is_empty()||s.len()>256||!s.chars().all(|c|c.is_ascii_alphanumeric()||"_-:.".contains(c)){Err(AppError::new(ErrorCode::InvalidInput))}else{Ok(())} }
pub fn choose_source(ident:&Identification,sgp_ready:bool,sgp_unsupported:bool,target:&str)->Result<Source>{
 if ident.evidence.iter().any(|s|s=="conflict"){return Err(AppError::new(ErrorCode::RegionConflict))}
 let server=ident.server_id.as_deref().ok_or(AppError::new(ErrorCode::RegionUnknown))?;
 if ident.environment!="live"{return Err(AppError::new(ErrorCode::EndpointUnsupported))}
 if sgp_unsupported {if target==server{Ok(Source::Lcu)}else{Err(AppError::new(ErrorCode::EndpointUnsupported))}}
 else if sgp_ready{Ok(Source::Sgp)}else{Err(AppError::new(ErrorCode::WaitingAuth))}
}

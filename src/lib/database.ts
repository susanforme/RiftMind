import Database from "@tauri-apps/plugin-sql";

// The SQL plugin opens this connection during application startup.
export const database = Database.get("sqlite:riftmind.db");
